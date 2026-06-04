import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../lib/audit'

// ── CSV helpers ───────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows = lines.slice(1).map(line => {
    const cols = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    cols.push(cur.trim())
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? '']))
  })
  return { headers, rows }
}

function downloadCSV(filename, headers, rows) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── CSV Importer component ────────────────────────────────
function CsvImporter({ onImport, sampleHeaders, sampleRow, label }) {
  const [preview, setPreview] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const parsed = parseCSV(ev.target.result)
      setPreview(parsed)
      setResult(null)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleConfirm = async () => {
    setImporting(true)
    const res = await onImport(preview.rows)
    setResult(res)
    setPreview(null)
    setImporting(false)
  }

  const handleSample = () => {
    downloadCSV(`sample_${label.toLowerCase().replace(/\s/g, '_')}.csv`, sampleHeaders, [sampleRow])
  }

  return (
    <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={{ background: 'none', border: '1px solid #444', color: '#aaa', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
        ↑ Import CSV
        <input type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
      </label>
      <button onClick={handleSample} style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
        ↓ Sample
      </button>
      {result && <span style={{ fontSize: 12, color: result.error ? '#ef4444' : '#4ade80' }}>{result.text}</span>}

      {preview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 10, padding: 24, maxWidth: 700, width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 12 }}>Preview — {preview.rows.length} rows</div>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>{preview.headers.map(h => <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#aaa', borderBottom: '1px solid #333' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 10).map((row, i) => (
                    <tr key={i}>{preview.headers.map(h => <td key={h} style={{ padding: '5px 10px', color: '#ddd', borderBottom: '1px solid #222' }}>{row[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 10 && <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>...and {preview.rows.length - 10} more rows</div>}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleConfirm} disabled={importing}
                style={{ background: '#2e7d32', border: 'none', color: '#fff', borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {importing ? 'Importing...' : 'Confirm Import'}
              </button>
              <button onClick={() => setPreview(null)}
                style={{ background: 'none', border: '1px solid #444', color: '#aaa', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────
export default function AllPlayEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [event, setEvent] = useState(null)
  const [divisions, setDivisions] = useState([])
  const [teams, setTeams] = useState([])
  const [categories, setCategories] = useState([])
  const [bracketConfig, setBracketConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [activeTab, setActiveTab] = useState('teams')

  // Team form
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDisplay, setNewTeamDisplay] = useState('')
  const [newTeamDivision, setNewTeamDivision] = useState('')
  const [newTeamWebhook, setNewTeamWebhook] = useState('')
  const [newDivName, setNewDivName] = useState('')

  // Category form
  const [newCatName, setNewCatName] = useState('')
  const [newCatPts, setNewCatPts] = useState(1)

  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner'

  const flash = (text, isError = false) => {
    setMessage({ text, isError })
    setTimeout(() => setMessage(null), 5000)
  }

  const fetchAll = async () => {
    const [
      { data: ev },
      { data: divs },
      { data: teamsData },
      { data: cats },
      { data: bConfig },
    ] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('divisions').select('*').eq('event_id', id).order('division_number'),
      supabase.from('teams').select('*').eq('event_id', id).order('team_number'),
      supabase.from('categories').select('*').eq('event_id', id).order('display_order'),
      supabase.from('bracket_round_config').select('*').eq('event_id', id).order('bracket_type').order('round_number'),
    ])
    setEvent(ev)
    setDivisions(divs || [])
    setTeams(teamsData || [])
    setCategories(cats || [])
    setBracketConfig(bConfig || [])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [id])

  // ── Divisions ─────────────────────────────────────────
  const handleAddDivision = async () => {
    if (!newDivName.trim()) return
    const { error } = await supabase.from('divisions').insert({
      event_id: id, name: newDivName.trim(), division_number: divisions.length + 1,
    })
    if (error) return flash(error.message, true)
    setNewDivName('')
    await fetchAll()
  }

  const handleDeleteDivision = async (divId) => {
    if (!confirm('Delete this division and all its teams?')) return
    await supabase.from('divisions').delete().eq('id', divId)
    await fetchAll()
  }

  // ── Teams ─────────────────────────────────────────────
  const handleAddTeam = async () => {
    if (!newTeamName.trim() || !newTeamDivision) return flash('Team name and division are required.', true)
    const { error } = await supabase.from('teams').insert({
      event_id: id,
      division_id: newTeamDivision,
      name: newTeamName.trim(),
      display_name: newTeamDisplay.trim() || newTeamName.trim(),
      team_number: teams.length + 1,
      discord_webhook_url: newTeamWebhook.trim() || null,
    })
    if (error) return flash(error.message, true)
    setNewTeamName(''); setNewTeamDisplay(''); setNewTeamWebhook('')
    await fetchAll()
  }

  const handleDeleteTeam = async (teamId) => {
    if (!confirm('Remove this team?')) return
    await supabase.from('teams').delete().eq('id', teamId)
    await fetchAll()
  }

  const importTeams = async (rows) => {
    let imported = 0, errors = []
    for (const row of rows) {
      const name = row['team_name']?.trim()
      if (!name) { errors.push('Row missing team_name'); continue }
      const div = divisions.find(d => d.name.toLowerCase() === row['division_name']?.trim().toLowerCase())
      if (!div) { errors.push(`Division not found: "${row['division_name']}"`); continue }
      const existing = teams.find(t => t.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        await supabase.from('teams').update({
          display_name: row['display_name']?.trim() || name,
          discord_webhook_url: row['discord_webhook']?.trim() || null,
          division_id: div.id,
        }).eq('id', existing.id)
      } else {
        await supabase.from('teams').insert({
          event_id: id, division_id: div.id, name,
          display_name: row['display_name']?.trim() || name,
          team_number: teams.length + imported + 1,
          discord_webhook_url: row['discord_webhook']?.trim() || null,
        })
      }
      imported++
    }
    await fetchAll()
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` }
    return { text: `${imported} teams imported.` }
  }

  const exportTeams = () => {
    const headers = ['team_name', 'display_name', 'division_name', 'discord_webhook']
    const rows = teams.map(t => ({
      team_name: t.name,
      display_name: t.display_name,
      division_name: divisions.find(d => d.id === t.division_id)?.name ?? '',
      discord_webhook: t.discord_webhook_url ?? '',
    }))
    downloadCSV(`teams_${event?.slug ?? id}.csv`, headers, rows)
  }

  // ── Categories ────────────────────────────────────────
  const handleAddCategory = async () => {
    if (!newCatName.trim()) return
    const { error } = await supabase.from('categories').insert({
      event_id: id, name: newCatName.trim(), multiplier: Number(newCatPts) || 1, display_order: categories.length,
    })
    if (error) return flash(error.message, true)
    setNewCatName(''); setNewCatPts(1)
    await fetchAll()
  }

  const handleDeleteCategory = async (catId) => {
    await supabase.from('categories').delete().eq('id', catId)
    await fetchAll()
  }

  const importCategories = async (rows) => {
    let imported = 0, errors = []
    for (const row of rows) {
      const name = row['name']?.trim()
      if (!name) { errors.push('Row missing name'); continue }
      const pts = parseFloat(row['points']) || 1
      const sort = parseInt(row['display_order']) || categories.length + imported
      const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        await supabase.from('categories').update({ multiplier: pts, display_order: sort }).eq('id', existing.id)
      } else {
        await supabase.from('categories').insert({ event_id: id, name, multiplier: pts, display_order: sort })
      }
      imported++
    }
    await fetchAll()
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` }
    return { text: `${imported} categories imported.` }
  }

  const exportCategories = () => {
    const headers = ['name', 'points', 'display_order']
    const rows = categories.map(c => ({ name: c.name, points: c.multiplier, display_order: c.display_order }))
    downloadCSV(`categories_${event?.slug ?? id}.csv`, headers, rows)
  }

  // ── Bracket Config ────────────────────────────────────
  const generateBracketConfig = async () => {
    setSaving(true)
    try {
      await supabase.from('bracket_round_config').delete().eq('event_id', id)
      const rows = []
      ;['winners', 'losers'].forEach(bracketType => {
        ;[1, 2, 3, 4].forEach(round => {
          rows.push({ event_id: id, bracket_type: bracketType, round_number: round, round_name: null, format: 'single', days_per_game: 1 })
        })
      })
      const { error } = await supabase.from('bracket_round_config').insert(rows)
      if (error) throw error
      await fetchAll()
      flash('Default bracket config generated.')
    } catch (err) { flash(err.message, true) }
    setSaving(false)
  }

  const updateBracketRow = async (rowId, field, value) => {
    await supabase.from('bracket_round_config').update({ [field]: value }).eq('id', rowId)
    await fetchAll()
  }


  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!event) return <div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div>

  const winnersConfig = bracketConfig.filter(c => c.bracket_type === 'winners')
  const losersConfig = bracketConfig.filter(c => c.bracket_type === 'losers')

  const tabs = [
    { key: 'teams', label: '👥 Teams & Divisions' },
    { key: 'categories', label: '🎯 Categories' },
    { key: 'bracket', label: '🏆 Bracket Config' },
  ]

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-meta">Admin → Events → {event.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h1>Edit: {event.name}</h1>
          <span className={`badge badge-${event.status}`}>{event.status}</span>
          <span className="badge badge-setup" style={{ background: '#1a237e', color: '#90caf9' }}>All-Play</span>
        </div>
        <div className="page-header-actions">
          <button onClick={() => navigate(`/admin/events/${id}`)} className="btn btn-secondary">← Back to Event</button>
          <Link to={`/events/${event.slug}/standings`} className="btn btn-secondary">Public View ↗</Link>
        </div>
      </div>

      <div className="page-content">
        {message && (
          <div className={`alert alert-${message.isError ? 'error' : 'success'}`} style={{ marginBottom: '1.5rem' }}>
            {message.text}
            <button onClick={() => setMessage(null)} style={{ float: 'right', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        <div className="tab-bar">
          {tabs.map(t => (
            <button key={t.key} className={`tab-btn ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {/* ── Teams & Divisions ── */}
        {activeTab === 'teams' && (
          <div>
            {/* Divisions */}
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <div className="card-title">Divisions</div>
              {divisions.length === 0
                ? <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No divisions yet. Add one below.</p>
                : divisions.map(div => (
                    <div key={div.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontWeight: 600 }}>{div.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 'auto', paddingLeft: 12 }}>
                        {teams.filter(t => t.division_id === div.id).length} teams
                      </span>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeleteDivision(div.id)}>Remove</button>
                    </div>
                  ))
              }
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                <input className="form-input" value={newDivName} onChange={e => setNewDivName(e.target.value)}
                  placeholder="Division name (e.g. Division 1)" style={{ flex: 1 }}
                  onKeyDown={e => e.key === 'Enter' && handleAddDivision()} />
                <button className="btn btn-primary btn-sm" onClick={handleAddDivision}>+ Add Division</button>
              </div>
            </div>

            {/* Teams per division */}
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
                        <thead>
                          <tr><th>#</th><th>Name</th><th>Display Name</th><th>Discord</th><th></th></tr>
                        </thead>
                        <tbody>
                          {divTeams.length === 0
                            ? <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>No teams yet</td></tr>
                            : divTeams.map(team => (
                                <tr key={team.id}>
                                  <td className="mono">{team.team_number}</td>
                                  <td>{team.name}</td>
                                  <td style={{ color: 'var(--text-muted)' }}>{team.display_name}</td>
                                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{team.discord_webhook_url ? '✓ Set' : '—'}</td>
                                  <td><button className="btn btn-danger btn-sm" onClick={() => handleDeleteTeam(team.id)}>Remove</button></td>
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

            {/* Add team form */}
            {divisions.length > 0 && (
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: 10 }}>
                  <div className="card-title" style={{ margin: 0 }}>Add Team</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <CsvImporter
                      label="Teams"
                      sampleHeaders={['team_name', 'display_name', 'division_name', 'discord_webhook']}
                      sampleRow={{ team_name: 'Team Alpha', display_name: 'Alpha', division_name: 'Division 1', discord_webhook: '' }}
                      onImport={importTeams}
                    />
                    <button onClick={exportTeams} style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>↓ Export CSV</button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Team Name *</label>
                    <input className="form-input" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="e.g. Team Alpha" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Display Name (optional)</label>
                    <input className="form-input" value={newTeamDisplay} onChange={e => setNewTeamDisplay(e.target.value)} placeholder="Defaults to team name" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Division *</label>
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

            {divisions.length === 0 && (
              <div className="alert alert-info">Add at least one division before adding teams.</div>
            )}
          </div>
        )}

        {/* ── Categories ── */}
        {activeTab === 'categories' && (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: 10 }}>
              <div className="card-title" style={{ margin: 0 }}>Encounter Categories</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CsvImporter
                  label="Categories"
                  sampleHeaders={['name', 'points', 'display_order']}
                  sampleRow={{ name: 'Shiny Legend', points: 100, display_order: 0 }}
                  onImport={importCategories}
                />
                <button onClick={exportCategories} style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>↓ Export CSV</button>
              </div>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Category</th><th>Points per Encounter</th><th>Order</th><th></th></tr>
                </thead>
                <tbody>
                  {categories.length === 0
                    ? <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>No categories yet</td></tr>
                    : categories.map(cat => (
                        <tr key={cat.id}>
                          <td style={{ fontWeight: 600 }}>{cat.name}</td>
                          <td className="mono">{cat.multiplier}</td>
                          <td className="mono" style={{ color: 'var(--text-muted)' }}>{cat.display_order}</td>
                          <td><button className="btn btn-danger btn-sm" onClick={() => handleDeleteCategory(cat.id)}>Remove</button></td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ margin: 0, flex: 1 }}>
                <label className="form-label">Category Name</label>
                <input className="form-input" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="e.g. Shiny Legend"
                  onKeyDown={e => e.key === 'Enter' && handleAddCategory()} />
              </div>
              <div className="form-group" style={{ margin: 0, width: 100 }}>
                <label className="form-label">Points</label>
                <input type="number" className="form-input" value={newCatPts} onChange={e => setNewCatPts(e.target.value)} min="1" />
              </div>
              <button className="btn btn-primary" onClick={handleAddCategory}>+ Add</button>
            </div>
          </div>
        )}

        {/* ── Bracket Config ── */}
        {activeTab === 'bracket' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="alert alert-info">
              Bracket config sets the format for each playoff round. Generate defaults first, then adjust as needed. Changes take effect when brackets are generated from the Event page.
            </div>

            {bracketConfig.length === 0 ? (
              <div className="card">
                <div className="empty-state" style={{ padding: '2rem' }}>
                  <p style={{ marginBottom: '1rem' }}>No bracket config found. Generate defaults to get started.</p>
                  <button className="btn btn-primary" disabled={saving} onClick={generateBracketConfig}>
                    {saving ? 'Generating...' : 'Generate Default Config'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div className="card-title" style={{ margin: 0 }}>Winner's Bracket</div>
                    <button className="btn btn-secondary btn-sm" disabled={saving} onClick={generateBracketConfig}>↺ Regenerate Defaults</button>
                  </div>
                  <div className="table-container">
                    <table>
                      <thead><tr><th>Round</th><th>Round Name</th><th>Format</th><th>Days/Game</th></tr></thead>
                      <tbody>
                        {winnersConfig.map(c => (
                          <tr key={c.id}>
                            <td className="mono">Round {c.round_number}</td>
                            <td>
                              <input className="form-input" defaultValue={c.round_name || ''} style={{ padding: '4px 8px', fontSize: 12 }}
                                onBlur={e => updateBracketRow(c.id, 'round_name', e.target.value || null)} placeholder="e.g. Semifinals" />
                            </td>
                            <td>
                              <select className="form-select" value={c.format} style={{ padding: '4px 8px', fontSize: 12 }}
                                onChange={e => updateBracketRow(c.id, 'format', e.target.value)}>
                                <option value="single">Single</option>
                                <option value="best_of_3">Best of 3</option>
                                <option value="best_of_5">Best of 5</option>
                              </select>
                            </td>
                            <td>
                              <input type="number" className="form-input" defaultValue={c.days_per_game} min={1} style={{ width: 60, padding: '4px 8px', fontSize: 12 }}
                                onBlur={e => updateBracketRow(c.id, 'days_per_game', parseInt(e.target.value) || 1)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">Loser's Bracket</div>
                  <div className="table-container">
                    <table>
                      <thead><tr><th>Round</th><th>Round Name</th><th>Format</th><th>Days/Game</th></tr></thead>
                      <tbody>
                        {losersConfig.map(c => (
                          <tr key={c.id}>
                            <td className="mono">L-Round {c.round_number}</td>
                            <td>
                              <input className="form-input" defaultValue={c.round_name || ''} style={{ padding: '4px 8px', fontSize: 12 }}
                                onBlur={e => updateBracketRow(c.id, 'round_name', e.target.value || null)} placeholder="e.g. 3rd Place" />
                            </td>
                            <td>
                              <select className="form-select" value={c.format} style={{ padding: '4px 8px', fontSize: 12 }}
                                onChange={e => updateBracketRow(c.id, 'format', e.target.value)}>
                                <option value="single">Single</option>
                                <option value="best_of_3">Best of 3</option>
                                <option value="best_of_5">Best of 5</option>
                              </select>
                            </td>
                            <td>
                              <input type="number" className="form-input" defaultValue={c.days_per_game} min={1} style={{ width: 60, padding: '4px 8px', fontSize: 12 }}
                                onBlur={e => updateBracketRow(c.id, 'days_per_game', parseInt(e.target.value) || 1)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}


      </div>
    </div>
  )
}
