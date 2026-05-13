// src/components/BoardBuilder.jsx
// Drag-and-drop board tile editor.
// Used in CreateEventPage (board game wizard step) and BoardGameEditPage.

import { useState, useCallback } from 'react';
import { SQUARE_TYPES, squareColor, DEFAULT_BOARD_SQUARES } from '../lib/boardgame';

const EMPTY_SQUARE = {
  square_number: '',
  type: 'gym',
  label: '',
  icon: '',
  jump_to: '',
  move_amount: '',
  badge: '',
  description: '',
  flavor_text: '',
};

export default function BoardBuilder({ squares, onChange, trackLength = 252, gridColumns = 18, themeColor = '#c62828' }) {
  const [editingSquare, setEditingSquare] = useState(null); // square data being edited
  const [editMode, setEditMode]           = useState(false); // false = visual, true = table
  const [dragFrom, setDragFrom]           = useState(null);
  const [form, setForm]                   = useState(EMPTY_SQUARE);
  const [filterType, setFilterType]       = useState('');

  const squareMap = {};
  squares.forEach(s => { squareMap[s.square_number] = s; });

  // ── Drag and drop ────────────────────────────────────────
  const handleDragStart = (sqNum) => setDragFrom(sqNum);

  const handleDrop = (targetNum) => {
    if (dragFrom === null || dragFrom === targetNum) { setDragFrom(null); return; }
    // Swap square numbers
    const updated = squares.map(s => {
      if (s.square_number === dragFrom) return { ...s, square_number: targetNum };
      if (s.square_number === targetNum) return { ...s, square_number: dragFrom };
      return s;
    });
    onChange(updated);
    setDragFrom(null);
  };

  // ── Add / Edit / Delete ──────────────────────────────────
  const openAdd = (sqNum) => {
    setForm({ ...EMPTY_SQUARE, square_number: sqNum });
    setEditingSquare('new');
  };

  const openEdit = (sq) => {
    setForm({
      square_number: sq.square_number,
      type: sq.type || 'gym',
      label: sq.label || '',
      icon: sq.icon || '',
      jump_to: sq.jump_to ?? '',
      move_amount: sq.move_amount ?? '',
      badge: sq.badge || '',
      description: sq.description || '',
      flavor_text: sq.flavor_text || '',
    });
    setEditingSquare(sq.square_number);
  };

  const handleSave = () => {
    const sqNum = parseInt(form.square_number);
    if (isNaN(sqNum) || sqNum < 0 || sqNum > trackLength) {
      alert(`Square number must be between 0 and ${trackLength}`);
      return;
    }
    const newSq = {
      square_number: sqNum,
      type: form.type,
      label: form.label || null,
      icon: form.icon || null,
      jump_to: form.jump_to !== '' ? parseInt(form.jump_to) : null,
      move_amount: form.move_amount !== '' ? parseInt(form.move_amount) : null,
      badge: form.badge || null,
      description: form.description || null,
      flavor_text: form.flavor_text || null,
    };
    const existing = squares.findIndex(s => s.square_number === sqNum);
    let updated;
    if (existing >= 0) {
      updated = [...squares];
      updated[existing] = newSq;
    } else {
      updated = [...squares, newSq].sort((a, b) => a.square_number - b.square_number);
    }
    onChange(updated);
    setEditingSquare(null);
  };

  const handleDelete = (sqNum) => {
    if (!confirm(`Remove tile at square ${sqNum}?`)) return;
    onChange(squares.filter(s => s.square_number !== sqNum));
  };

  const handleLoadDefaults = () => {
    if (!confirm('Load default Kanto/Johto board? This will replace your current tiles.')) return;
    onChange(DEFAULT_BOARD_SQUARES.map(s => ({ ...s })));
  };

  // ── Visual grid ──────────────────────────────────────────
  const tileSize = 44;
  const numRows = Math.ceil((trackLength + 1) / gridColumns);
  const rows = [];
  for (let r = 0; r < numRows; r++) {
    const row = [];
    for (let c = 0; c < gridColumns; c++) {
      const sq = r % 2 === 0 ? r * gridColumns + c : r * gridColumns + (gridColumns - 1 - c);
      if (sq <= trackLength) row.push(sq);
    }
    rows.push(row);
  }

  const filteredSquares = filterType ? squares.filter(s => s.type === filterType) : squares;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setEditMode(m => !m)}
          style={{ padding: '6px 14px', background: '#2a2a3e', border: '1px solid #444', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
          {editMode ? '🗺 Visual Board' : '📋 Table View'}
        </button>
        <button onClick={handleLoadDefaults}
          style={{ padding: '6px 14px', background: '#1a3a1a', border: '1px solid #2e7d32', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
          Load Default Kanto/Johto
        </button>
        <button onClick={() => openAdd('')}
          style={{ padding: '6px 14px', background: themeColor, border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          + Add Tile
        </button>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{squares.length} tiles defined</span>
      </div>

      {/* Visual mode */}
      {!editMode && (
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <div style={{ display: 'inline-block', border: '1px solid #2a2a3e', borderRadius: 6, padding: 8 }}>
            {rows.map((row, rIdx) => (
              <div key={rIdx} style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
                {row.map(sqNum => {
                  const sq = squareMap[sqNum];
                  const bg = sq ? squareColor(sq.type, themeColor) : '#1a1a2e';
                  const isDragTarget = dragFrom !== null && dragFrom !== sqNum;
                  return (
                    <div
                      key={sqNum}
                      draggable={!!sq}
                      onDragStart={() => sq && handleDragStart(sqNum)}
                      onDragOver={e => { e.preventDefault(); }}
                      onDrop={() => handleDrop(sqNum)}
                      onClick={() => sq ? openEdit(sq) : openAdd(sqNum)}
                      title={sq ? `${sq.type}: ${sq.label || sqNum}` : `Empty square ${sqNum}`}
                      style={{
                        width: tileSize, height: tileSize,
                        background: bg,
                        border: isDragTarget ? '2px dashed #fff' : '1px solid #222',
                        borderRadius: 4,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        cursor: sq ? 'grab' : 'pointer',
                        fontSize: 9,
                        position: 'relative',
                        opacity: dragFrom === sqNum ? 0.5 : 1,
                        flexShrink: 0,
                      }}>
                      <span style={{ position: 'absolute', top: 1, left: 2, fontSize: 7, opacity: 0.5 }}>{sqNum}</span>
                      {sq?.icon && <span style={{ fontSize: 14 }}>{sq.icon}</span>}
                      {!sq && <span style={{ fontSize: 8, opacity: 0.2 }}>+</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>Click a tile to edit · Drag to move · Click empty square to add</div>
        </div>
      )}

      {/* Table mode */}
      {editMode && (
        <div style={{ marginBottom: 16 }}>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ marginBottom: 10, padding: '6px 12px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }}>
            <option value="">All types</option>
            {SQUARE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Sq#','Type','Label','Icon','JumpTo','Move±','Badge',''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #2a2a3e', opacity: 0.6, fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSquares.sort((a,b) => a.square_number - b.square_number).map(sq => (
                <tr key={sq.square_number} style={{ borderBottom: '1px solid #1a1a2e' }}>
                  <td style={{ padding: '5px 8px' }}>{sq.square_number}</td>
                  <td style={{ padding: '5px 8px' }}>
                    <span style={{ background: squareColor(sq.type, themeColor), padding: '1px 6px', borderRadius: 8, fontSize: 11 }}>{sq.type}</span>
                  </td>
                  <td style={{ padding: '5px 8px', opacity: 0.8 }}>{sq.label || '—'}</td>
                  <td style={{ padding: '5px 8px' }}>{sq.icon || '—'}</td>
                  <td style={{ padding: '5px 8px', opacity: 0.8 }}>{sq.jump_to ?? '—'}</td>
                  <td style={{ padding: '5px 8px', opacity: 0.8 }}>{sq.move_amount ?? '—'}</td>
                  <td style={{ padding: '5px 8px', opacity: 0.8, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sq.badge || '—'}</td>
                  <td style={{ padding: '5px 8px' }}>
                    <button onClick={() => openEdit(sq)} style={{ background: 'none', border: 'none', color: '#90caf9', cursor: 'pointer', marginRight: 8, fontSize: 12 }}>Edit</button>
                    <button onClick={() => handleDelete(sq.square_number)} style={{ background: 'none', border: 'none', color: '#ef5350', cursor: 'pointer', fontSize: 12 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit / Add modal */}
      {editingSquare !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e1e2e', border: `2px solid ${themeColor}`, borderRadius: 10, padding: 24, width: 420, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{editingSquare === 'new' ? 'Add Tile' : `Edit Square ${editingSquare}`}</h3>
              <button onClick={() => setEditingSquare(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Square Number" value={form.square_number} onChange={v => setForm(f => ({ ...f, square_number: v }))} type="number" disabled={editingSquare !== 'new'} />
              <div>
                <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Type</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }}>
                  {SQUARE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <Field label="Label" value={form.label} onChange={v => setForm(f => ({ ...f, label: v }))} placeholder="Display name on tile" />
              <Field label="Icon (emoji)" value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} placeholder="🏅" />
              {(form.type === 'bonus_jump' || form.type === 'penalty_jump') && (
                <Field label="Jump To (square #)" value={form.jump_to} onChange={v => setForm(f => ({ ...f, jump_to: v }))} type="number" />
              )}
              {(form.type === 'bonus_small' || form.type === 'penalty_small') && (
                <Field label="Move Amount" value={form.move_amount} onChange={v => setForm(f => ({ ...f, move_amount: v }))} type="number" placeholder="e.g. 2" />
              )}
              {form.type === 'gym' && (
                <Field label="Badge Name" value={form.badge} onChange={v => setForm(f => ({ ...f, badge: v }))} placeholder="Boulder Badge" />
              )}
              <Field label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Shown in popup" />
              <Field label="Flavor Text" value={form.flavor_text} onChange={v => setForm(f => ({ ...f, flavor_text: v }))} placeholder="Story text" />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={handleSave}
                style={{ flex: 1, padding: '9px 0', background: themeColor, border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
                Save Tile
              </button>
              {editingSquare !== 'new' && (
                <button onClick={() => { handleDelete(parseInt(editingSquare)); setEditingSquare(null); }}
                  style={{ padding: '9px 16px', background: '#4a1010', border: '1px solid #c62828', color: '#fff', borderRadius: 6, cursor: 'pointer' }}>
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder = '', disabled = false }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ width: '100%', padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', opacity: disabled ? 0.5 : 1 }}
      />
    </div>
  );
}
