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
  const [message, setMessage] = useState(null)
  const [undoTarget, setUndoTarget] = useState(null)

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

    // Auto-select first team
    if (teamsData?.length > 0) setSelectedTeam(teamsData[0])
    setLoading(false)
  }

  // Max day = last round robin day
  const maxDay = Math.max(...(schedule.map(s => s.day_number) || [1]), 1)
  const days = Array.from({ length: maxDay }, (_, i) => i + 1)

  const getTeam = (teamId) => teams.find(t => t.id === teamId)

  const getExistingScore = (teamId, day) =>
    existingScores.find(s => s.team_id === teamId && s.day_number === day)

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

    // Get day's matchup for this team
    const dayScheduleEntry = schedule.find(s =>
      s.day_number === selectedDay &&
      (s.home_team_id === selectedTeam.id || s.away_team_id === selectedTeam.id)
    )

    if (dayScheduleEntry) {
      const opponentId = dayScheduleEntry.home_team_id === selectedTeam.id
        ? dayScheduleEntry.away_team_id
        : dayScheduleEntry.home_team_id
      const opponentScore = getExistingScore(opponentId, selectedDay)

      if (opponentScore?.is_finalized) {
        const isHome = dayScheduleEntry.home_team_id === selectedTeam.id
        const homeScore = isHome ? total : opponentScore.calculated_total
        const awayScore = isHome ? opponentScore.calculated_total : total
        const { homePoints, awayPoints } = getMatchupPoints(homeScore, awayScore)

        setPreviewOutcomes({
          type: 'matchup',
          opponent: getTeam(opponentId),
          teamScore: total,
          opponentScore: opponentScore.calculated_total,
          teamPoints: isHome ? homePoints : awayPoints,
          opponentPoints: isHome ? awayPoints : homePoints,
          scheduleId: dayScheduleEntry.id,
          isHome,
        })
      }
    }
  }

  async function submitScore() {
    if (calculatedScore === null) return
    setSaving(true)
    setMessage(null)

    try {
      const entries = categories.map(c => ({
        category_id: c.id,
        encounter_count: encounters[c.id] || 0,
      }))

      // Upsert daily score
      const { data: scoreRow, error: scoreErr } = await supabase
        .from('daily_scores')
        .upsert({
          event_id: id,
          team_id: selectedTeam.id,
          day_number: selectedDay,
          is_finalized: true,
          calculated_total: calculatedScore,
          submitted_by: profile.id,
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'team_id,day_number' })
        .select().single()
      if (scoreErr) throw scoreErr

      // Delete and re-insert score entries
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

      // Recalculate league average and outcomes for the day
      await recalcDayOutcomes(selectedDay, scoreRow)

      // Refresh data
      await fetchAll()
      resetForm()
      setMessage({ type: 'success', text: `Score submitted for ${selectedTeam.display_name} — Day ${selectedDay}` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  async function recalcDayOutcomes(dayNumber, newScoreRow) {
    // Get all finalized scores for this day (including the new one)
    const { data: dayScores } = await supabase
      .from('daily_scores')
      .select('*')
      .eq('event_id', id)
      .eq('day_number', dayNumber)
      .eq('is_finalized', true)

    if (!dayScores?.length) return

    const leagueAvg = calculateLeagueAverage(dayScores.map(s => s.calculated_total))

    // Upsert league average outcomes for all teams scored today
    const leagueAvgRows = dayScores.map(s => {
      const { homePoints: teamPoints } = getMatchupPoints(s.calculated_total, leagueAvg)
      const actualPoints = s.calculated_total > leagueAvg ? 3 : s.calculated_total < leagueAvg ? 1 : 2
      return {
        event_id: id,
        team_id: s.team_id,
        day_number: dayNumber,
        team_score: s.calculated_total,
        league_average_score: leagueAvg,
        team_points: actualPoints,
        is_calculated: true,
        calculated_at: new Date().toISOString(),
      }
    })

    await supabase.from('league_average_outcomes')
      .upsert(leagueAvgRows, { onConflict: 'team_id,day_number' })

    // Calculate head-to-head matchup outcomes for this day
    const dayScheduleEntries = schedule.filter(s => s.day_number === dayNumber)
    const scoreMap = Object.fromEntries(dayScores.map(s => [s.team_id, s.calculated_total]))

    for (const matchup of dayScheduleEntries) {
      const homeScore = scoreMap[matchup.home_team_id]
      const awayScore = scoreMap[matchup.away_team_id]
      if (homeScore === undefined || awayScore === undefined) continue

      const { homePoints, awayPoints } = getMatchupPoints(homeScore, awayScore)
      await supabase.from('matchup_outcomes')
        .upsert({
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

    // Recalculate full standings
    const { data: allOutcomes } = await supabase.from('matchup_outcomes').select('*').eq('event_id', id)
    const { data: allLeagueAvg } = await supabase.from('league_average_outcomes').select('*').eq('event_id', id)
    const { data: allScores } = await supabase.from('daily_scores').select('*').eq('event_id', id)

    const { data: allTeams } = await supabase.from('teams').select('*').eq('event_id', id)
    const newStandings = recalculateStandings(allTeams || [], allOutcomes || [], allLeagueAvg || [], allScores || [])

    for (const s of newStandings) {
      await supabase.from('standings')
        .upsert({ ...s, updated_at: new Date().toISOString() }, { onConflict: 'event_id,team_id' })
    }
  }

  async function handleUndo(teamId, day) {
    setSaving(true)
    setMessage(null)
    try {
      // Remove finalized flag (soft undo)
      await supabase.from('daily_scores')
        .update({ is_finalized: false, updated_at: new Date().toISOString() })
        .eq('event_id', id)
        .eq('team_id', teamId)
        .eq('day_number', day)

      // Delete matchup outcomes for affected matchups
      const affected = schedule.filter(s =>
        s.day_number === day &&
        (s.home_team_id === teamId || s.away_team_id === teamId)
      )
      for (const s of affected) {
        await supabase.from('matchup_outcomes').delete().eq('schedule_id', s.id)
      }

      // Recalculate league avg and standings from remaining finalized scores
      await recalcDayOutcomes(day, null)
      await fetchAll()

      setUndoTarget(null)
      setMessage({ type: 'info', text: `Score for Day ${day} unfinalized. You can now re-enter and recalculate.` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  if (loading) return <><Navbar /><div className="loading-screen"><div className="spinner" /></div></>
  if (!event) return <><Navbar /><div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div></>

  const existingTeamScore = selectedTeam ? getExistingScore(selectedTeam.id, selectedDay) : null
  const isScored = existingTeamScore?.is_finalized

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">{event.name} → Score Entry</div>
          <h1>Daily Score Entry</h1>
        </div>

        <div className="page-content">
          {message && (
            <div className={`alert alert-${message.type}`} style={{ marginBottom: '1.5rem' }}>
              {message.text}
            </div>
          )}

          <div className="grid-2" style={{ marginBottom: '1.5rem', alignItems: 'start' }}>
            {/* Day Selector */}
            <div className="card">
              <div className="card-title">Select Day</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {days.map(day => (
                  <button key={day}
                    className={`btn btn-sm ${selectedDay === day ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => { setSelectedDay(day); resetForm(); setUndoTarget(null) }}>
                    Day {day}
                  </button>
                ))}
              </div>
            </div>

            {/* Team Selector */}
            <div className="card">
              <div className="card-title">Select Team</div>
              <select className="form-select" value={selectedTeam?.id || ''} onChange={e => {
                handleTeamSelect(teams.find(t => t.id === e.target.value))
              }}>
                {divisions.map(div => (
                  <optgroup key={div.id} label={div.name}>
                    {teams.filter(t => t.division_id === div.id).map(team => {
                      const scored = getExistingScore(team.id, selectedDay)?.is_finalized
                      return (
                        <option key={team.id} value={team.id}>
                          {team.display_name} {scored ? '✓' : ''}
                        </option>
                      )
                    })}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {selectedTeam && (
            <>
              {/* Day summary for all teams */}
              <div className="card" style={{ marginBottom: '1.5rem' }}>
                <div className="card-title">Day {selectedDay} — All Teams Status</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {teams.map(team => {
                    const score = getExistingScore(team.id, selectedDay)
                    return (
                      <div key={team.id}
                        onClick={() => handleTeamSelect(team)}
                        style={{
                          padding: '0.4rem 0.75rem',
                          borderRadius: 'var(--radius)',
                          border: `1px solid ${team.id === selectedTeam.id ? 'var(--accent-gold)' : score?.is_finalized ? 'rgba(46,196,182,0.3)' : 'var(--border)'}`,
                          background: team.id === selectedTeam.id ? 'rgba(245,200,66,0.1)' : score?.is_finalized ? 'rgba(46,196,182,0.05)' : 'transparent',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                        }}>
                        {team.display_name}
                        {score?.is_finalized && (
                          <span style={{ marginLeft: '0.4rem', fontFamily: 'var(--font-mono)', color: 'var(--win)' }}>
                            {formatScore(score.calculated_total)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Score entry for selected team */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div>
                    <div className="card-title" style={{ margin: 0 }}>
                      {selectedTeam.display_name} — Day {selectedDay}
                    </div>
                    {isScored && (
                      <div style={{ marginTop: '0.25rem' }}>
                        <span className="badge badge-active">Submitted</span>
                        <span style={{ marginLeft: '0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-gold)', fontWeight: 700 }}>
                          {formatScore(existingTeamScore.calculated_total)} pts
                        </span>
                      </div>
                    )}
                  </div>

                  {isScored && (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setUndoTarget({ teamId: selectedTeam.id, day: selectedDay })}
                      disabled={saving}>
                      Undo Score
                    </button>
                  )}
                </div>

                {/* Undo confirmation */}
                {undoTarget && (
                  <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
                    <strong>Heads up:</strong> Undoing this score will also recalculate the League Average for Day {selectedDay},
                    which may affect other teams' standings. Continue?
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button className="btn btn-danger btn-sm" disabled={saving}
                        onClick={() => handleUndo(undoTarget.teamId, undoTarget.day)}>
                        {saving ? 'Undoing...' : 'Yes, Undo Score'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setUndoTarget(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Encounter inputs */}
                {!isScored && (
                  <>
                    <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem' }}>
                      {categories.map(cat => (
                        <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ flex: 2 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{cat.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{cat.multiplier} pts per encounter</div>
                          </div>
                          <input
                            type="number"
                            min="0"
                            className="form-input"
                            style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
                            value={encounters[cat.id] || ''}
                            onChange={e => handleEncounterChange(cat.id, e.target.value)}
                            placeholder="0"
                          />
                          <div style={{ flex: 1, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent-gold)' }}>
                            {((encounters[cat.id] || 0) * cat.multiplier).toFixed(1)} pts
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Calculate button */}
                    <button className="btn btn-secondary" onClick={calculateAndPreview}
                      style={{ marginBottom: '1rem' }}>
                      Preview & Calculate
                    </button>

                    {/* Score preview */}
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
                      <button className="btn btn-primary btn-lg" onClick={submitScore} disabled={saving}
                        style={{ width: '100%', justifyContent: 'center' }}>
                        {saving ? 'Submitting...' : `Submit Score — ${formatScore(calculatedScore)} pts`}
                      </button>
                    )}
                  </>
                )}

                {/* Show existing score breakdown */}
                {isScored && existingTeamScore.score_entries?.length > 0 && (
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
            </>
          )}
        </div>
      </div>
    </>
  )
}
