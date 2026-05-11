import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Navbar from '../../components/Navbar'
import { formatScore } from '../../lib/scoring'

export default function BracketPage() {
  const { slug } = useParams()
  const [event, setEvent] = useState(null)
  const [bracket, setBracket] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchAll() }, [slug])

  async function fetchAll() {
    const { data: ev } = await supabase.from('events').select('*').eq('slug', slug).single()
    if (!ev) { setLoading(false); return }
    setEvent(ev)

    const [{ data: bracketData }, { data: teamsData }] = await Promise.all([
      supabase.from('playoff_bracket').select('*').eq('event_id', ev.id).order('round_number').order('match_number'),
      supabase.from('teams').select('*').eq('event_id', ev.id)
    ])

    setBracket(bracketData || [])
    setTeams(teamsData || [])
    setLoading(false)
  }

  const getTeam = (id) => teams.find(t => t.id === id)
  const maxRound = bracket.reduce((max, m) => Math.max(max, m.round_number), 0)

  const getRoundName = (round, totalRounds) => {
    const remaining = totalRounds - round
    if (remaining === 0) return 'Championship'
    if (remaining === 1) return 'Finals'
    if (remaining === 2) return 'Semifinals'
    if (remaining === 3) return 'Quarterfinals'
    return `Round ${round}`
  }

  if (loading) return <><Navbar /><div className="loading-screen"><div className="spinner" /></div></>
  if (!event) return <><Navbar /><div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div></>

  return (
    <>
      <Navbar eventSlug={slug} eventName={event.name} />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">{event.name}</div>
          <h1>Playoff Bracket</h1>
          <div className="page-header-actions">
            <Link to={`/event/${slug}/standings`} className="btn btn-secondary btn-sm">Standings</Link>
            <Link to={`/event/${slug}/schedule`} className="btn btn-secondary btn-sm">Schedule</Link>
          </div>
        </div>

        <div className="page-content">
          {bracket.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏆</div>
              <h3>Bracket Not Yet Generated</h3>
              <p>The playoff bracket will be generated once the round robin is complete.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'flex', gap: '2rem', minWidth: 'fit-content', padding: '1rem 0' }}>
                {Array.from({ length: maxRound }, (_, i) => i + 1).map(round => {
                  const roundMatches = bracket.filter(m => m.round_number === round && !m.is_bye)
                  if (roundMatches.length === 0) return null
                  return (
                    <div key={round} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: '260px' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-gold)', marginBottom: '0.5rem' }}>
                        {getRoundName(round, maxRound)}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', justifyContent: 'space-around', flex: 1 }}>
                        {roundMatches.map(match => {
                          const team1 = getTeam(match.team1_id)
                          const team2 = getTeam(match.team2_id)
                          const isChampion = round === maxRound && match.winner_id

                          return (
                            <div key={match.id} className="card" style={{
                              padding: '0.75rem',
                              borderColor: isChampion ? 'var(--accent-gold)' : 'var(--border)',
                              boxShadow: isChampion ? 'var(--shadow-glow)' : 'none'
                            }}>
                              {isChampion && (
                                <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-gold)', marginBottom: '0.5rem', textAlign: 'center' }}>
                                  🏆 Champion
                                </div>
                              )}

                              {/* Team 1 */}
                              <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '0.5rem 0.5rem',
                                borderRadius: 4,
                                background: match.winner_id === match.team1_id ? 'rgba(46,196,182,0.1)' : 'transparent',
                                marginBottom: '0.25rem'
                              }}>
                                <span style={{
                                  fontSize: '0.85rem', fontWeight: 600,
                                  color: match.winner_id === match.team1_id ? 'var(--win)' : match.winner_id && match.winner_id !== match.team1_id ? 'var(--text-muted)' : 'var(--text-primary)'
                                }}>
                                  {team1 ? team1.display_name : <span style={{ color: 'var(--text-muted)' }}>TBD</span>}
                                </span>
                                {match.team1_score !== null && match.team1_score !== undefined && (
                                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700 }}>
                                    {formatScore(match.team1_score)}
                                  </span>
                                )}
                              </div>

                              <div style={{ height: '1px', background: 'var(--border)', margin: '0.25rem 0' }} />

                              {/* Team 2 */}
                              <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '0.5rem 0.5rem',
                                borderRadius: 4,
                                background: match.winner_id === match.team2_id ? 'rgba(46,196,182,0.1)' : 'transparent',
                              }}>
                                <span style={{
                                  fontSize: '0.85rem', fontWeight: 600,
                                  color: match.winner_id === match.team2_id ? 'var(--win)' : match.winner_id && match.winner_id !== match.team2_id ? 'var(--text-muted)' : 'var(--text-primary)'
                                }}>
                                  {team2 ? team2.display_name : <span style={{ color: 'var(--text-muted)' }}>TBD</span>}
                                </span>
                                {match.team2_score !== null && match.team2_score !== undefined && (
                                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700 }}>
                                    {formatScore(match.team2_score)}
                                  </span>
                                )}
                              </div>

                              {!match.is_finalized && (
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.5rem' }}>Pending</div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
