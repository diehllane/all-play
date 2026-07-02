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
  const [standings, setStandings] = useState([])
  const [schedule, setSchedule] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [revertConfirm, setRevertConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner'

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    const [
      { data: ev },
      { data: divs },
      { data: teamsData },
      { data: stands },
      { data: sched },
      { data: cats },
    ] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('divisions').select('*').eq('event_id', id).order('division_number'),
      supabase.from('teams').select('*').eq('event_id', id).order('team_number'),
      supabase.from('standings').select('*').eq('event_id', id),
      supabase.from('schedule').select('*').eq('event_id', id),
      supabase.from('categories').select('*').eq('event_id', id).order('display_order'),
    ])
    setEvent(ev)
    setDivisions(divs || [])
    setTeams(teamsData || [])
    setStandings(stands || [])
    setSchedule(sched || [])
    setCategories(cats || [])
    setLoading(false)
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
      // .select() forces Supabase to return the deleted row(s). Without it, a
      // delete blocked by RLS (0 rows affected) still comes back with no
      // error, so the UI would report success while nothing was deleted.
      const { data, error } = await supabase.from('events').delete().eq('id', id).select()
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error('Delete affected 0 rows. This usually means a permissions (RLS) mismatch — the event was not created_by your current account, or your session is stale. Try logging out and back in, or delete it directly via Supabase.')
      }
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

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!event) return <div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div>

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-meta">Admin → Events</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h1>{event.name}</h1>
          <span className={`badge badge-${event.status}`}>{event.status}</span>
          <span className="badge badge-setup" style={{ background: '#1a237e', color: '#90caf9' }}>All-Play</span>
        </div>
        <div className="page-header-actions">
          <Link to={`/admin/events/${id}/scores`} className="btn btn-primary">Enter Scores</Link>
          <Link to={`/admin/events/${id}/edit`} className="btn btn-secondary">✏️ Edit Event</Link>
          <Link to={`/admin/events/${id}/export`} className="btn btn-secondary">Export XLSX</Link>
          <Link to={`/events/${event?.slug}/standings`} className="btn btn-secondary">Public View ↗</Link>
        </div>
      </div>

      <div className="page-content">
        {message && (
          <div className={`alert alert-${message.type}`} style={{ marginBottom: '1.5rem' }}>
            {message.text}
            <button onClick={() => setMessage(null)} style={{ float: 'right', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        <div className="tab-bar">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'settings', label: 'Settings' },
          ].map(tab => (
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
                  <button className="btn btn-secondary" disabled={saving} onClick={generateSchedule}>
                    {saving ? 'Generating...' : `${schedule.length > 0 ? 'Regenerate' : 'Generate'} Schedule`}
                  </button>
                  {event.status === 'setup' && (
                    <button className="btn btn-primary" disabled={saving} onClick={() => updateStatus('active')}>Activate Event</button>
                  )}
                  {event.status === 'active' && (
                    <button className="btn btn-primary" disabled={saving} onClick={() => updateStatus('playoffs')}>Move to Playoffs</button>
                  )}
                  {event.status === 'playoffs' && (
                    <>
                      <button className="btn btn-primary" disabled={saving} onClick={generateBracket}>
                        {saving ? 'Generating...' : 'Generate Brackets'}
                      </button>
                      <button className="btn btn-secondary" disabled={saving} onClick={() => updateStatus('completed')}>Mark Complete</button>
                    </>
                  )}
                  {event.status === 'playoffs' && (
                    <div style={{ marginLeft: 'auto' }}>
                      {!revertConfirm
                        ? <button className="btn btn-danger btn-sm" onClick={() => setRevertConfirm(true)}>↩ Revert to Round Robin</button>
                        : (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--accent-red)' }}>Revert to active round robin?</span>
                            <button className="btn btn-danger btn-sm" disabled={saving} onClick={() => updateStatus('active')}>Yes, Revert</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setRevertConfirm(false)}>Cancel</button>
                          </div>
                        )
                      }
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="card" style={{ marginTop: '1.5rem' }}>
              <div className="card-title">Quick Links</div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <Link to={`/events/${event.slug}/standings`} className="btn btn-secondary btn-sm">📊 Standings</Link>
                <Link to={`/events/${event.slug}/schedule`} className="btn btn-secondary btn-sm">📅 Schedule</Link>
                <Link to={`/events/${event.slug}/bracket`} className="btn btn-secondary btn-sm">🏆 Bracket</Link>
                <Link to={`/admin/events/${id}/edit`} className="btn btn-secondary btn-sm">✏️ Edit Teams & Categories</Link>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && canManage && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="card">
              <div className="card-title">Manual Status Override</div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {['setup', 'active', 'playoffs', 'completed'].map(s => (
                  <button key={s} className={`btn ${event.status === s ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    disabled={saving || event.status === s} onClick={() => updateStatus(s)}>
                    Set: {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="card" style={{ borderColor: 'rgba(230,57,70,0.3)' }}>
              <div className="card-title" style={{ color: 'var(--accent-red)' }}>Delete Event</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Permanently deletes this event and all associated data.
              </p>
              {!deleteConfirm
                ? <button className="btn btn-danger" onClick={() => setDeleteConfirm(true)}>Delete Event</button>
                : (
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--accent-red)', fontWeight: 600 }}>Are you sure? This is permanent.</span>
                    <button className="btn btn-danger" disabled={saving} onClick={deleteEvent}>{saving ? 'Deleting...' : 'Yes, Delete Everything'}</button>
                    <button className="btn btn-secondary" onClick={() => setDeleteConfirm(false)}>Cancel</button>
                  </div>
                )
              }
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
