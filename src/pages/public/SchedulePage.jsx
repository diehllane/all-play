import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Navbar from '../../components/Navbar'
import { formatScore, getPointLabel } from '../../lib/scoring'

export default function SchedulePage() {
  const { slug } = useParams()
  const [event, setEvent] = useState(null)
  const [divisions, setDivisions] = useState([])
  const [schedule, setSchedule] = useState([])
  const [teams, setTeams] = useState([])
  const [outcomes, setOutcomes] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeDay, setActiveDay] = useState(1)

  useEffect(() => { fetchAll() }, [slug])

  async function fetchAll() {
    const { data: ev } = await supabase.from('events').select('*').eq('slug', slug).single()
    if (!ev) { setLoading(false); return }
    setEvent(ev)

    const [{ data: divs }, { data: sched }, { data: teamsData }, { data: outData }] = await Promise.all([
      supabase.from('divisions').select('*').eq('event_id', ev.id).order('division_number'),
      supabase.from('schedule').select('*').eq('event_id', ev.id).order('day_number'),
      supabase.from('teams').select('*').eq('event_id', ev.id).order('team_number'),
      supabase.from('matchup_outcomes').select('*').eq('event_id', ev.id)
    ])

    setDivisions(divs || [])
    setSchedule(sched || [])
    setTeams(teamsData || [])
    setOutcomes(outData || [])
    setLoading(false)
  }

  const getTeam = (id) => teams.find(t => t.id === id)
  const getOutcome = (scheduleId) => outcomes.find(o => o.schedule_id === scheduleId)
  const maxDay = schedule.reduce((max, s) => Math.max(max, s.day_number), 0)
  const days = Array.from({ length: maxDay }, (_, i) => i + 1)

  if (loading) return <><Navbar /><div className="loading-screen"><div className="spinner" /></div></>
  if (!event) return <><Navbar /><div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div></>

  const daySchedule = schedule.filter(s => s.day_number === activeDay)

  return (
    <>
      <Navbar eventSlug={slug} eventName={event.name} />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">{event.name}</div>
          <h1>Round Robin Schedule</h1>
          <div className="page-header-actions">
            <Link to={`/events/${slug}/standings`} className="btn btn-secondary btn-sm">Standings</Link>
            <Link to={`/events/${slug}/bracket`} className="btn btn-secondary btn-sm">Playoff Bracket</Link>
          </div>
        </div>

        <div className="page-content">
          {maxDay === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📅</div>
              <h3>Schedule Not Generated</h3>
              <p>The event runner will generate the schedule once teams are finalized.</p>
            </div>
          ) : (
            <>
              <div className="tab-bar" style={{ marginBottom: '1.5rem' }}>
                {days.map(day => (
                  <button key={day} className={`tab-btn ${activeDay === day ? 'active' : ''}`}
                    onClick={() => setActiveDay(day)}>
                    Day {day}
                  </button>
                ))}
              </div>

              {divisions.map(div => {
                const divDaySchedule = daySchedule.filter(s => s.division_id === div.id)
                if (divDaySchedule.length === 0) return null
                return (
                  <div key={div.id} style={{ marginBottom: '2rem' }}>
                    <h3 style={{ fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-gold)', marginBottom: '0.75rem' }}>
                      {div.name}
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {divDaySchedule.map(matchup => {
                        const homeTeam = getTeam(matchup.home_team_id)
                        const awayTeam = getTeam(matchup.away_team_id)
                        const outcome = getOutcome(matchup.id)

                        return (
                          <div key={matchup.id} className="card" style={{ padding: '1rem 1.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                              {/* Home */}
                              <div style={{ flex: 1, textAlign: 'right' }}>
                                <div style={{ fontWeight: 700, fontSize: '0.975rem' }}>{homeTeam?.display_name || '—'}</div>
                                {outcome?.is_calculated && (
                                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', color: outcome.home_points === 3 ? 'var(--win)' : outcome.home_points === 1 ? 'var(--loss)' : 'var(--tie)' }}>
                                    {formatScore(outcome.home_score)}
                                    <span style={{ fontSize: '0.7rem', marginLeft: '0.4rem' }}>{getPointLabel(outcome.home_points)}</span>
                                  </div>
                                )}
                              </div>

                              {/* VS */}
                              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.1em', minWidth: '40px' }}>
                                {outcome?.is_calculated ? 'FINAL' : 'VS'}
                              </div>

                              {/* Away */}
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: '0.975rem' }}>{awayTeam?.display_name || '—'}</div>
                                {outcome?.is_calculated && (
                                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', color: outcome.away_points === 3 ? 'var(--win)' : outcome.away_points === 1 ? 'var(--loss)' : 'var(--tie)' }}>
                                    {formatScore(outcome.away_score)}
                                    <span style={{ fontSize: '0.7rem', marginLeft: '0.4rem' }}>{getPointLabel(outcome.away_points)}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </>
  )
}
