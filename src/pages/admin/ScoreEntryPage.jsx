import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import Navbar from '../../components/Navbar'
import {
  calculateDayScore, calculateLeagueAverage,
  getMatchupPoints, recalculateStandings, formatScore, getPointLabel
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
  const [loading, setLoading] = useState(true)

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

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    const [{ data: ev }, { data: divs }, { data: teamsData }, { data: cats }, { data: sched }, { data: scores }] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('divisions').select('*').eq('event_id', id).order('division_number'),
      supabase.from('teams').select('*').eq('event_id', id).order('team_number'),
      supabase.from('categories').select('*').eq('event_id', id).order('display_order'),
      supabase.from('schedule').select('*').eq('event_id', id),
      supabase.from('daily_scores').select('*, score_entries(*)').eq('event_id', id)
    ])
    setEvent(ev)
    setDivisions(divs || [])
    setTeams(teamsData || [])
    setCategories(cats || [])
    setSchedule(sched || [])
    setExistingScores(scores || [])
    if (teamsData?.length > 0) setSelectedTeam(teamsData[0])
    setLoading(false)
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
          )}
        </div>
      </div>
    </>
  )
}
