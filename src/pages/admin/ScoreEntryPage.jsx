import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import Navbar from '../../components/Navbar'
import {
  calculateDayScore, calculateLeagueAverage,
  getMatchupPoints, recalculateStandings, formatScore, getPointLabel,
  getSeriesWinner, getRoundName
} from '../../lib/scoring'

export default function ScoreEntryPage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [event, setEvent] = useState(null)
  const [divisions, setDivisions] = useState([])
  const [teams, setTeams] = useState([])
  const [categories, setCategories] = useState([])
  const [schedule, setSchedule] = useState([])
  const [existingScores, setExistingScores] = useState([])
  const [bracket, setBracket] = useState([])
  const [bracketConfig, setBracketConfig] = useState([])
  const [loading, setLoading] = useState(true)

  const [activeTab, setActiveTab] = useState('roundrobin')
  const [selectedDay, setSelectedDay] = useState(1)
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [encounters, setEncounters] = useState({})
  const [calculatedScore, setCalculatedScore] = useState(null)
  const [previewOutcomes, setPreviewOutcomes] = useState(null)
  const [saving, setSaving] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [message, setMessage] = useState(null)
  const [undoTarget, setUndoTarget] = useState(null)
  const [commitConfirm, setCommitConfirm] = useState(false)

  // Playoff state
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [playoffEncounters, setPlayoffEncounters] = useState({ team1: {}, team2: {} })
  const [playoffScores, setPlayoffScores] = useState({ team1: null, team2: null })
  const [playoffSaving, setPlayoffSaving] = useState(false)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    const [{ data: ev }, { data: divs }, { data: teamsData }, { data: cats }, { data: sched }, { data: scores }, { data: bracketData }, { data: bConfig }] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('divisions').select('*').eq('event_id', id).order('division_number'),
      supabase.from('teams').select('*').eq('event_id', id).order('team_number'),
      supabase.from('categories').select('*').eq('event_id', id).order('display_order'),
      supabase.from('schedule').select('*').eq('event_id', id),
      supabase.from('daily_scores').select('*, score_entries(*)').eq('event_id', id),
      supabase.from('playoff_bracket').select('*').eq('event_id', id).order('round_number').order('match_number'),
      supabase.from('bracket_round_config').select('*').eq('event_id', id),
    ])
    setEvent(ev)
    setDivisions(divs || [])
    setTeams(teamsData || [])
    setCategories(cats || [])
    setSchedule(sched || [])
    setExistingScores(scores || [])
    setBracket(bracketData || [])
    setBracketConfig(bConfig || [])
    if (teamsData?.length > 0) setSelectedTeam(teamsData[0])
    setLoading(false)
  }

  function calcPlayoffScore(teamKey) {
    const enc = playoffEncounters[teamKey] || {}
    const entries = categories.map(c => ({ category_id: c.id, encounter_count: enc[c.id] || 0 }))
    return calculateDayScore(entries, categories)
  }

  function handlePlayoffEncounterChange(teamKey, categoryId, value) {
    setPlayoffEncounters(prev => ({
      ...prev,
      [teamKey]: { ...prev[teamKey], [categoryId]: Math.max(0, parseInt(value) || 0) }
    }))
    setPlayoffScores({ team1: null, team2: null })
  }

  function calculatePlayoffPreview() {
    setPlayoffScores({ team1: calcPlayoffScore('team1'), team2: calcPlayoffScore('team2') })
  }

  async function savePlayoffMatch() {
    if (playoffScores.team1 === null || !selectedMatch) return
    setPlayoffSaving(true)
    setMessage(null)
    try {
      const s1 = playoffScores.team1
      const s2 = playoffScores.team2
      const roundCfg = bracketConfig.find(c => c.bracket_type === selectedMatch.bracket_type && c.round_number === selectedMatch.round_number)
      const format = roundCfg?.format || 'single'
      const newWins1 = (selectedMatch.series_wins_team1 || 0) + (s1 > s2 ? 1 : 0)
      const newWins2 = (selectedMatch.series_wins_team2 || 0) + (s2 > s1 ? 1 : 0)
      const seriesWinner = getSeriesWinner(newWins1, newWins2, format)
      const isFinalized = format === 'single' || seriesWinner !== null
      const winnerId = seriesWinner === 'team1' ? selectedMatch.team1_id : seriesWinner === 'team2' ? selectedMatch.team2_id : s1 > s2 ? selectedMatch.team1_id : s2 > s1 ? selectedMatch.team2_id : null

      const { error } = await supabase.from('playoff_bracket').update({
        team1_score: s1, team2_score: s2,
        winner_id: isFinalized ? winnerId : null,
        series_wins_team1: newWins1, series_wins_team2: newWins2,
        is_finalized: isFinalized,
      }).eq('id', selectedMatch.id)
      if (error) throw error

      // Advance winner to next round if match is finalized
      if (isFinalized && winnerId) {
        const nextRound = selectedMatch.round_number + 1

        // Fetch ALL current round matches fresh from DB to get correct index
        const { data: currentRoundFresh } = await supabase
          .from('playoff_bracket')
          .select('*')
          .eq('event_id', id)
          .eq('bracket_type', selectedMatch.bracket_type)
          .eq('round_number', selectedMatch.round_number)
          .order('match_number')

        const { data: nextRoundFresh } = await supabase
          .from('playoff_bracket')
          .select('*')
          .eq('event_id', id)
          .eq('bracket_type', selectedMatch.bracket_type)
          .eq('round_number', nextRound)
          .order('match_number')

        if (currentRoundFresh && nextRoundFresh && nextRoundFresh.length > 0) {
          const matchIndex = currentRoundFresh.findIndex(m => m.id === selectedMatch.id)
          const nextMatchIndex = Math.floor(matchIndex / 2)
          const nextMatch = nextRoundFresh[nextMatchIndex]

          if (nextMatch) {
            // Use fresh DB data to determine correct slot
            const updateField = !nextMatch.team1_id ? 'team1_id' : 'team2_id'
            await supabase.from('playoff_bracket')
              .update({ [updateField]: winnerId })
              .eq('id', nextMatch.id)
          }
        }
      }

      setMessage({ type: 'success', text: `Match result saved.${isFinalized ? ' Match finalized — winner advanced.' : ' Series continues.'}` })
      setSelectedMatch(null)
      setPlayoffEncounters({ team1: {}, team2: {} })
      setPlayoffScores({ team1: null, team2: null })
      await fetchAll()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setPlayoffSaving(false)
  }

  async function undoPlayoffMatch(match) {
    if (!confirm('Undo this match result?')) return
    await supabase.from('playoff_bracket').update({
      team1_score: null, team2_score: null, winner_id: null,
      series_wins_team1: 0, series_wins_team2: 0, is_finalized: false,
    }).eq('id', match.id)
    await fetchAll()
  }

  // All days from schedule
  const maxDay = schedule.length > 0 ? Math.max(...schedule.map(s => s.day_number)) : 1
  const days = Array.from({ length: maxDay }, (_, i) => i + 1)

  const getTeam = (teamId) => teams.find(t => t.id === teamId)
  const getExistingScore = (teamId, day) => existingScores.find(s => s.team_id === teamId && s.day_number === day)

  // Day is committable when ALL teams have unfinalized scores entered for the day
  const getDayStatus = (day) => {
    const dayScores = existingScores.filter(s => s.day_number === day)
    const finalizedCount = dayScores.filter(s => s.is_finalized).length
    const pendingCount = dayScores.filter(s => !s.is_finalized).length
    return { finalizedCount, pendingCount, total: teams.length, allScored: finalizedCount === teams.length }
  }

  function resetForm() {
    setEncounters({})
    setCalculatedScore(null)
    setPreviewOutcomes(null)
  }

  function handleTeamSelect(team) {
    setSelectedTeam(team)
    resetForm()
    setMessage(null)
    setUndoTarget(null)
    setCommitConfirm(false)
  }

  function handleEncounterChange(categoryId, value) {
    setEncounters(prev => ({ ...prev, [categoryId]: Math.max(0, parseInt(value) || 0) }))
    setCalculatedScore(null)
    setPreviewOutcomes(null)
  }

  function calculateAndPreview() {
    const entries = categories.map(c => ({
      category_id: c.id,
      encounter_count: encounters[c.id] || 0,
    }))
    const total = calculateDayScore(entries, categories)
    setCalculatedScore(total)

    const dayScheduleEntry = schedule.find(s =>
      s.day_number === selectedDay &&
      (s.home_team_id === selectedTeam.id || s.away_team_id === selectedTeam.id)
    )

    if (dayScheduleEntry) {
      const opponentId = dayScheduleEntry.home_team_id === selectedTeam.id
        ? dayScheduleEntry.away_team_id : dayScheduleEntry.home_team_id
      const opponentScore = getExistingScore(opponentId, selectedDay)

      if (opponentScore?.is_finalized) {
        const isHome = dayScheduleEntry.home_team_id === selectedTeam.id
        const homeScore = isHome ? total : opponentScore.calculated_total
        const awayScore = isHome ? opponentScore.calculated_total : total
        const { homePoints, awayPoints } = getMatchupPoints(homeScore, awayScore)

        setPreviewOutcomes({
          opponent: getTeam(opponentId),
          teamScore: total,
          opponentScore: opponentScore.calculated_total,
          teamPoints: isHome ? homePoints : awayPoints,
          opponentPoints: isHome ? awayPoints : homePoints,
        })
      }
    }
  }

  async function saveScore() {
    if (calculatedScore === null) return
    setSaving(true)
    setMessage(null)

    try {
      const entries = categories.map(c => ({
        category_id: c.id,
        encounter_count: encounters[c.id] || 0,
      }))

      const { data: scoreRow, error: scoreErr } = await supabase
        .from('daily_scores')
        .upsert({
          event_id: id,
          team_id: selectedTeam.id,
          day_number: selectedDay,
          is_finalized: false, // saved but not committed yet
          calculated_total: calculatedScore,
          submitted_by: profile.id,
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'team_id,day_number' })
        .select().single()
      if (scoreErr) throw scoreErr

      await supabase.from('score_entries').delete().eq('daily_score_id', scoreRow.id)
      if (entries.some(e => e.encounter_count > 0)) {
        await supabase.from('score_entries').insert(
          entries.filter(e => e.encounter_count > 0).map(e => ({
            daily_score_id: scoreRow.id,
            category_id: e.category_id,
            encounter_count: e.encounter_count,
          }))
        )
      }

      await fetchAll()
      resetForm()
      setMessage({ type: 'success', text: `Score saved for ${selectedTeam.display_name} — Day ${selectedDay}. Save all teams before committing the day.` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  async function commitDay() {
    setCommitting(true)
    setMessage(null)
    setCommitConfirm(false)

    try {
      // Finalize all saved scores for the day
      await supabase.from('daily_scores')
        .update({ is_finalized: true, updated_at: new Date().toISOString() })
        .eq('event_id', id)
        .eq('day_number', selectedDay)

      // Recalculate everything for the day
      await recalcDayOutcomes(selectedDay)
      await fetchAll()
      setMessage({ type: 'success', text: `Day ${selectedDay} committed! Head-to-head results and League Average have been calculated.` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setCommitting(false)
  }

  async function recalcDayOutcomes(dayNumber) {
    const { data: dayScores } = await supabase
      .from('daily_scores')
      .select('*')
      .eq('event_id', id)
      .eq('day_number', dayNumber)

    if (!dayScores?.length) return

    const finalizedScores = dayScores.filter(s => s.is_finalized)
    if (!finalizedScores.length) return

    const leagueAvg = calculateLeagueAverage(finalizedScores.map(s => s.calculated_total))

    const leagueAvgRows = finalizedScores.map(s => ({
      event_id: id,
      team_id: s.team_id,
      day_number: dayNumber,
      team_score: s.calculated_total,
      league_average_score: leagueAvg,
      team_points: s.calculated_total > leagueAvg ? 3 : s.calculated_total < leagueAvg ? 1 : 2,
      is_calculated: true,
      calculated_at: new Date().toISOString(),
    }))

    await supabase.from('league_average_outcomes')
      .upsert(leagueAvgRows, { onConflict: 'team_id,day_number' })

    const dayScheduleEntries = schedule.filter(s => s.day_number === dayNumber)
    const scoreMap = Object.fromEntries(finalizedScores.map(s => [s.team_id, s.calculated_total]))

    for (const matchup of dayScheduleEntries) {
      const homeScore = scoreMap[matchup.home_team_id]
      const awayScore = scoreMap[matchup.away_team_id]
      if (homeScore === undefined || awayScore === undefined) continue

      const { homePoints, awayPoints } = getMatchupPoints(homeScore, awayScore)
      await supabase.from('matchup_outcomes').upsert({
        event_id: id,
        schedule_id: matchup.id,
        day_number: dayNumber,
        home_team_id: matchup.home_team_id,
        away_team_id: matchup.away_team_id,
        home_score: homeScore,
        away_score: awayScore,
        home_points: homePoints,
        away_points: awayPoints,
        is_calculated: true,
        calculated_at: new Date().toISOString(),
      }, { onConflict: 'schedule_id' })
    }

    const { data: allOutcomes } = await supabase.from('matchup_outcomes').select('*').eq('event_id', id)
    const { data: allLeagueAvg } = await supabase.from('league_average_outcomes').select('*').eq('event_id', id)
    const { data: allScores } = await supabase.from('daily_scores').select('*').eq('event_id', id)
    const { data: allTeams } = await supabase.from('teams').select('*').eq('event_id', id)

    const newStandings = recalculateStandings(allTeams || [], allOutcomes || [], allLeagueAvg || [], allScores || [])
    for (const s of newStandings) {
      await supabase.from('standings').upsert({ ...s, updated_at: new Date().toISOString() }, { onConflict: 'event_id,team_id' })
    }
  }

  async function handleUndo(teamId, day) {
    setSaving(true)
    setMessage(null)
    try {
      await supabase.from('daily_scores')
        .delete()
        .eq('event_id', id)
        .eq('team_id', teamId)
        .eq('day_number', day)

      const affected = schedule.filter(s =>
        s.day_number === day && (s.home_team_id === teamId || s.away_team_id === teamId)
      )
      for (const s of affected) {
        await supabase.from('matchup_outcomes').delete().eq('schedule_id', s.id)
      }

      // Revert league avg and standings for the day
      await supabase.from('league_average_outcomes')
        .delete().eq('event_id', id).eq('day_number', day)

      await recalcDayOutcomes(day)
      await fetchAll()
      setUndoTarget(null)
      setMessage({ type: 'info', text: `Score for Day ${day} removed. Re-enter and save to correct it.` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  if (loading) return <><Navbar /><div className="loading-screen"><div className="spinner" /></div></>
  if (!event) return <><Navbar /><div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div></>

  const dayStatus = getDayStatus(selectedDay)
  const existingTeamScore = selectedTeam ? getExistingScore(selectedTeam.id, selectedDay) : null
  const isScored = !!existingTeamScore
  const isFinalized = existingTeamScore?.is_finalized
  const canCommit = !dayStatus.allScored && teams.every(t => !!getExistingScore(t.id, selectedDay))
  const allSavedForDay = teams.length > 0 && teams.every(t => !!getExistingScore(t.id, selectedDay))

  const activeBracket = bracket.filter(m => !m.is_bye)
  const pendingMatches = activeBracket.filter(m => !m.is_finalized && m.team1_id && m.team2_id)
  const completedMatches = activeBracket.filter(m => m.is_finalized)
  const maxBracketRound = activeBracket.reduce((max, m) => Math.max(max, m.round_number), 0)

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">{event.name} → Score Entry</div>
          <h1>Daily Score Entry</h1>
        </div>

        <div className="page-content">
          {message && <div className={`alert alert-${message.type}`} style={{ marginBottom: '1.5rem' }}>{message.text}</div>}

          {event.status === 'playoffs' && (
            <div className="tab-bar" style={{ marginBottom: '1.5rem' }}>
              <button className={`tab-btn ${activeTab === 'roundrobin' ? 'active' : ''}`} onClick={() => setActiveTab('roundrobin')}>Round Robin</button>
              <button className={`tab-btn ${activeTab === 'playoffs' ? 'active' : ''}`} onClick={() => setActiveTab('playoffs')}>
                Playoffs {pendingMatches.length > 0 && <span style={{ marginLeft: '0.3rem', background: 'var(--accent-red)', color: '#fff', borderRadius: 8, padding: '0 5px', fontSize: '0.7rem' }}>{pendingMatches.length}</span>}
              </button>
            </div>
          )}

          {/* ── Playoffs Tab ── */}
          {activeTab === 'playoffs' && event.status === 'playoffs' && (
            <div>
              {pendingMatches.length > 0 && (
                <div style={{ marginBottom: '2rem' }}>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-gold)', marginBottom: '1rem' }}>Pending Matches</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {pendingMatches.map(match => {
                      const t1 = getTeam(match.team1_id)
                      const t2 = getTeam(match.team2_id)
                      const roundCfg = bracketConfig.find(c => c.bracket_type === match.bracket_type && c.round_number === match.round_number)
                      const isSelected = selectedMatch?.id === match.id
                      return (
                        <div key={match.id} className="card" style={{ borderColor: isSelected ? 'var(--accent-gold)' : 'var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isSelected ? '1.5rem' : 0 }}>
                            <div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                                {match.bracket_type === 'winners' ? "Winner's" : "Loser's"} — {getRoundName(match.round_number, maxBracketRound, match.bracket_type)}
                                {roundCfg && roundCfg.format !== 'single' && <span style={{ marginLeft: '0.5rem' }}>({roundCfg.format.replace(/_/g, ' ')})</span>}
                              </div>
                              <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                                {t1?.display_name || '?'} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>vs</span> {t2?.display_name || '?'}
                              </div>
                              {(match.series_wins_team1 > 0 || match.series_wins_team2 > 0) && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                  Series: {t1?.display_name} {match.series_wins_team1}–{match.series_wins_team2} {t2?.display_name}
                                </div>
                              )}
                            </div>
                            <button className={`btn btn-sm ${isSelected ? 'btn-secondary' : 'btn-primary'}`} onClick={() => {
                              if (isSelected) { setSelectedMatch(null); setPlayoffEncounters({ team1: {}, team2: {} }); setPlayoffScores({ team1: null, team2: null }) }
                              else { setSelectedMatch(match); setPlayoffEncounters({ team1: {}, team2: {} }); setPlayoffScores({ team1: null, team2: null }) }
                            }}>{isSelected ? 'Cancel' : 'Enter Scores'}</button>
                          </div>

                          {isSelected && (
                            <div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1rem' }}>
                                {['team1', 'team2'].map(teamKey => {
                                  const team = teamKey === 'team1' ? t1 : t2
                                  return (
                                    <div key={teamKey}>
                                      <div style={{ fontWeight: 700, marginBottom: '0.75rem', color: 'var(--accent-gold)' }}>{team?.display_name}</div>
                                      {categories.map(cat => (
                                        <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                          <div style={{ flex: 2, fontSize: '0.85rem' }}>
                                            <div style={{ fontWeight: 600 }}>{cat.name}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{cat.multiplier}×</div>
                                          </div>
                                          <input type="number" min="0" className="form-input"
                                            style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
                                            value={playoffEncounters[teamKey][cat.id] ?? ''}
                                            onChange={e => handlePlayoffEncounterChange(teamKey, cat.id, e.target.value)}
                                            placeholder="0" />
                                          <div style={{ flex: 1, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--accent-gold)' }}>
                                            {((playoffEncounters[teamKey][cat.id] || 0) * cat.multiplier).toFixed(1)}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )
                                })}
                              </div>
                              <button className="btn btn-secondary" onClick={calculatePlayoffPreview} style={{ marginBottom: '1rem' }}>Preview & Calculate</button>
                              {playoffScores.team1 !== null && (
                                <>
                                  <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', marginBottom: '1rem', border: '1px solid var(--border-bright)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <div style={{ textAlign: 'center', flex: 1 }}>
                                        <div style={{ fontWeight: 700 }}>{t1?.display_name}</div>
                                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 900, color: playoffScores.team1 > playoffScores.team2 ? 'var(--win)' : playoffScores.team1 < playoffScores.team2 ? 'var(--loss)' : 'var(--tie)' }}>
                                          {formatScore(playoffScores.team1)}
                                        </div>
                                      </div>
                                      <div style={{ color: 'var(--text-muted)', fontWeight: 900, fontSize: '0.75rem' }}>VS</div>
                                      <div style={{ textAlign: 'center', flex: 1 }}>
                                        <div style={{ fontWeight: 700 }}>{t2?.display_name}</div>
                                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 900, color: playoffScores.team2 > playoffScores.team1 ? 'var(--win)' : playoffScores.team2 < playoffScores.team1 ? 'var(--loss)' : 'var(--tie)' }}>
                                          {formatScore(playoffScores.team2)}
                                        </div>
                                      </div>
                                    </div>
                                    {playoffScores.team1 === playoffScores.team2 && (
                                      <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--accent-gold)' }}>
                                        Tie — tiebreakers: League Average W record, then average daily score from round robin
                                      </div>
                                    )}
                                  </div>
                                  <button className="btn btn-primary btn-lg" onClick={savePlayoffMatch} disabled={playoffSaving} style={{ width: '100%', justifyContent: 'center' }}>
                                    {playoffSaving ? 'Saving...' : 'Save Match Result'}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {completedMatches.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '1rem' }}>Completed Matches</h3>
                  <div className="card" style={{ padding: 0 }}>
                    <div className="table-container">
                      <table>
                        <thead><tr><th>Round</th><th>Team 1</th><th style={{ textAlign: 'center' }}>Score</th><th>Team 2</th><th style={{ textAlign: 'center' }}>Score</th><th>Winner</th><th></th></tr></thead>
                        <tbody>
                          {completedMatches.map(match => {
                            const t1 = getTeam(match.team1_id)
                            const t2 = getTeam(match.team2_id)
                            const winner = getTeam(match.winner_id)
                            return (
                              <tr key={match.id}>
                                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{match.bracket_type === 'winners' ? 'W' : 'L'} R{match.round_number}</td>
                                <td style={{ fontWeight: match.winner_id === match.team1_id ? 700 : 400 }}>{t1?.display_name || '—'}</td>
                                <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: match.winner_id === match.team1_id ? 'var(--win)' : 'var(--loss)' }}>{formatScore(match.team1_score)}</td>
                                <td style={{ fontWeight: match.winner_id === match.team2_id ? 700 : 400 }}>{t2?.display_name || '—'}</td>
                                <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: match.winner_id === match.team2_id ? 'var(--win)' : 'var(--loss)' }}>{formatScore(match.team2_score)}</td>
                                <td style={{ color: 'var(--win)', fontWeight: 700 }}>{winner?.display_name || '—'}</td>
                                <td><button className="btn btn-danger btn-sm" onClick={() => undoPlayoffMatch(match)}>Undo</button></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {pendingMatches.length === 0 && completedMatches.length === 0 && (
                <div className="empty-state">
                  <div className="empty-state-icon">🏆</div>
                  <h3>No Bracket Matches</h3>
                  <p>Generate the bracket from the Manage Event page first.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Round Robin Tab ── */}
          {(activeTab === 'roundrobin' || event.status !== 'playoffs') && (
            <div className="rr-tab-wrapper">
            <div className="grid-2" style={{ marginBottom: '1.5rem', alignItems: 'start' }}>
            <div className="card">
              <div className="card-title">Select Day</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {days.map(day => {
                  const ds = getDayStatus(day)
                  return (
                    <button key={day}
                      className={`btn btn-sm ${selectedDay === day ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => { setSelectedDay(day); resetForm(); setUndoTarget(null); setCommitConfirm(false) }}>
                      Day {day}
                      {ds.allScored && <span style={{ marginLeft: '0.3rem', color: ds.allScored ? 'var(--win)' : 'inherit' }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-title">Select Team</div>
              <select className="form-select" value={selectedTeam?.id || ''} onChange={e => {
                handleTeamSelect(teams.find(t => t.id === e.target.value))
              }}>
                {divisions.map(div => (
                  <optgroup key={div.id} label={div.name}>
                    {teams.filter(t => t.division_id === div.id).map(team => {
                      const score = getExistingScore(team.id, selectedDay)
                      return (
                        <option key={team.id} value={team.id}>
                          {team.display_name} {score?.is_finalized ? '✓ committed' : score ? '· saved' : ''}
                        </option>
                      )
                    })}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* Day commit panel */}
          <div className="card" style={{ marginBottom: '1.5rem', borderColor: dayStatus.allScored ? 'rgba(46,196,182,0.3)' : allSavedForDay ? 'rgba(245,200,66,0.3)' : 'var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <div className="card-title" style={{ margin: 0 }}>Day {selectedDay} Status</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {dayStatus.allScored
                    ? <span style={{ color: 'var(--win)' }}>✓ All scores committed — results calculated</span>
                    : allSavedForDay
                    ? <span style={{ color: 'var(--tie)' }}>All scores saved — ready to commit</span>
                    : `${existingScores.filter(s => s.day_number === selectedDay).length} of ${teams.length} teams scored`
                  }
                </div>
              </div>

              {!dayStatus.allScored && allSavedForDay && (
                <div>
                  {!commitConfirm ? (
                    <button className="btn btn-primary" onClick={() => setCommitConfirm(true)} disabled={committing}>
                      Commit Day {selectedDay} →
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--accent-gold)' }}>Finalize all scores?</span>
                      <button className="btn btn-primary btn-sm" onClick={commitDay} disabled={committing}>
                        {committing ? 'Committing...' : 'Yes, Commit'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setCommitConfirm(false)}>Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* All teams status strip */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '1rem' }}>
              {teams.map(team => {
                const score = getExistingScore(team.id, selectedDay)
                return (
                  <div key={team.id}
                    onClick={() => handleTeamSelect(team)}
                    style={{
                      padding: '0.35rem 0.65rem',
                      borderRadius: 'var(--radius)',
                      border: `1px solid ${team.id === selectedTeam?.id ? 'var(--accent-gold)' : score?.is_finalized ? 'rgba(46,196,182,0.3)' : score ? 'rgba(245,200,66,0.3)' : 'var(--border)'}`,
                      background: team.id === selectedTeam?.id ? 'rgba(245,200,66,0.1)' : score?.is_finalized ? 'rgba(46,196,182,0.05)' : score ? 'rgba(245,200,66,0.05)' : 'transparent',
                      cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                    }}>
                    {team.display_name}
                    {score?.is_finalized && <span style={{ marginLeft: '0.3rem', fontFamily: 'var(--font-mono)', color: 'var(--win)' }}>{formatScore(score.calculated_total)}</span>}
                    {score && !score.is_finalized && <span style={{ marginLeft: '0.3rem', fontFamily: 'var(--font-mono)', color: 'var(--tie)' }}>{formatScore(score.calculated_total)}</span>}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Score entry for selected team */}
          {selectedTeam && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <div className="card-title" style={{ margin: 0 }}>{selectedTeam.display_name} — Day {selectedDay}</div>
                  {isFinalized && (
                    <div style={{ marginTop: '0.25rem' }}>
                      <span className="badge badge-active">Committed</span>
                      <span style={{ marginLeft: '0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-gold)', fontWeight: 700 }}>
                        {formatScore(existingTeamScore.calculated_total)} pts
                      </span>
                    </div>
                  )}
                  {isScored && !isFinalized && (
                    <div style={{ marginTop: '0.25rem' }}>
                      <span className="badge badge-setup">Saved</span>
                      <span style={{ marginLeft: '0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--tie)', fontWeight: 700 }}>
                        {formatScore(existingTeamScore.calculated_total)} pts
                      </span>
                    </div>
                  )}
                </div>

                {isScored && (
                  <button className="btn btn-danger btn-sm"
                    onClick={() => setUndoTarget({ teamId: selectedTeam.id, day: selectedDay })}
                    disabled={saving}>
                    {isFinalized ? 'Undo & Correct' : 'Clear Score'}
                  </button>
                )}
              </div>

              {undoTarget && (
                <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
                  <strong>Heads up:</strong> {isFinalized
                    ? `Removing this score will reverse Day ${selectedDay}'s results including the League Average, affecting all teams' standings.`
                    : `This will clear the saved score for Day ${selectedDay}.`
                  } Continue?
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button className="btn btn-danger btn-sm" disabled={saving}
                      onClick={() => handleUndo(undoTarget.teamId, undoTarget.day)}>
                      {saving ? 'Removing...' : 'Yes, Remove Score'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setUndoTarget(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Encounter inputs — show even if already scored so they can correct before committing */}
              {!isFinalized && (
                <>
                  <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    {categories.map(cat => (
                      <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ flex: 2 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{cat.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{cat.multiplier} pts per encounter</div>
                        </div>
                        <input type="number" min="0" className="form-input"
                          style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
                          value={encounters[cat.id] ?? (existingTeamScore?.score_entries?.find(e => e.category_id === cat.id)?.encounter_count ?? '')}
                          onChange={e => handleEncounterChange(cat.id, e.target.value)}
                          placeholder="0" />
                        <div style={{ flex: 1, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent-gold)' }}>
                          {((encounters[cat.id] ?? existingTeamScore?.score_entries?.find(e => e.category_id === cat.id)?.encounter_count ?? 0) * cat.multiplier).toFixed(1)} pts
                        </div>
                      </div>
                    ))}
                  </div>

                  <button className="btn btn-secondary" onClick={calculateAndPreview} style={{ marginBottom: '1rem' }}>
                    Preview & Calculate
                  </button>

                  {calculatedScore !== null && (
                    <div style={{ padding: '1.25rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', marginBottom: '1rem', border: '1px solid var(--border-bright)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: previewOutcomes ? '1rem' : 0 }}>
                        <span style={{ fontWeight: 700 }}>Calculated Total</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 900, color: 'var(--accent-gold)' }}>
                          {formatScore(calculatedScore)}
                        </span>
                      </div>

                      {previewOutcomes && (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                            Projected Matchup Outcome
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{selectedTeam.display_name}</div>
                              <div style={{ fontFamily: 'var(--font-mono)' }}>{formatScore(previewOutcomes.teamScore)}</div>
                            </div>
                            <span className={`badge badge-${previewOutcomes.teamPoints === 3 ? 'win' : previewOutcomes.teamPoints === 1 ? 'loss' : 'tie'}`} style={{ fontSize: '1rem', padding: '0.3rem 0.75rem' }}>
                              {getPointLabel(previewOutcomes.teamPoints)} ({previewOutcomes.teamPoints} pts)
                            </span>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{previewOutcomes.opponent?.display_name}</div>
                              <div style={{ fontFamily: 'var(--font-mono)' }}>{formatScore(previewOutcomes.opponentScore)}</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {calculatedScore !== null && (
                    <button className="btn btn-primary btn-lg" onClick={saveScore} disabled={saving}
                      style={{ width: '100%', justifyContent: 'center' }}>
                      {saving ? 'Saving...' : `Save Score — ${formatScore(calculatedScore)} pts`}
                    </button>
                  )}
                </>
              )}

              {isFinalized && existingTeamScore.score_entries?.length > 0 && (
                <div>
                  <div className="card-title">Score Breakdown</div>
                  {existingTeamScore.score_entries.map(entry => {
                    const cat = categories.find(c => c.id === entry.category_id)
                    return (
                      <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
                        <span>{cat?.name || 'Unknown'}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{entry.encounter_count} × {cat?.multiplier}</span>
                        <span className="mono" style={{ color: 'var(--accent-gold)' }}>
                          {formatScore(entry.encounter_count * (cat?.multiplier || 1))}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )} {/* end selectedTeam */}
          </div>
          )} {/* end rr tab */}
        </div>
      </div>
    </>
  )
}
