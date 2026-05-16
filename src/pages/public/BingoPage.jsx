import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getBingoLines, getLineName, TEAM_COLORS } from '../../lib/bingo';

// ── Helpers ────────────────────────────────────────────────
function positionLabel(pos) {
  const row = Math.floor(pos / 5);
  const col = pos % 5;
  return `R${row + 1}C${col + 1}`;
}

function getLinePositions(line) { return line.positions; }

// ── Sub-components ─────────────────────────────────────────

function BingoCard({ config, squares, player, team, completions, teamCompletions, linesCompleted, allPlayers, scores, teamScores }) {
  const isTeam = config.event_type === 'team';
  const freeSquare = config.free_space_enabled ? squares.find(s => s.is_free_space) : null;
  const bingoLines = getBingoLines();

  // Completions for this card subject (team or player)
  const getAvailable = (squareId) => {
    if (isTeam) {
      return teamCompletions[team?.id]?.[squareId] ?? 0;
    }
    return completions[player?.id]?.[squareId] ?? 0;
  };

  // Per-player available counts for color breakdown on a square
  const getPlayerCounts = (squareId) => {
    if (!isTeam) return [];
    const teamPlayers = allPlayers.filter(p => p.team_id === team?.id);
    return teamPlayers.map(p => ({
      player: p,
      count: completions[p.id]?.[squareId] ?? 0,
    })).filter(x => x.count > 0);
  };

  // Completed bingo lines for this subject
  const subjectLines = linesCompleted.filter(l =>
    isTeam ? l.team_id === team?.id && !l.is_individual : l.player_id === player?.id
  );
  const completedLineKeys = new Set(subjectLines.map(l => `${l.line_type}-${l.line_index}`));

  // Score display
  const score = isTeam
    ? teamScores.find(s => s.team_id === team?.id)
    : scores.find(s => s.player_id === player?.id);

  const title = isTeam ? team?.name : player?.name;
  const avatarUrl = isTeam ? team?.avatar_url : player?.avatar_url;
  const themeColor = config.theme_color || '#c62828';

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid var(--border)`,
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: 32,
    }}>
      {/* Card header */}
      <div style={{
        background: `${themeColor}22`,
        borderBottom: `2px solid ${themeColor}`,
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}>
        {avatarUrl && (
          <img src={avatarUrl} alt={title} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${themeColor}` }} />
        )}
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>{title}</div>
          {isTeam && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
              {allPlayers.filter(p => p.team_id === team?.id).map(p => p.name).join(' · ')}
            </div>
          )}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: themeColor }}>{score?.total_score ?? 0}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>Total Score</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: themeColor }}>{score?.bingo_count ?? 0}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>Bingos</div>
          </div>
        </div>
      </div>

      <div style={{ padding: 20, display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        {/* 5×5 Grid */}
        <div>
          {/* Column headers with values */}
          <div style={{ display: 'grid', gridTemplateColumns: '20px repeat(5, 90px)', gap: 3, marginBottom: 3 }}>
            <div />
            {[0,1,2,3,4].map(c => (
              <div key={c} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>
                {config[`col${c+1}_value`] > 0 ? `${config[`col${c+1}_value`]}pts ↑` : ''}
              </div>
            ))}
          </div>
          {[0,1,2,3,4].map(row => (
            <div key={row} style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
              {/* Row label */}
              <div style={{ width: 20, fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, textAlign: 'right' }}>
                {config[`row${row+1}_value`] > 0 ? `${config[`row${row+1}_value`]}` : ''}
              </div>
              {[0,1,2,3,4].map(col => {
                const pos = row * 5 + col;
                const sq = squares.find(s => s.position === pos);
                if (!sq) return <div key={col} style={{ width: 90, height: 80 }} />;
                const isFree = sq.is_free_space;
                const available = isFree ? '∞' : getAvailable(sq.id);
                const playerCounts = isTeam ? getPlayerCounts(sq.id) : [];
                const hasCompletion = isFree || getAvailable(sq.id) > 0;

                return (
                  <div key={col} style={{
                    width: 90,
                    height: 80,
                    borderRadius: 6,
                    border: `2px solid ${hasCompletion ? themeColor : 'var(--border)'}`,
                    background: isFree
                      ? `${themeColor}33`
                      : hasCompletion
                        ? `${themeColor}18`
                        : 'var(--surface-raised)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px 6px',
                    position: 'relative',
                    cursor: 'default',
                  }}>
                    {/* Available count badge */}
                    {!isFree && (
                      <div style={{
                        position: 'absolute', top: 3, right: 5,
                        background: hasCompletion ? themeColor : 'var(--border)',
                        color: '#fff',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '1px 5px',
                        minWidth: 18,
                        textAlign: 'center',
                      }}>{available}</div>
                    )}
                    {isFree && (
                      <div style={{
                        position: 'absolute', top: 3, right: 5,
                        background: themeColor,
                        color: '#fff',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '1px 5px',
                      }}>FREE</div>
                    )}
                    {/* Label */}
                    <div style={{
                      fontSize: 10,
                      color: 'var(--text)',
                      textAlign: 'center',
                      lineHeight: 1.2,
                      maxHeight: 40,
                      overflow: 'hidden',
                      fontWeight: 600,
                    }}>{isFree ? 'FREE' : sq.label}</div>
                    {/* Point value */}
                    {!isFree && (
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{sq.point_value}pts</div>
                    )}
                    {/* Per-player color dots for team mode */}
                    {isTeam && playerCounts.length > 0 && (
                      <div style={{ display: 'flex', gap: 2, marginTop: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {playerCounts.map(({ player: p, count }) => (
                          <div key={p.id} title={`${p.name}: ${count}`} style={{
                            width: 8, height: 8, borderRadius: '50%', background: p.color,
                          }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {/* Diagonal labels */}
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--text-dim)' }}>
            {config.diag1_value > 0 && <span>↘ Diag: {config.diag1_value}pts</span>}
            {config.diag2_value > 0 && <span>↙ Diag: {config.diag2_value}pts</span>}
          </div>
        </div>

        {/* Bingo lines sidebar */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
            Completed Bingos
          </div>
          {subjectLines.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No bingos yet</div>
          )}
          {subjectLines.map((l, i) => (
            <div key={i} style={{
              background: `${themeColor}22`,
              border: `1px solid ${themeColor}44`,
              borderRadius: 6,
              padding: '6px 10px',
              marginBottom: 5,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>
                  {getLineName({ type: l.line_type, index: l.line_index })}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 6 }}>Day {l.day_number}</span>
                {l.is_individual && <span style={{ fontSize: 10, color: themeColor, marginLeft: 4 }}>(Individual)</span>}
              </div>
              <span style={{ fontWeight: 700, color: themeColor, fontSize: 14 }}>+{l.line_value}</span>
            </div>
          ))}

          {/* Score breakdown */}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
              Score Breakdown
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 2 }}>
              <div>Squares: <strong style={{ color: 'var(--text)' }}>{score?.square_score ?? 0}</strong></div>
              <div>Bingo Bonuses: <strong style={{ color: themeColor }}>{score?.bingo_score ?? 0}</strong></div>
              <div>Total: <strong style={{ color: 'var(--text)', fontSize: 16 }}>{score?.total_score ?? 0}</strong></div>
            </div>
          </div>

          {/* Individual player scores for team mode */}
          {isTeam && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                Individual Scores
              </div>
              {allPlayers.filter(p => p.team_id === team?.id).map(p => {
                const ps = scores.find(s => s.player_id === p.id);
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color }} />
                    <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{p.name}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>{ps?.total_score ?? 0}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────

export default function BingoPage() {
  const { eventId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [
        { data: event },
        { data: config },
        { data: squares },
        { data: players },
        { data: teams },
        { data: completionsRaw },
        { data: teamCompletionsRaw },
        { data: scoresRaw },
        { data: linesRaw },
        { data: commits },
      ] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('bingo_config').select('*').eq('event_id', eventId).single(),
        supabase.from('bingo_squares').select('*').eq('event_id', eventId).order('position'),
        supabase.from('bingo_players').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('bingo_teams').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('bingo_square_completions').select('*').eq('event_id', eventId),
        supabase.from('bingo_team_square_completions').select('*').eq('event_id', eventId),
        supabase.from('bingo_scores').select('*').eq('event_id', eventId),
        supabase.from('bingo_lines_completed').select('*').eq('event_id', eventId).order('created_at'),
        supabase.from('bingo_commits').select('*').eq('event_id', eventId).order('day_number', { ascending: false }).limit(1),
      ]);

      // Index completions
      const completions = {};
      for (const c of (completionsRaw ?? [])) {
        if (!completions[c.player_id]) completions[c.player_id] = {};
        completions[c.player_id][c.square_id] = c.available_count;
      }
      const teamCompletions = {};
      for (const c of (teamCompletionsRaw ?? [])) {
        if (!teamCompletions[c.team_id]) teamCompletions[c.team_id] = {};
        teamCompletions[c.team_id][c.square_id] = c.available_count;
      }

      const playerScores = (scoresRaw ?? []).filter(s => s.player_id);
      const teamScores = (scoresRaw ?? []).filter(s => s.team_id);

      setData({ event, config, squares: squares ?? [], players: players ?? [], teams: teams ?? [], completions, teamCompletions, playerScores, teamScores, lines: linesRaw ?? [], lastCommit: commits?.[0] });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // Realtime
  useEffect(() => {
    const channel = supabase.channel(`bingo-public-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_square_completions', filter: `event_id=eq.${eventId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_scores', filter: `event_id=eq.${eventId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_lines_completed', filter: `event_id=eq.${eventId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [eventId, load]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>Loading Bingo board...</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>Error: {error}</div>;
  if (!data?.config) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>Event not found.</div>;

  const { event, config, squares, players, teams, completions, teamCompletions, playerScores, teamScores, lines, lastCommit } = data;
  const isTeam = config.event_type === 'team';
  const themeColor = config.theme_color || '#c62828';

  // Standings for header table
  const standingSubjects = isTeam
    ? teams.map(t => {
        const s = teamScores.find(x => x.team_id === t.id);
        return { id: t.id, name: t.name, avatar: t.avatar_url, squareScore: s?.square_score ?? 0, bingoScore: s?.bingo_score ?? 0, total: s?.total_score ?? 0, bingos: s?.bingo_count ?? 0 };
      }).sort((a, b) => b.total - a.total)
    : players.map(p => {
        const s = playerScores.find(x => x.player_id === p.id);
        return { id: p.id, name: p.name, avatar: p.avatar_url, squareScore: s?.square_score ?? 0, bingoScore: s?.bingo_score ?? 0, total: s?.total_score ?? 0, bingos: s?.bingo_count ?? 0 };
      }).sort((a, b) => b.total - a.total);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '0 0 60px' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: `3px solid ${themeColor}`, padding: '24px 32px' }}>
        {config.title_image_url
          ? <img src={config.title_image_url} alt="Event" style={{ maxHeight: 64, marginBottom: 8 }} />
          : <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: 'var(--text)' }}>{config.game_title}</h1>
        }
        {config.game_subtitle && <div style={{ color: 'var(--text-dim)', marginTop: 4 }}>{config.game_subtitle}</div>}
        {lastCommit && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
            Last committed: Day {lastCommit.day_number}
          </div>
        )}
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* Standings table */}
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            {isTeam ? 'Team Standings' : 'Player Standings'}
          </h2>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: `${themeColor}22`, borderBottom: `2px solid ${themeColor}` }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600 }}>#</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600 }}>{isTeam ? 'Team' : 'Player'}</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Squares</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Bingo Bonus</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Total</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Bingos</th>
                </tr>
              </thead>
              <tbody>
                {standingSubjects.map((s, i) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border)', background: i === 0 ? `${themeColor}0a` : 'transparent' }}>
                    <td style={{ padding: '10px 14px', color: 'var(--text-dim)', fontWeight: i === 0 ? 700 : 400 }}>{i + 1}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {s.avatar && <img src={s.avatar} style={{ width: 24, height: 24, borderRadius: '50%' }} alt="" />}
                      {s.name}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text)' }}>{s.squareScore}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: themeColor, fontWeight: 600 }}>{s.bingoScore}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text)', fontWeight: 700, fontSize: 15 }}>{s.total}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      <span style={{ background: `${themeColor}22`, color: themeColor, fontWeight: 700, borderRadius: 4, padding: '2px 8px' }}>{s.bingos}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Individual standings for team events */}
          {isTeam && (
            <div style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                Individual Standings
              </h2>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: `${themeColor}22`, borderBottom: `2px solid ${themeColor}` }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600 }}>#</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600 }}>Player</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600 }}>Team</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Score</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Indiv. Bingos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players
                      .map(p => {
                        const ps = playerScores.find(s => s.player_id === p.id);
                        const t = teams.find(t => t.id === p.team_id);
                        return { ...p, total: ps?.total_score ?? 0, bingos: ps?.bingo_count ?? 0, teamName: t?.name ?? '—' };
                      })
                      .sort((a, b) => b.total - a.total)
                      .map((p, i) => (
                        <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 14px', color: 'var(--text-dim)' }}>{i + 1}</td>
                          <td style={{ padding: '10px 14px', color: 'var(--text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color }} />
                            {p.avatar_url && <img src={p.avatar_url} style={{ width: 22, height: 22, borderRadius: '50%' }} alt="" />}
                            {p.name}
                          </td>
                          <td style={{ padding: '10px 14px', color: 'var(--text-dim)' }}>{p.teamName}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>{p.total}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                            <span style={{ background: `${themeColor}22`, color: themeColor, fontWeight: 700, borderRadius: 4, padding: '2px 8px' }}>{p.bingos}</span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Bingo Cards */}
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 20 }}>
          Bingo Cards
        </h2>
        {isTeam
          ? teams.map(team => (
              <BingoCard
                key={team.id}
                config={config}
                squares={squares}
                team={team}
                completions={completions}
                teamCompletions={teamCompletions}
                linesCompleted={lines}
                allPlayers={players}
                scores={playerScores}
                teamScores={teamScores}
              />
            ))
          : players.map(player => (
              <BingoCard
                key={player.id}
                config={config}
                squares={squares}
                player={player}
                completions={completions}
                teamCompletions={{}}
                linesCompleted={lines}
                allPlayers={players}
                scores={playerScores}
                teamScores={[]}
              />
            ))
        }
      </div>
    </div>
  );
}
