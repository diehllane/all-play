// src/pages/admin/AuditLogPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

const EVENT_TYPES = [
  { value: '',               label: 'All Types' },
  { value: 'score_entry',   label: 'Score Entry' },
  { value: 'commit',        label: 'Commit' },
  { value: 'undo',          label: 'Undo' },
  { value: 'config_change', label: 'Config Change' },
  { value: 'account_create',label: 'Account Created' },
  { value: 'role_change',   label: 'Role Change' },
]

const TYPE_COLORS = {
  score_entry:    '#4a90d9',
  commit:         '#27ae60',
  undo:           '#e67e22',
  config_change:  '#8e44ad',
  account_create: '#16a085',
  role_change:    '#c0392b',
}

const PAGE_SIZE = 50

export default function AuditLogPage() {
  const { profile } = useAuth()
  const canView = profile?.role === 'owner' || profile?.role === 'event_runner'

  const [logs, setLogs]         = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(0)
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState(null)

  const [filterType, setFilterType]   = useState('')
  const [filterActor, setFilterActor] = useState('')
  const [filterEvent, setFilterEvent] = useState('')
  const [filterFrom, setFilterFrom]   = useState('')
  const [filterTo, setFilterTo]       = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (filterType)  q = q.eq('event_type', filterType)
    if (filterActor) q = q.ilike('actor_email', `%${filterActor}%`)
    if (filterEvent) q = q.ilike('event_name', `%${filterEvent}%`)
    if (filterFrom)  q = q.gte('created_at', filterFrom)
    if (filterTo)    q = q.lte('created_at', filterTo + 'T23:59:59Z')

    const { data, count } = await q
    setLogs(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, filterType, filterActor, filterEvent, filterFrom, filterTo])

  useEffect(() => { if (canView) load() }, [load, canView])

  const applyFilters = (e) => { e.preventDefault(); setPage(0); load() }
  const clearFilters = () => {
    setFilterType(''); setFilterActor(''); setFilterEvent('')
    setFilterFrom(''); setFilterTo(''); setPage(0)
  }

  if (!canView) return <div style={s.page}><p style={{ color: '#e57373' }}>Access denied.</p></div>

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <Link to="/admin" style={s.back}>← Dashboard</Link>
          <h1 style={s.title}>Audit Log</h1>
        </div>
        <span style={{ color: '#666', fontSize: 13 }}>{total.toLocaleString()} records</span>
      </div>

      {/* Filters */}
      <form onSubmit={applyFilters} style={s.filterBar}>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={s.ctrl}>
          {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input type="text" placeholder="Actor..." value={filterActor} onChange={e => setFilterActor(e.target.value)} style={s.ctrl} />
        <input type="text" placeholder="Event name..." value={filterEvent} onChange={e => setFilterEvent(e.target.value)} style={s.ctrl} />
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={s.ctrl} title="From" />
        <input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   style={s.ctrl} title="To" />
        <button type="submit" style={s.applyBtn}>Apply</button>
        <button type="button" onClick={clearFilters} style={s.clearBtn}>Clear</button>
      </form>

      {loading ? (
        <p style={{ color: '#888' }}>Loading...</p>
      ) : logs.length === 0 ? (
        <p style={{ color: '#666' }}>No records match your filters.</p>
      ) : (
        <>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Time','Type','Actor','Event','Action',''].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <>
                    <tr
                      key={log.id}
                      onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                      style={{ borderBottom: '1px solid #1e1e2e', cursor: log.metadata ? 'pointer' : 'default' }}
                    >
                      <td style={s.td}>
                        <div style={{ color: '#ccc', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {new Date(log.created_at).toLocaleDateString()}
                        </div>
                        <div style={{ color: '#666', fontSize: 11 }}>
                          {new Date(log.created_at).toLocaleTimeString()}
                        </div>
                      </td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, background: TYPE_COLORS[log.event_type] ?? '#555' }}>
                          {log.event_type?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={s.td}>
                        <div style={{ color: '#ddd', fontSize: 13 }}>{log.actor_email ?? '—'}</div>
                        {log.actor_role && <div style={{ color: '#666', fontSize: 11 }}>{log.actor_role}</div>}
                      </td>
                      <td style={s.td}>
                        <span style={{ color: '#aaa', fontSize: 13 }}>{log.event_name ?? '—'}</span>
                      </td>
                      <td style={s.td}>
                        <div style={{ color: '#eee', fontSize: 13 }}>{log.action}</div>
                        {log.target_name && (
                          <div style={{ color: '#666', fontSize: 11 }}>→ {log.target_name}</div>
                        )}
                      </td>
                      <td style={s.td}>
                        {log.metadata && (
                          <span style={{ color: '#555', fontSize: 12 }}>{expanded === log.id ? '▲' : '▼'}</span>
                        )}
                      </td>
                    </tr>
                    {expanded === log.id && log.metadata && (
                      <tr key={log.id + '-x'}>
                        <td colSpan={6} style={{ background: '#0a0a18', padding: '8px 16px' }}>
                          <pre style={{ margin: 0, color: '#7ec8e3', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', marginTop: 20 }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={s.pgBtn}>← Prev</button>
            <span style={{ color: '#888', fontSize: 13 }}>Page {page + 1} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={s.pgBtn}>Next →</button>
          </div>
        </>
      )}
    </div>
  )
}

const s = {
  page:      { minHeight: '100vh', background: '#0d0d1a', color: '#eee', padding: '1.5rem', fontFamily: 'sans-serif' },
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.25rem' },
  back:      { color: '#888', textDecoration: 'none', fontSize: 13, display: 'block', marginBottom: 4 },
  title:     { margin: 0, fontSize: '1.5rem', color: '#fff' },
  filterBar: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1.25rem', alignItems: 'center' },
  ctrl:      { background: '#1e1e2e', border: '1px solid #333', color: '#eee', padding: '6px 10px', borderRadius: 5, fontSize: 13 },
  applyBtn:  { background: '#c62828', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 13 },
  clearBtn:  { background: 'transparent', border: '1px solid #444', color: '#888', padding: '6px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 13 },
  tableWrap: { overflowX: 'auto', borderRadius: 8, border: '1px solid #1e1e2e' },
  table:     { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:        { background: '#111', color: '#666', padding: '8px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #1e1e2e', whiteSpace: 'nowrap' },
  td:        { padding: '8px 12px', verticalAlign: 'top' },
  badge:     { display: 'inline-block', padding: '2px 7px', borderRadius: 3, fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  pgBtn:     { background: '#1e1e2e', border: '1px solid #333', color: '#ccc', padding: '5px 12px', borderRadius: 5, cursor: 'pointer' },
}
