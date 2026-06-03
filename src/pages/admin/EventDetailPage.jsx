import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { sortStandings, generateWinnersBracket, generateLosersBracket } from '../../lib/scoring'
import { buildScheduleRows } from '../../lib/schedule'
import { logAudit } from '../../lib/audit'

export default function EventDetailPage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [event, setEvent] = useState(null)
  const [divisions, setDivisions] = useState([])
  const [teams, setTeams] = useState([])
  const [categories, setCategories] = useState([])
  const [standings, setStandings] = useState([])
  const [bracketConfig, setBracketConfig] = useState([])
  const [schedule, setSchedule] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [revertConfirm, setRevertConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDisplay, setNewTeamDisplay] = useState('')
  const [newTeamDivision, setNewTeamDivision] = useState('')
  const [newTeamWebhook, setNewTeamWebhook] = useState('')
  const [newDivName, setNewDivName] = useState('')
  const [newCatName, setNewCatName] = useState('')
  const [newCatPts, setNewCatPts] = useState(1)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    const [{ data: ev }, { data: divs }, { data: teamsData }, { data: cats }, { data: stands }, { data: bConfig }, { data: sched }] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('divisions').select('*').eq('event_id', id).order('division_number'),
      supabase.from('teams').select('*').eq('event_id', id).order('team_number'),
      supabase.from('categories').select('*').eq('event_id', id).order('display_order'),
      supabase.from('standings').select('*').eq('event_id', id),
      supabase.from('bracket_round_config').select('*').eq('event_id', id).order('bracket_type').order('round_number'),
      supabase.from('schedule').select('*').eq('event_id', id),
    ])
    setEvent(ev)
    setDivisions(divs || [])
    setTeams(teamsData || [])
    setCategories(cats || [])
    setStandings(stands || [])
    setBracketConfig(bConfig || [])
    setSchedule(sched || [])
    setLoading(false)
  }

  async function handleAddDivision() {
    if (!newDivName.trim()) return
    const { error } = await supabase.from('divisions').insert({
      event_id: id, name: newDivName.trim(), division_number: divisions.length + 1,
    })
    if (error) { setMessage({ type: 'error', text: error.message }); return }
    setNewDivName('')
    await fetchAll()
  }

  async function handleDeleteDivision(divId) {
    if (!confirm('Delete this division and all its teams?')) return
    await supabase.from('divisions').delete().eq('id', divId)
    await fetchAll()
  }

  async function handleAddTeam() {
    if (!newTeamName.trim() || !newTeamDivision) {
      setMessage({ type: 'error', text: 'Team name and division are required.' })
      return
    }
    const { error } = await supabase.from('teams').insert({
      event_id: id, division_id: newTeamDivision, name: newTeamName.trim(),
      display_name: newTeamDisplay.trim() || newTeamName.trim(),
      team_number: teams.length + 1,
      discord_webhook_url: newTeamWebhook.trim() || null,
    })
    if (error) { setMessage({ type: 'error', text: error.message }); return }
    setNewTeamName(''); setNewTeamDisplay(''); setNewTeamWebhook('')
    await fetchAll()
  }

  async function handleDeleteTeam(teamId) {
    if (!confirm('Remove this team?')) return
    await supabase.from('teams').delete().eq('id', teamId)
    await fetchAll()
  }

  async function handleAddCategory() {
    if (!newCatName.trim()) return
    const { error } = await supabase.from('categories').insert({
      event_id: id, name: newCatName.trim(), multiplier: Number(newCatPts) || 1, display_order: categories.length,
    })
    if (error) { setMessage({ type: 'error', text: error.message }); return }
    setNewCatName(''); setNewCatPts(1)
    await fetchAll()
  }

  async function handleDeleteCategory(catId) {
    await supabase.from('categories').delete().eq('id', catId)
    await fetchAll()
  }

  async function generateBracketConfig() {
    setSaving(true); setMessage(null)
    try {
      await supabase.from('bracket_round_config').delete().eq('event_id', id)
      const bracketRows = []
      ;['winners', 'losers'].forEach(bracketType => {
        ;[1, 2, 3, 4].forEach(round => {
          bracketRows.push({ event_id: id, bracket_type: bracketType, round_number: round, round_name: null, format: 'single', days_per_game: 1 })
        })
      })
      const { error } = await supabase.from('bracket_round_config').insert(bracketRows)
      if (error) throw error
      await fetchAll()
      setMessage({ type: 'success', text: 'Bracket config generated.' })
    } catch (err) { setMessage({ type: 'error', text: err.message }) }
    setSaving(false)
  }

  async function generateSchedule() {
    setSaving(true); setMessage(null)
    try {
      await supabase.from('schedule').delete().eq('event_id', id)
      const allRows = []
      for (const div of divisions) {
        const divTeams = teams.filter(t => t.division_id === div.id).map(t => t.id)
        if (divTeams.length < 2) continue
        allRows.push(...buildScheduleRows(id, div.id, divTeams))
      }
      if (allRows.length === 0) throw new Error('No schedule could be generated. Make sure each division has at least 2 teams.')
      const { error } = await supabase.from('schedule').insert(allRows)
      if (error) throw error
      await fetchAll()
      setMessage({ type: 'success', text: `Schedule generated — ${allRows.length} matchups.` })
      await logAudit({
        actor: profile, eventType: 'config_change',
        action: `Generated schedule for "${event?.name}" (${allRows.length} matchups)`,
        eventId: id, eventName: event?.name,
        metadata: { matchup_count: allRows.length, division_count: divisions.length },
      })
    } catch (err) { setMessage({ type: 'error', text: err.message }) }
    setSaving(false)
  }

  async function updateStatus(status) {
    setSaving(true)
    await supabase.from('events').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setEvent(prev => ({ ...prev, status }))
    setSaving(false); setRevertConfirm(false)
    setMessage({ type: 'success', text: `Status updated to "${status}"` })
  }

  async function deleteEvent() {
    setSaving(true)
    try {
      const { error } = await supabase.from('events').delete().eq('id', id)
      if (error) throw error
      navigate('/admin')
    } catch (err) { setMessage({ type: 'error', text: err.message }); setSaving(false) }
  }

  async function generateBracket() {
    setSaving(true)
    try {
      const enriched = standings.map(s => ({ ...s, id: teams.find(t => t.id === s.team_id)?.id })).filter(s => s.id)
      const sorted = sortStandings(enriched)
      const winnersBracket = generateWinnersBracket(sorted, id)
      const losersBracket = generateLosersBracket(sorted.length, id, winnersBracket)
      const allMatches = [...winnersBracket, ...losersBracket]
      const round1 = allMatches.filter(m => m.bracket_type === 'winners' && m.round_number === 1).sort((a, b) => a.match_number - b.match_number)
      const round2 = allMatches.filter(m => m.bracket_type === 'winners' && m.round_number === 2).sort((a, b) => a.match_number - b.match_number)
      round1.forEach((m, i) => {
        if (!m.is_bye || !m.winner_id) return
        const r2 = round2[Math.floor(i / 2)]
        if (r2) r2[i % 2 === 0 ? 'team1_id' : 'team2_id'] = m.winner_id
      })
      const { error: delErr } = await supabase.from('playoff_bracket').delete().eq('event_id', id)
      if (delErr) throw new Error('Failed to clear old bracket: ' + delErr.message)
      if (allMatches.length > 0) {
        const { error } = await supabase.from('playoff_bracket').insert(allMatches)
        if (error) throw error
      }
      setMessage({ type: 'success', text: "Winner's and loser's brackets generated!" })
      await logAudit({
        actor: profile, eventType: 'config_change',
        action: `Generated playoff bracket for "${event?.name}"`,
        eventId: id, eventName: event?.name,
        metadata: { match_count: allMatches.length, team_count: sorted.length },
      })
    } catch (err) { setMessage({ type: 'error', text: err.message }) }
    setSaving(false)
  }

  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner'
  const winnersConfig = bracketConfig.filter(c => c.bracket_type === 'winners')
  const losersConfig = bracketConfig.filter(c => c.bracket_type === 'losers')

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!event) return <div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div>

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-meta">Admin → Events</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h1>{event.name}</h1>
          <span className={`badge badge-${event.status}`}>{event.status}</span>
        </div>
        <div className="page-header-actions">
          <Link to={`/admin/events/${id}/scores`} className="btn btn-primary">Enter Scores</Link>
          <Link to={`/admin/events/${id}/export`} className="btn btn-secondary">Export XLSX</Link>
          <Link to={`/events/${event?.slug}/standings`} className="btn btn-secondary">Public View ↗</Link>
        </div>
      </div>

      <div className="page-content">
        {message && <div className={`alert alert-${message.type}`} style={{ marginBottom: '1.5rem' }}>{message.text}<button onClick={() => setMessage(null)} style={{ float: 'right', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button></div>}

        <div className="tab-bar">
          {[{ key: 'overview', label: 'Overview' }, { key: 'teams', label: 'Teams' }, { key: 'categories', label: 'Categories' }, { key: 'bracket-config', label: 'Bracket Config' }, { key: 'settings', label: 'Settings' }].map(tab => (
            <button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div>
            <div className="stats-row">
              <div className="stat-card"><div className="stat-label">Divisions</div><div className="stat-value">{divisions.length}</div></div>
              <div className="stat-card"><div className="stat-label">Total Teams</div><div className="stat-value">{teams.length}</div></div>
              <div className="stat-card"><div className="stat-label">Categories</div><div className="stat-value">{categories.length}</div></div>
              <div className="stat-card"><div className="stat-label">Schedule Days</div><div className="stat-value">{schedule.length > 0 ? Math.max(...schedule.map(s => s.day_number)) : 0}</div></div>
              <div className="stat-card"><div className="stat-label">Status</div><div className="stat-value" style={{ fontSize: '1.1rem' }}>{event.status}</div></div>
            </div>
            {canManage && (
              <div className="card" style={{ marginTop: '1.5rem' }}>
                <div className="card-title">Event Controls</div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn btn-secondary" disabled={saving} onClick={generateSchedule}>{saving ? 'Generating...' : `${schedule.length > 0 ? 'Regenerate' : 'Generate'} Schedule`}</button>
                  {event.status === 'setup' && <button className="btn btn-primary" disabled={saving} onClick={() => updateStatus('active')}>Activate Event</button>}
                  {event.status === 'active' && <button className="btn btn-primary" disabled={saving} onClick={() => updateStatus('playoffs')}>Move to Playoffs</button>}
                  {event.status === 'playoffs' && <>
                    <button className="btn btn-primary" disabled={saving} onClick={generateBracket}>{saving ? 'Generating...' : 'Generate Brackets'}</button>
                    <button className="btn btn-secondary" disabled={saving} onClick={() => updateStatus('completed')}>Mark Complete</button>
                  </>}
                  {event.status === 'playoffs' && (
                    <div style={{ marginLeft: 'auto' }}>
                      {!revertConfirm
                        ? <button className="btn btn-danger btn-sm" onClick={() => setRevertConfirm(true)}>↩ Revert to Round Robin</button>
                        : <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--accent-red)' }}>Revert to active round robin?</span>
                            <button className="btn btn-danger btn-sm" disabled={saving} onClick={() => updateStatus('active')}>Yes, Revert</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setRevertConfirm(false)}>Cancel</button>
                          </div>
                      }
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'teams' && (
          <div>
            {canManage && (
              <div className="card" style={{ marginBottom: '1.5rem' }}>
                <div className="card-title">Divisions</div>
                {divisions.map(div => (
                  <div key={div.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontWeight: 600 }}>{div.name}</span>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteDivision(div.id)}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  <input className="form-input" value={newDivName} onChange={e => setNewDivName(e.target.value)} placeholder="Division name (e.g. Division 1)" style={{ flex: 1 }} />
                  <button className="btn btn-primary btn-sm" onClick={handleAddDivision}>+ Add Division</button>
                </div>
              </div>
            )}

            {divisions.map(div => {
              const divTeams = teams.filter(t => t.division_id === div.id).sort((a, b) => a.team_number - b.team_number)
              return (
                <div key={div.id} style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-gold)', marginBottom: '0.75rem' }}>{div.name}</h3>
                  <div className="card" style={{ padding: 0 }}>
                    <div className="table-container">
                      <table>
                        <thead><tr><th>#</th><th>Name</th><th>Display Name</th><th>Discord Webhook</th>{canManage && <th></th>}</tr></thead>
                        <tbody>
                          {divTeams.length === 0
                            ? <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>No teams yet</td></tr>
                            : divTeams.map(team => (
                                <tr key={team.id}>
                                  <td className="mono">{team.team_number}</td>
                                  <td>{team.name}</td>
                                  <td style={{ color: 'var(--text-muted)' }}>{team.display_name}</td>
                                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{team.discord_webhook_url ? '✓ Set' : '—'}</td>
                                  {canManage && <td><button className="btn btn-danger btn-sm" onClick={() => handleDeleteTeam(team.id)}>Remove</button></td>}
                                </tr>
                              ))
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            })}

            {canManage && divisions.length > 0 && (
              <div className="card">
                <div className="card-title">Add Team</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Team Name</label>
                    <input className="form-input" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="e.g. Team Alpha" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Display Name (optional)</label>
                    <input className="form-input" value={newTeamDisplay} onChange={e => setNewTeamDisplay(e.target.value)} placeholder="Defaults to team name" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Division</label>
                    <select className="form-select" value={newTeamDivision} onChange={e => setNewTeamDivision(e.target.value)}>
                      <option value="">— Select Division —</option>
                      {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Discord Webhook (optional)</label>
                    <input className="form-input" value={newTeamWebhook} onChange={e => setNewTeamWebhook(e.target.value)} placeholder="https://discord.com/api/webhooks/..." />
                  </div>
                </div>
                <button className="btn btn-primary" onClick={handleAddTeam}>+ Add Team</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="card">
            <div className="card-title">Encounter Categories</div>
            <div className="table-container">
              <table>
                <thead><tr><th>Category</th><th>Points per Encounter</th>{canManage && <th></th>}</tr></thead>
                <tbody>
                  {categories.length === 0
                    ? <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>No categories yet</td></tr>
                    : categories.map(cat => (
                        <tr key={cat.id}>
                          <td style={{ fontWeight: 600 }}>{cat.name}</td>
                          <td className="mono">{cat.multiplier}</td>
                          {canManage && <td><button className="btn btn-danger btn-sm" onClick={() => handleDeleteCategory(cat.id)}>Remove</button></td>}
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ margin: 0, flex: 1 }}>
                  <label className="form-label">Category Name</label>
                  <input className="form-input" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="e.g. Shiny Legend" />
                </div>
                <div className="form-group" style={{ margin: 0, width: 100 }}>
                  <label className="form-label">Points</label>
                  <input type="number" className="form-input" value={newCatPts} onChange={e => setNewCatPts(e.target.value)} min="1" />
                </div>
                <button className="btn btn-primary" onClick={handleAddCategory}>+ Add</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'bracket-config' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="card">
              <div className="card-title">Winner's Bracket</div>
              {winnersConfig.length === 0
                ? <div className="empty-state" style={{ padding: '1rem' }}>
                    <p>No bracket config found.</p>
                    <button className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem' }} disabled={saving} onClick={generateBracketConfig}>Generate Default Config</button>
                  </div>
                : <div className="table-container"><table>
                    <thead><tr><th>Round</th><th>Name</th><th>Format</th><th>Days/Game</th></tr></thead>
                    <tbody>{winnersConfig.map(c => <tr key={c.id}><td className="mono">Round {c.round_number}</td><td>{c.round_name || '—'}</td><td>{c.format.replace(/_/g, ' ')}</td><td className="mono">{c.days_per_game}</td></tr>)}</tbody>
                  </table></div>
              }
            </div>
            <div className="card">
              <div className="card-title">Loser's Bracket</div>
              {losersConfig.length === 0
                ? <div className="empty-state" style={{ padding: '1rem' }}><p>No loser's bracket config found.</p></div>
                : <div className="table-container"><table>
                    <thead><tr><th>Round</th><th>Name</th><th>Format</th><th>Days/Game</th></tr></thead>
                    <tbody>{losersConfig.map(c => <tr key={c.id}><td className="mono">L-Round {c.round_number}</td><td>{c.round_name || '—'}</td><td>{c.format.replace(/_/g, ' ')}</td><td className="mono">{c.days_per_game}</td></tr>)}</tbody>
                  </table></div>
              }
            </div>
          </div>
        )}

        {activeTab === 'settings' && canManage && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="card">
              <div className="card-title">Manual Status Override</div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {['setup', 'active', 'playoffs', 'completed'].map(s => (
                  <button key={s} className={`btn ${event.status === s ? 'btn-primary' : 'btn-secondary'} btn-sm`} disabled={saving || event.status === s} onClick={() => updateStatus(s)}>Set: {s}</button>
                ))}
              </div>
            </div>
            <div className="card" style={{ borderColor: 'rgba(230,57,70,0.3)' }}>
              <div className="card-title" style={{ color: 'var(--accent-red)' }}>Delete Event</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Permanently deletes this event and all associated data.</p>
              {!deleteConfirm
                ? <button className="btn btn-danger" onClick={() => setDeleteConfirm(true)}>Delete Event</button>
                : <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--accent-red)', fontWeight: 600 }}>Are you sure? This is permanent.</span>
                    <button className="btn btn-danger" disabled={saving} onClick={deleteEvent}>{saving ? 'Deleting...' : 'Yes, Delete Everything'}</button>
                    <button className="btn btn-secondary" onClick={() => setDeleteConfirm(false)}>Cancel</button>
                  </div>
              }
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
