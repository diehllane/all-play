import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import Navbar from '../../components/Navbar'
import { sortStandings, generateWinnersBracket, generateLosersBracket } from '../../lib/scoring'

export default function EventDetailPage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [event, setEvent] = useState(null)
  const [divisions, setDivisions] = useState([])
  const [teams, setTeams] = useState([])
  const [categories, setCategories] = useState([])
  const [standings, setStandings] = useState([])
  const [bracketConfig, setBracketConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [revertConfirm, setRevertConfirm] = useState(false)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    const [{ data: ev }, { data: divs }, { data: teamsData }, { data: cats }, { data: stands }, { data: bConfig }] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('divisions').select('*').eq('event_id', id).order('division_number'),
      supabase.from('teams').select('*').eq('event_id', id).order('team_number'),
      supabase.from('categories').select('*').eq('event_id', id).order('display_order'),
      supabase.from('standings').select('*').eq('event_id', id),
      supabase.from('bracket_round_config').select('*').eq('event_id', id).order('bracket_type').order('round_number')
    ])
    setEvent(ev)
    setDivisions(divs || [])
    setTeams(teamsData || [])
    setCategories(cats || [])
    setStandings(stands || [])
    setBracketConfig(bConfig || [])
    setLoading(false)
  }

  async function updateStatus(status) {
    setSaving(true)
    await supabase.from('events').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setEvent(prev => ({ ...prev, status }))
    setSaving(false)
    setRevertConfirm(false)
    setMessage({ type: 'success', text: `Event status updated to "${status}"` })
  }

  async function generateBracket() {
    setSaving(true)
    try {
      const enriched = standings.map(s => ({
        ...s,
        id: teams.find(t => t.id === s.team_id)?.id
      })).filter(s => s.id)

      const sorted = sortStandings(enriched)
      const winnersBracket = generateWinnersBracket(sorted, id)

      // Bracket size is next power of 2 from team count
      let bracketSize = 1
      while (bracketSize < sorted.length) bracketSize *= 2
      const losersBracket = generateLosersBracket(bracketSize, id)

      await supabase.from('playoff_bracket').delete().eq('event_id', id)

      const allMatches = [...winnersBracket, ...losersBracket]
      if (allMatches.length > 0) {
        const { error } = await supabase.from('playoff_bracket').insert(allMatches)
        if (error) throw error
      }

      setMessage({ type: 'success', text: 'Winner\'s and loser\'s brackets generated!' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  const isOwner = profile?.role === 'event_runner' && event?.created_by === profile?.id
  const winnersConfig = bracketConfig.filter(c => c.bracket_type === 'winners')
  const losersConfig = bracketConfig.filter(c => c.bracket_type === 'losers')

  if (loading) return <><Navbar /><div className="loading-screen"><div className="spinner" /></div></>
  if (!event) return <><Navbar /><div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div></>

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">Admin → Events</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <h1>{event.name}</h1>
            <span className={`badge badge-${event.status}`}>{event.status}</span>
          </div>
          {event.start_date && (
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Starts {new Date(event.start_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          )}
          <div className="page-header-actions">
            <Link to={`/admin/event/${id}/score`} className="btn btn-primary">Enter Scores</Link>
            <a href={`/all-play/event/${event.slug}/standings`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
              Public View ↗
            </a>
            {isOwner && (
              <Link to={`/admin/event/${id}/scorers`} className="btn btn-secondary">Manage Scorers</Link>
            )}
          </div>
        </div>

        <div className="page-content">
          {message && <div className={`alert alert-${message.type}`} style={{ marginBottom: '1.5rem' }}>{message.text}</div>}

          <div className="tab-bar">
            {['overview', 'teams', 'categories', 'bracket config', 'settings'].map(tab => (
              <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div>
              <div className="stats-row">
                <div className="stat-card"><div className="stat-label">Divisions</div><div className="stat-value">{divisions.length}</div></div>
                <div className="stat-card"><div className="stat-label">Total Teams</div><div className="stat-value">{teams.length}</div></div>
                <div className="stat-card"><div className="stat-label">Categories</div><div className="stat-value">{categories.length}</div></div>
                <div className="stat-card"><div className="stat-label">Status</div><div className="stat-value" style={{ fontSize: '1.1rem' }}>{event.status}</div></div>
              </div>

              {isOwner && (
                <div className="card" style={{ marginTop: '1.5rem' }}>
                  <div className="card-title">Event Controls</div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {event.status === 'setup' && (
                      <button className="btn btn-primary" disabled={saving} onClick={() => updateStatus('active')}>
                        Activate Event
                      </button>
                    )}
                    {event.status === 'active' && (
                      <button className="btn btn-primary" disabled={saving} onClick={() => updateStatus('playoffs')}>
                        Move to Playoffs
                      </button>
                    )}
                    {event.status === 'playoffs' && (
                      <>
                        <button className="btn btn-primary" disabled={saving} onClick={generateBracket}>
                          {saving ? 'Generating...' : 'Generate Brackets'}
                        </button>
                        <button className="btn btn-secondary" disabled={saving} onClick={() => updateStatus('completed')}>
                          Mark Complete
                        </button>
                      </>
                    )}

                    {/* Revert to round robin */}
                    {event.status === 'playoffs' && (
                      <div style={{ marginLeft: 'auto' }}>
                        {!revertConfirm ? (
                          <button className="btn btn-danger btn-sm" onClick={() => setRevertConfirm(true)}>
                            ↩ Revert to Round Robin
                          </button>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--accent-red)' }}>Revert to active round robin?</span>
                            <button className="btn btn-danger btn-sm" disabled={saving} onClick={() => updateStatus('active')}>
                              Yes, Revert
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setRevertConfirm(false)}>Cancel</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'teams' && (
            <div>
              {divisions.map(div => {
                const divTeams = teams.filter(t => t.division_id === div.id).sort((a, b) => a.team_number - b.team_number)
                return (
                  <div key={div.id} style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{ fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-gold)', marginBottom: '0.75rem' }}>
                      {div.name}
                    </h3>
                    <div className="card" style={{ padding: 0 }}>
                      <div className="table-container">
                        <table>
                          <thead><tr><th>#</th><th>Team Name</th><th>Display Name</th></tr></thead>
                          <tbody>
                            {divTeams.map(team => (
                              <tr key={team.id}>
                                <td className="mono">{team.team_number}</td>
                                <td>{team.name}</td>
                                <td style={{ color: 'var(--text-muted)' }}>{team.display_name}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {activeTab === 'categories' && (
            <div className="card">
              <div className="card-title">Encounter Categories</div>
              <div className="table-container">
                <table>
                  <thead><tr><th>Category</th><th>Points per Encounter</th></tr></thead>
                  <tbody>
                    {categories.map(cat => (
                      <tr key={cat.id}>
                        <td style={{ fontWeight: 600 }}>{cat.name}</td>
                        <td className="mono">{cat.multiplier}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'bracket config' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="card">
                <div className="card-title">Winner's Bracket</div>
                {winnersConfig.length === 0 ? (
                  <div className="empty-state" style={{ padding: '1rem' }}><p>No bracket config found. Was this event created before bracket config was added?</p></div>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead><tr><th>Round</th><th>Name</th><th>Format</th><th>Days/Game</th></tr></thead>
                      <tbody>
                        {winnersConfig.map(c => (
                          <tr key={c.id}>
                            <td className="mono">Round {c.round_number}</td>
                            <td>{c.round_name || '—'}</td>
                            <td>{c.format.replace(/_/g, ' ')}</td>
                            <td className="mono">{c.days_per_game}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="card">
                <div className="card-title">Loser's Bracket</div>
                {losersConfig.length === 0 ? (
                  <div className="empty-state" style={{ padding: '1rem' }}><p>No loser's bracket config found.</p></div>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead><tr><th>Round</th><th>Name</th><th>Format</th><th>Days/Game</th></tr></thead>
                      <tbody>
                        {losersConfig.map(c => (
                          <tr key={c.id}>
                            <td className="mono">L-Round {c.round_number}</td>
                            <td>{c.round_name || '—'}</td>
                            <td>{c.format.replace(/_/g, ' ')}</td>
                            <td className="mono">{c.days_per_game}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && isOwner && (
            <div className="card">
              <div className="card-title">Manual Status Override</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Status changes affect the public scoreboard immediately.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {['setup', 'active', 'playoffs', 'completed'].map(s => (
                  <button key={s} className={`btn ${event.status === s ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    disabled={saving || event.status === s} onClick={() => updateStatus(s)}>
                    Set: {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
