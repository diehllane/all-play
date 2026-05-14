// src/pages/public/BoardGamePage.jsx
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { buildGrid, squareColor, calcBadges } from '../../lib/boardgame';
import Navbar from '../../components/Navbar';

const PLAYER_COLORS = ['#ef5350','#42a5f5','#66bb6a','#ffa726','#ab47bc','#26c6da','#d4e157','#ff7043'];

export default function BoardGamePage() {
  const { eventId } = useParams();
  const [event, setEvent]         = useState(null);
  const [config, setConfig]       = useState(null);
  const [squares, setSquares]     = useState([]);
  const [players, setPlayers]     = useState([]);
  const [positions, setPositions] = useState({});
  const [prizesEarned, setPrizesEarned] = useState([]); // from board_prizes_earned
  const [todayEntries, setTodayEntries] = useState({});
  const [allScoreEntries, setAllScoreEntries] = useState([]); // for daily scores table
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [tileSize, setTileSize]   = useState(56);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const load = useCallback(async () => {
    try {
      const [evRes, cfgRes, sqRes, plRes, posRes, prizeRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('board_game_config').select('*').eq('event_id', eventId).single(),
        supabase.from('board_squares').select('*').eq('event_id', eventId).order('square_number'),
        supabase.from('board_players').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('board_player_positions').select('*').eq('event_id', eventId),
        supabase.from('board_prizes_earned').select('*').eq('event_id', eventId),
      ]);
      if (evRes.error) throw evRes.error;
      setEvent(evRes.data);
      setConfig(cfgRes.data || { track_length: 252, grid_columns: 18, theme_color: '#c62828', badge_bonus_enabled: true, show_badge_sidebar: true });
      setSquares(sqRes.data || []);
      setPlayers(plRes.data || []);
      const posMap = {};
      (posRes.data || []).forEach(p => { posMap[p.player_id] = p.position; });
      setPositions(posMap);
      setPrizesEarned(prizeRes.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  // Load today's uncommitted entries + all committed score entries for daily table
  const loadEntries = useCallback(async () => {
    const { data: commits } = await supabase
      .from('board_commits')
      .select('day_number')
      .eq('event_id', eventId)
      .is('reverted_at', null)
      .order('day_number', { ascending: false })
      .limit(1);
    const lastDay = commits?.[0]?.day_number ?? 0;
    const nextDay = lastDay + 1;

    // Today's uncommitted entries for sidebar preview
    const { data: todayData } = await supabase
      .from('board_score_entries')
      .select('player_id, points')
      .eq('event_id', eventId)
      .eq('day_number', nextDay);
    const sums = {};
    (todayData || []).forEach(e => { sums[e.player_id] = (sums[e.player_id] || 0) + e.points; });
    setTodayEntries(sums);

    // All committed score entries for daily scores table
    const { data: allData } = await supabase
      .from('board_score_entries')
      .select('player_id, day_number, points')
      .eq('event_id', eventId)
      .lte('day_number', lastDay);
    setAllScoreEntries(allData || []);
  }, [eventId]);

  useEffect(() => {
    load();
    loadEntries();
  }, [load, loadEntries]);

  // Realtime subscription for live position + entry updates
  useEffect(() => {
    const posChannel = supabase
      .channel('board_positions_' + eventId)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'board_player_positions',
        filter: `event_id=eq.${eventId}`
      }, () => load())
      .subscribe();

    const entryChannel = supabase
      .channel('board_entries_' + eventId)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'board_score_entries',
        filter: `event_id=eq.${eventId}`
      }, () => loadEntries())
      .subscribe();

    const prizeChannel = supabase
      .channel('board_prizes_' + eventId)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'board_prizes_earned',
        filter: `event_id=eq.${eventId}`
      }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(posChannel);
      supabase.removeChannel(entryChannel);
      supabase.removeChannel(prizeChannel);
    };
  }, [eventId, load, loadEntries]);

  if (loading) return <div className="loading">Loading board...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!config) return <div className="error">No board config found for this event.</div>;

  const trackLength = config.track_length || 252;
  const gridColumns = config.grid_columns || 18;
  const themeColor  = config.theme_color || '#c62828';
  const grid = buildGrid(trackLength, gridColumns);
  const squareMap = {};
  squares.forEach(s => { squareMap[s.square_number] = s; });

  // Build grid rows for rendering
  const numRows = Math.ceil((trackLength + 1) / gridColumns);
  const rows = [];
  for (let r = 0; r < numRows; r++) {
    const row = [];
    for (let c = 0; c < gridColumns; c++) {
      // Find which square number is at (r, c)
      const sq = r % 2 === 0 ? r * gridColumns + c : r * gridColumns + (gridColumns - 1 - c);
      if (sq <= trackLength) row.push(sq);
    }
    rows.push(row);
  }

  const playersOnSquare = (sqNum) =>
    players.filter(p => (positions[p.id] || 0) === sqNum);

  const squareStyle = (sqNum) => {
    const sq = squareMap[sqNum];
    const type = sq?.type || 'normal';
    const bg = sq ? squareColor(type, themeColor) : '#1e1e2e';
    return {
      width: tileSize, height: tileSize,
      background: bg,
      border: selectedSquare === sqNum ? `2px solid #fff` : '1px solid #333',
      borderRadius: 4,
      position: 'relative',
      cursor: 'pointer',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: tileSize < 50 ? 9 : 11,
      flexShrink: 0,
    };
  };

  const popup = selectedSquare !== null ? squareMap[selectedSquare] : null;
  const popupPlayers = selectedSquare !== null ? playersOnSquare(selectedSquare) : [];

  // Badge sidebar data
  const sortedPlayers = [...players].sort((a, b) => {
    const posA = positions[a.id] || 0;
    const posB = positions[b.id] || 0;
    const badgesA = calcBadges(posA, squares).length;
    const badgesB = calcBadges(posB, squares).length;
    if (badgesB !== badgesA) return badgesB - badgesA;
    return posB - posA;
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d1a', color: '#fff', fontFamily: 'sans-serif' }}>
      <Navbar />
      {/* Header */}
      <div style={{ background: themeColor, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        {config.title_image_url
          ? <img src={config.title_image_url} alt="" style={{ height: 48 }} />
          : <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{event?.name}</h1>
        }
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ opacity: 0.8, fontSize: 13 }}>{players.length} players</span>
          <button onClick={() => setTileSize(s => Math.max(36, s - 8))}
            style={{ background: 'rgba(0,0,0,0.3)', border: 'none', color: '#fff', width: 28, height: 28, borderRadius: 4, cursor: 'pointer', fontSize: 16 }}>−</button>
          <button onClick={() => setTileSize(s => Math.min(100, s + 8))}
            style={{ background: 'rgba(0,0,0,0.3)', border: 'none', color: '#fff', width: 28, height: 28, borderRadius: 4, cursor: 'pointer', fontSize: 16 }}>+</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0 }}>
        {/* Board */}
        <div style={{ flex: 1, padding: 16, overflowX: 'auto' }}>
          <div style={{ display: 'inline-block' }}>
            {rows.map((row, rIdx) => (
              <div key={rIdx} style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
                {row.map(sqNum => {
                  const sq = squareMap[sqNum];
                  const onSquare = playersOnSquare(sqNum);
                  return (
                    <div key={sqNum} style={squareStyle(sqNum)} onClick={() => setSelectedSquare(selectedSquare === sqNum ? null : sqNum)}>
                      {/* Square number */}
                      <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 8, opacity: 0.6 }}>{sqNum}</span>
                      {/* Icon */}
                      {sq?.icon && <span style={{ fontSize: tileSize < 50 ? 12 : 16 }}>{sq.icon}</span>}
                      {/* Label */}
                      {sq?.label && tileSize >= 50 && (
                        <span style={{ fontSize: 8, textAlign: 'center', lineHeight: 1.1, padding: '0 2px', wordBreak: 'break-word', maxWidth: '100%' }}>
                          {sq.label}
                        </span>
                      )}
                      {/* Player dots */}
                      {onSquare.length > 0 && (
                        <div style={{ position: 'absolute', bottom: 2, right: 2, display: 'flex', flexWrap: 'wrap', gap: 1, maxWidth: tileSize - 4 }}>
                          {onSquare.map((p, i) => (
                            <div key={p.id} style={{
                              width: Math.max(8, tileSize / 7),
                              height: Math.max(8, tileSize / 7),
                              borderRadius: '50%',
                              background: PLAYER_COLORS[i % PLAYER_COLORS.length],
                              border: '1px solid rgba(255,255,255,0.5)',
                            }} title={p.name} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Popup */}
          {selectedSquare !== null && (
            <div style={{ marginTop: 16, background: '#1e1e2e', border: `2px solid ${themeColor}`, borderRadius: 8, padding: 16, maxWidth: 400 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {popup?.icon} {popup?.label || `Square ${selectedSquare}`}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
                    Square {selectedSquare} · {popup?.type?.replace(/_/g,' ') || 'Normal'}
                    {popup?.badge && <span style={{ marginLeft: 8, color: '#ffd700' }}>🏅 {popup.badge}</span>}
                    {popup?.jump_to != null && <span style={{ marginLeft: 8 }}>→ Square {popup.jump_to}</span>}
                    {popup?.move_amount != null && popup.type?.includes('small') && (
                      <span style={{ marginLeft: 8 }}>{popup.move_amount > 0 ? '+' : ''}{popup.move_amount} squares</span>
                    )}
                  </div>
                  {popup?.description && <p style={{ margin: '4px 0', fontSize: 13 }}>{popup.description}</p>}
                  {config.show_flavor_text && popup?.flavor_text && (
                    <p style={{ margin: '4px 0', fontSize: 12, fontStyle: 'italic', opacity: 0.75 }}>{popup.flavor_text}</p>
                  )}
                </div>
                <button onClick={() => setSelectedSquare(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18 }}>✕</button>
              </div>
              {popupPlayers.length > 0 && (
                <div style={{ marginTop: 8, borderTop: '1px solid #333', paddingTop: 8 }}>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Players here:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {popupPlayers.map((p, i) => (
                      <span key={p.id} style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length], color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Prize Tracker — driven from board_prizes_earned */}
          {(() => {
            const prizeSquares = squares.filter(s => s.type === 'prize');
            if (prizeSquares.length === 0) return null;
            return (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ color: themeColor, marginBottom: 12 }}>🎁 Prizes Owed</h3>
                <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 600 }}>
                  <thead>
                    <tr>
                      {['Square','Prize','Earned By'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 12px', borderBottom: '1px solid #333', fontSize: 12, opacity: 0.7 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {prizeSquares.map(prize => {
                      const earnedByIds = prizesEarned
                        .filter(pe => pe.square_number === prize.square_number)
                        .map(pe => pe.player_id);
                      const earnedByNames = players
                        .filter(p => earnedByIds.includes(p.id))
                        .map(p => p.name);
                      return (
                        <tr key={prize.id || prize.square_number}>
                          <td style={{ padding: '6px 12px', fontSize: 13 }}>{prize.square_number}</td>
                          <td style={{ padding: '6px 12px', fontSize: 13 }}>{prize.icon} {prize.label}</td>
                          <td style={{ padding: '6px 12px', fontSize: 13 }}>
                            {earnedByNames.length === 0
                              ? <span style={{ opacity: 0.4 }}>None yet</span>
                              : earnedByNames.map((name, i) => (
                                <span key={i} style={{ background: '#1a3a1a', color: '#81c784', padding: '1px 8px', borderRadius: 10, fontSize: 12, marginRight: 4 }}>
                                  {name}
                                </span>
                              ))
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* Player Scores By Day */}
          {allScoreEntries.length > 0 && (() => {
            const days = [...new Set(allScoreEntries.map(e => e.day_number))].sort((a, b) => a - b);
            // Build per-player per-day totals
            const playerDayTotals = {};
            players.forEach(p => { playerDayTotals[p.id] = {}; });
            allScoreEntries.forEach(e => {
              if (!playerDayTotals[e.player_id]) return;
              playerDayTotals[e.player_id][e.day_number] =
                (playerDayTotals[e.player_id][e.day_number] || 0) + e.points;
            });
            const sortedPlayers = [...players].sort((a, b) => {
              const totA = Object.values(playerDayTotals[a.id] || {}).reduce((s, v) => s + v, 0);
              const totB = Object.values(playerDayTotals[b.id] || {}).reduce((s, v) => s + v, 0);
              return totB - totA;
            });
            return (
              <div style={{ marginTop: 32 }}>
                <h3 style={{ color: themeColor, marginBottom: 12 }}>📊 Player Scores By Day</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 400 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '6px 12px', borderBottom: '1px solid #333', opacity: 0.7, fontWeight: 400 }}>Player</th>
                        {days.map(d => (
                          <th key={d} style={{ textAlign: 'right', padding: '6px 12px', borderBottom: '1px solid #333', opacity: 0.7, fontWeight: 400, whiteSpace: 'nowrap' }}>
                            Day {d}
                          </th>
                        ))}
                        <th style={{ textAlign: 'right', padding: '6px 12px', borderBottom: '1px solid #333', fontWeight: 700 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPlayers.map((p, i) => {
                        const dayMap = playerDayTotals[p.id] || {};
                        const total = Object.values(dayMap).reduce((s, v) => s + v, 0);
                        return (
                          <tr key={p.id} style={{ borderBottom: '1px solid #1a1a2e' }}>
                            <td style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                width: 20, height: 20, borderRadius: '50%',
                                background: PLAYER_COLORS[i % PLAYER_COLORS.length],
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 700, flexShrink: 0
                              }}>
                                {p.avatar_url
                                  ? <img src={p.avatar_url} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} alt="" />
                                  : p.name.charAt(0)
                                }
                              </div>
                              {p.name}
                            </td>
                            {days.map(d => (
                              <td key={d} style={{ padding: '6px 12px', textAlign: 'right', opacity: dayMap[d] ? 1 : 0.3 }}>
                                {dayMap[d] || 0}
                              </td>
                            ))}
                            <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 700, color: '#ffd700' }}>{total}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Sidebar */}
        {config.show_badge_sidebar !== false && (
          <div style={{ width: 260, background: '#13131f', borderLeft: '1px solid #2a2a3e', padding: 16, overflowY: 'auto', maxHeight: 'calc(100vh - 80px)', position: 'sticky', top: 0 }}>
            <h3 style={{ color: themeColor, margin: '0 0 12px 0', fontSize: 14 }}>🏅 Badge Leaderboard</h3>
            {sortedPlayers.map((p, i) => {
              const pos = positions[p.id] || 0;
              const badges = calcBadges(pos, squares);
              const pct = ((pos / trackLength) * 100).toFixed(1);
              const todayPts = todayEntries[p.id] || 0;
              return (
                <div key={p.id} style={{ marginBottom: 12, padding: 10, background: '#1e1e2e', borderRadius: 6, border: `1px solid ${i === 0 ? themeColor : '#2a2a3e'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: PLAYER_COLORS[i % PLAYER_COLORS.length],
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, flexShrink: 0
                    }}>
                      {p.avatar_url
                        ? <img src={p.avatar_url} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} alt="" />
                        : p.name.charAt(0).toUpperCase()
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>Sq {pos} · {pct}%</div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#ffd700' }}>{badges.length}🏅</div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 4, background: '#2a2a3e', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: pct + '%', height: '100%', background: themeColor, transition: 'width 0.5s' }} />
                  </div>
                  {todayPts > 0 && (
                    <div style={{ fontSize: 10, color: '#4caf50', marginTop: 4 }}>+{todayPts} pts today (uncommitted)</div>
                  )}
                  {/* Badge chips */}
                  {badges.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                      {badges.map(b => (
                        <span key={b.id} style={{ fontSize: 9, background: '#2a2a3e', padding: '1px 5px', borderRadius: 8, color: '#ffd700' }}>
                          {b.icon} {b.badge}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
