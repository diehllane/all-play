import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Navbar from '../../components/Navbar'
import { sortStandings, formatScore, getPointLabel } from '../../lib/scoring'

export default function StandingsPage() {
  const { slug } = useParams()
  const [event, setEvent] = useState(null)
  const [divisions, setDivisions] = useState([])
  const [standings, setStandings] = useState([])
  const [teams, setTeams] = useState([])
  const [leagueAvgByDay, setLeagueAvgByDay] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAll()
  }, [slug])

  async function fetchAll() {
    const { data: ev } = await supabase.from('events').select('*').eq('slug', slug).single()
    if (!ev) { setLoading(false); return }
    setEvent(ev)

    const [{ data: divs }, { data: stands }, { data: teamsData }, { data: leagueData }] = await Promise.all([
      supabase.from('divisions').select('*').eq('event_id', ev.id).order('division_number'),
      supabase.from('standings').select('*').eq('event_id', ev.id),
      supabase.from('teams').select('*').eq('event_id', ev.id).order('team_number'),
      supabase.from('league_average_outcomes').select('*').eq('event_id', ev.id).eq('is_calculated', true)
    ])

    setDivisions(divs || [])
    setStandings(stands || [])
    setTeams(teamsData || [])

    // Build league average by day
    const dayMap = {}
    leagueData?.forEach(row => {
      if (!dayMap[row.day_number]) dayMap[row.day_number] = row.league_average_score
    })
    setLeagueAvgByDay(dayMap)

    setLoading(false)
  }

  const getTeam = (id) => teams.find(t => t.id === id)

  const getDivisionStandings = (divisionId) => {
    const divTeamIds = teams.filter(t => t.division_id === divisionId).map(t => t.id)
    const divStandings = standings.filter(s => divTeamIds.includes(s.team_id))
    return sortStandings(divStandings)
  }

  if (loading) return <><Navbar /><div className="loading-screen"><div className="spinner" /></div></>
  if (!event) return <><Navbar /><div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div></>

  const dayNumbers = Object.keys(leagueAvgByDay).map(Number).sort((a, b) => a - b)

  return (
    <>
      <Navbar eventSlug={slug} eventName={event.name} />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">{event.name}</div>
          <h1>Standings</h1>
          <div className="page-header-actions">
            <Link to={`/event/${slug}/schedule`} className="btn btn-secondary btn-sm">Schedule</Link>
            <Link to={`/event/${slug}/bracket`} className="btn btn-secondary btn-sm">Playoff Bracket</Link>
          </div>
        </div>

        <div className="page-content">
          {/* League Average Panel */}
          {dayNumbers.length > 0 && (
            <div className="card" style={{ marginBottom: '2rem' }}>
              <div className="card-title">League Average Score — By Day</div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {dayNumbers.map(day => (
                  <div key={day} className="stat-card" style={{ minWidth: '100px', flex: '0 0 auto' }}>
                    <div className="stat-label">Day {day}</div>
                    <div className="stat-value" style={{ fontSize: '1.2rem' }}>
                      {formatScore(leagueAvgByDay[day])}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Division Standings */}
          {divisions.map(div => {
            const divStandings = getDivisionStandings(div.id)
            return (
              <div key={div.id} style={{ marginBottom: '2.5rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-gold)', marginBottom: '1rem' }}>
                  {div.name}
                </h2>
                <div className="card" style={{ padding: 0 }}>
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: 40 }}>#</th>
                          <th>Team</th>
                          <th style={{ textAlign: 'center' }}>PTS</th>
                          <th style={{ textAlign: 'center' }}>W</th>
                          <th style={{ textAlign: 'center' }}>T</th>
                          <th style={{ textAlign: 'center' }}>L</th>
                          <th style={{ textAlign: 'center' }}>LA-W</th>
                          <th style={{ textAlign: 'center' }}>LA-T</th>
                          <th style={{ textAlign: 'center' }}>LA-L</th>
                          <th style={{ textAlign: 'center' }}>AVG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {divStandings.length === 0 ? (
                          <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No standings yet</td></tr>
                        ) : divStandings.map((s, i) => {
                          const team = getTeam(s.team_id)
                          return (
                            <tr key={s.team_id}>
                              <td>
                                <span className={`seed-badge ${i < 2 ? 'top' : ''}`}>{i + 1}</span>
                              </td>
                              <td style={{ fontWeight: 600 }}>{team?.display_name || '—'}</td>
                              <td style={{ textAlign: 'center', fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--accent-gold)' }}>{s.total_points}</td>
                              <td style={{ textAlign: 'center', color: 'var(--win)' }}>{s.wins}</td>
                              <td style={{ textAlign: 'center', color: 'var(--tie)' }}>{s.ties}</td>
                              <td style={{ textAlign: 'center', color: 'var(--loss)' }}>{s.losses}</td>
                              <td style={{ textAlign: 'center', color: 'var(--win)' }}>{s.league_avg_wins}</td>
                              <td style={{ textAlign: 'center', color: 'var(--tie)' }}>{s.league_avg_ties}</td>
                              <td style={{ textAlign: 'center', color: 'var(--loss)' }}>{s.league_avg_losses}</td>
                              <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatScore(s.avg_daily_score)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          })}

          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            PTS = Total points · W/T/L = Head-to-head · LA-W/T/L = vs. League Average · AVG = Average daily score
          </div>
        </div>
      </div>
    </>
  )
}
