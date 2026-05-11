import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import Navbar from '../../components/Navbar'
import { buildScheduleRows } from '../../lib/schedule'

const STEPS = ['Event Setup', 'Divisions & Teams', 'Categories', 'Confirm']

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36)
}

export default function CreateEventPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Event config
  const [eventName, setEventName] = useState('')
  const [divisionCount, setDivisionCount] = useState(1)

  // Divisions and teams
  const [divisions, setDivisions] = useState([{ name: 'Division 1', teams: [] }])
  const [newTeamNames, setNewTeamNames] = useState([''])

  // Categories
  const [categories, setCategories] = useState([
    { name: 'Common', multiplier: 1 },
    { name: 'Uncommon', multiplier: 2 },
    { name: 'Rare', multiplier: 5 },
  ])

  function handleDivisionCountChange(count) {
    setDivisionCount(count)
    const newDivs = Array.from({ length: count }, (_, i) => ({
      name: divisions[i]?.name || `Division ${i + 1}`,
      teams: divisions[i]?.teams || []
    }))
    setDivisions(newDivs)
    setNewTeamNames(Array(count).fill(''))
  }

  function addTeam(divIndex) {
    const name = newTeamNames[divIndex]?.trim()
    if (!name) return
    const teamNumber = divisions.reduce((sum, d) => sum + d.teams.length, 0) + 1
    const updated = [...divisions]
    updated[divIndex].teams.push({ name, team_number: teamNumber })
    setDivisions(updated)
    const names = [...newTeamNames]
    names[divIndex] = ''
    setNewTeamNames(names)
  }

  function removeTeam(divIndex, teamIndex) {
    const updated = [...divisions]
    updated[divIndex].teams.splice(teamIndex, 1)
    // Renumber all teams
    let num = 1
    updated.forEach(d => d.teams.forEach(t => { t.team_number = num++ }))
    setDivisions(updated)
  }

  function addCategory() {
    setCategories([...categories, { name: '', multiplier: 1 }])
  }

  function updateCategory(i, field, value) {
    const updated = [...categories]
    updated[i][field] = field === 'multiplier' ? parseFloat(value) || 1 : value
    setCategories(updated)
  }

  function removeCategory(i) {
    setCategories(categories.filter((_, idx) => idx !== i))
  }

  async function handleCreate() {
    setSaving(true)
    setError('')
    try {
      // Create event
      const { data: event, error: evErr } = await supabase.from('events').insert({
        name: eventName.trim(),
        slug: slugify(eventName),
        division_count: divisionCount,
        status: 'setup',
        created_by: profile.id
      }).select().single()
      if (evErr) throw evErr

      // Create divisions and teams
      for (let divIdx = 0; divIdx < divisions.length; divIdx++) {
        const div = divisions[divIdx]
        const { data: divRow, error: divErr } = await supabase.from('divisions').insert({
          event_id: event.id,
          division_number: divIdx + 1,
          name: div.name
        }).select().single()
        if (divErr) throw divErr

        if (div.teams.length > 0) {
          const { data: teamRows, error: teamErr } = await supabase.from('teams').insert(
            div.teams.map(t => ({
              event_id: event.id,
              division_id: divRow.id,
              team_number: t.team_number,
              name: t.name
            }))
          ).select()
          if (teamErr) throw teamErr

          // Generate schedule for this division
          const teamIds = teamRows.map(t => t.id)
          if (teamIds.length >= 2) {
            const scheduleRows = buildScheduleRows(event.id, divRow.id, teamIds)
            if (scheduleRows.length > 0) {
              const { error: schedErr } = await supabase.from('schedule').insert(scheduleRows)
              if (schedErr) throw schedErr
            }
          }

          // Initialize standings for each team
          const standingsRows = teamRows.map(t => ({
            event_id: event.id,
            team_id: t.id,
            division_id: divRow.id,
          }))
          await supabase.from('standings').insert(standingsRows)
        }
      }

      // Create categories
      if (categories.length > 0) {
        const { error: catErr } = await supabase.from('categories').insert(
          categories.map((c, i) => ({
            event_id: event.id,
            name: c.name,
            multiplier: c.multiplier,
            display_order: i
          }))
        )
        if (catErr) throw catErr
      }

      navigate(`/admin/event/${event.id}`)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const canProceed = () => {
    if (step === 0) return eventName.trim().length > 0
    if (step === 1) return divisions.every(d => d.teams.length >= 2)
    if (step === 2) return categories.length > 0 && categories.every(c => c.name.trim())
    return true
  }

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">Admin → Create</div>
          <h1>New Event</h1>
        </div>

        <div className="page-content" style={{ maxWidth: 700 }}>
          {/* Step indicator */}
          <div style={{ display: 'flex', gap: '0', marginBottom: '2rem', background: 'var(--bg-card)', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{
                flex: 1, padding: '0.65rem 0', textAlign: 'center',
                fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em',
                background: i === step ? 'var(--accent-gold)' : i < step ? 'rgba(245,200,66,0.15)' : 'transparent',
                color: i === step ? '#0a0e1a' : i < step ? 'var(--accent-gold)' : 'var(--text-muted)',
                transition: 'all 0.2s'
              }}>
                {i < step ? '✓ ' : ''}{s}
              </div>
            ))}
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          {/* Step 0: Event Setup */}
          {step === 0 && (
            <div className="card">
              <div className="card-title">Event Details</div>
              <div className="form-group">
                <label className="form-label">Event Name</label>
                <input className="form-input" value={eventName} onChange={e => setEventName(e.target.value)}
                  placeholder="e.g. Pokemon Summer Grind 2025" autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Number of Divisions</label>
                <select className="form-select" value={divisionCount}
                  onChange={e => handleDivisionCountChange(parseInt(e.target.value))}>
                  {[1,2,3,4].map(n => <option key={n} value={n}>{n} Division{n > 1 ? 's' : ''}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Step 1: Divisions & Teams */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {divisions.map((div, divIdx) => (
                <div key={divIdx} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <div className="card-title" style={{ margin: 0 }}>Division {divIdx + 1}</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Division Name</label>
                    <input className="form-input" value={div.name}
                      onChange={e => { const d = [...divisions]; d[divIdx].name = e.target.value; setDivisions(d) }}
                      placeholder={`Division ${divIdx + 1}`} />
                  </div>

                  <div style={{ marginBottom: '1rem' }}>
                    <div className="form-label">Teams ({div.teams.length})</div>
                    {div.teams.map((team, teamIdx) => (
                      <div key={teamIdx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', minWidth: 24 }}>#{team.team_number}</span>
                        <span style={{ flex: 1 }}>Team #{team.team_number} {team.name}</span>
                        <button className="btn btn-danger btn-sm" onClick={() => removeTeam(divIdx, teamIdx)}>✕</button>
                      </div>
                    ))}
                    {div.teams.length < 2 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--accent-red)', marginTop: '0.5rem' }}>
                        Add at least 2 teams to this division.
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input className="form-input" value={newTeamNames[divIdx] || ''}
                      onChange={e => { const n = [...newTeamNames]; n[divIdx] = e.target.value; setNewTeamNames(n) }}
                      placeholder="Team name (e.g. Victini Lovers)"
                      onKeyDown={e => e.key === 'Enter' && addTeam(divIdx)} />
                    <button className="btn btn-primary" onClick={() => addTeam(divIdx)}>Add</button>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                    Teams will be assigned numbers automatically (Team #1, Team #2, etc.)
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 2: Categories */}
          {step === 2 && (
            <div className="card">
              <div className="card-title">Encounter Categories & Multipliers</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                Each category defines a type of encounter and how many points each one is worth.
              </p>

              {categories.map((cat, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', alignItems: 'center' }}>
                  <input className="form-input" value={cat.name}
                    onChange={e => updateCategory(i, 'name', e.target.value)}
                    placeholder="Category name" style={{ flex: 2 }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                    <input className="form-input" type="number" min="0.1" step="0.5" value={cat.multiplier}
                      onChange={e => updateCategory(i, 'multiplier', e.target.value)}
                      style={{ flex: 1 }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>pts/ea</span>
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => removeCategory(i)} disabled={categories.length === 1}>✕</button>
                </div>
              ))}

              <button className="btn btn-secondary" onClick={addCategory} style={{ marginTop: '0.5rem' }}>
                + Add Category
              </button>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="card">
              <div className="card-title">Confirm Event Setup</div>
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>{eventName}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{divisionCount} Division{divisionCount > 1 ? 's' : ''}</div>
              </div>

              {divisions.map((div, i) => (
                <div key={i} style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.5rem' }}>{div.name}</div>
                  {div.teams.map(t => (
                    <div key={t.team_number} style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', padding: '0.2rem 0' }}>
                      Team #{t.team_number} {t.name}
                    </div>
                  ))}
                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--accent-green)' }}>
                    ✓ {div.teams.length - 1} day round robin schedule will be generated
                  </div>
                </div>
              ))}

              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.5rem' }}>Encounter Categories</div>
                {categories.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', color: 'var(--text-secondary)', padding: '0.2rem 0' }}>
                    <span>{c.name}</span>
                    <span className="mono">{c.multiplier} pts/encounter</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
            <button className="btn btn-secondary" onClick={() => setStep(s => s - 1)} disabled={step === 0}>
              ← Back
            </button>
            {step < STEPS.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setStep(s => s + 1)} disabled={!canProceed()}>
                Continue →
              </button>
            ) : (
              <button className="btn btn-primary btn-lg" onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating Event...' : '🚀 Create Event'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
