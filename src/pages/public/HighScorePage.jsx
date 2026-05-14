// src/pages/public/HighScorePage.jsx
// Public-facing standings page. No auth required.

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  getHSConfig, getHSTeams, getHSPlayers, getHSDailyTotals,
  buildHSStandings,
} from '../../lib/highscore';

export default function HighScorePage() {
  const { id: eventId } = useParams();

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState(null);
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [dailyTotals, setDailyTotals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('standings');
  const realtimeRef = useRef(null);

  useEffect(() => {
    loadAll();
    return () => { realtimeRef.current?.unsubscribe(); };
  }, [eventId]);

  async function loadAll() {
    setLoading(true);
    try {
      const { data: ev } = await supabase.from('events').select('*').eq('id', eventId).single();
      setEvent(ev);

      const [cfg, tm, pl, dt] = await Promise.all([
        getHSConfig(eventId).catch(() => ({})),
        getHSTeams(eventId),
        getHSPlayers(eventId),
        getHSDailyTotals(eventId),
      ]);
      setConfig(cfg);
      setTeams(tm);
      setPlayers(pl);
      setDailyTotals(dt);

      // Realtime
      realtimeRef.current = supabase
        .channel(`hs-public-${eventId}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'hs_daily_totals',
          filter: `event_id=eq.${eventId}`,
        }, loadAll)
        .subscribe();
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div style={s.loading}>Loading...</div>;

  const mode = config?.mode || 'solo';
  const themeColor = config?.theme_color || '#c62828';
  const { individualStandings, teamStandings } = buildHSStandings(dailyTotals, players, teams, mode);

  // Build per-player per-day matrix for the daily scores tab
  const allDays = [...new Set(dailyTotals.map(r => r.day_number))].sort((a, b) => a - b);
  const byPlayerDay = {};
  for (const row of dailyTotals) {
    if (!byPlayerDay[row.player_id]) byPlayerDay[row.player_id] = {};
    byPlayerDay[row.player_id][row.day_number] = row.final_score;
  }

  const tabs = mode === 'team'
    ? ['standings', 'team standings', 'daily scores']
    : ['standings', 'daily scores'];

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ ...s.hero, background: themeColor }}>
        {config?.title_image_url ? (
          <img src={config.title_image_url} alt="" style={s.heroImg} />
        ) : (
          <h1 style={s.heroTitle}>{event?.name || 'High Score Event'}</h1>
        )}
        {config?.subtitle && <p style={s.heroSub}>{config.subtitle}</p>}
        <div style={s.heroBadges}>
          {allDays.length > 0 && (
            <span style={s.heroBadge}>Day {Math.max(...allDays)} Complete</span>
          )}
          <span style={s.heroBadge}>{players.length} Players</span>
          {mode === 'team' && <span style={s.heroBadge}>{teams.length} Teams</span>}
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={activeTab === t ? { ...s.tab, ...s.tabActive, borderBottomColor: themeColor } : s.tab}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div style={s.content}>

        {/* Individual Standings */}
        {activeTab === 'standings' && (
          <div>
            <h2 style={s.heading}>
              {mode === 'team' ? '👤 Individual Standings (MVP Track)' : '🏆 Standings'}
            </h2>
            <div style={s.standingsList}>
              {individualStandings.map(p => (
                <div key={p.playerId} style={s.standingRow}>
                  <div style={s.rankBadge}>{p.rank}</div>
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} style={s.avatar} alt="" />
                  ) : (
                    <div style={{ ...s.avatarFallback, background: themeColor }}>
                      {p.name[0].toUpperCase()}
                    </div>
                  )}
                  <div style={s.standingInfo}>
                    <div style={s.playerName}>{p.name}</div>
                    {p.teamName && <div style={s.teamLabel}>{p.teamName}</div>}
                  </div>
                  <div style={s.scoreDisplay}>{p.totalScore.toLocaleString()}</div>
                </div>
              ))}
              {individualStandings.length === 0 && (
                <div style={s.empty}>No scores committed yet.</div>
              )}
            </div>
          </div>
        )}

        {/* Team Standings */}
        {activeTab === 'team standings' && mode === 'team' && (
          <div>
            <h2 style={s.heading}>🏆 Team Standings</h2>
            {teamStandings.map(t => (
              <div key={t.teamId} style={s.teamCard}>
                <div style={s.teamCardHeader}>
                  <div style={s.teamCardLeft}>
                    <div style={s.rankBadge}>{t.rank}</div>
                    {t.avatarUrl ? (
                      <img src={t.avatarUrl} style={s.teamAvatar} alt="" />
                    ) : (
                      <div style={{ ...s.teamAvatarFallback, background: themeColor }}>
                        {t.name[0].toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div style={s.teamName}>{t.name}</div>
                      {config?.allow_handicap && t.handicapMultiplier !== 1 && (
                        <div style={s.handicapLabel}>×{t.handicapMultiplier} handicap</div>
                      )}
                    </div>
                  </div>
                  <div style={s.scoreDisplay}>{t.totalScore.toLocaleString()}</div>
                </div>
                {/* Member breakdown */}
                <div style={s.memberList}>
                  {t.members.map(m => (
                    <div key={m.playerId} style={s.memberRow}>
                      <span style={s.memberName}>{m.name}</span>
                      <span style={s.memberScore}>{m.totalScore.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {teamStandings.length === 0 && <div style={s.empty}>No scores yet.</div>}
          </div>
        )}

        {/* Daily Scores */}
        {activeTab === 'daily scores' && (
          <div>
            <h2 style={s.heading}>📅 Daily Scores</h2>
            {allDays.length === 0 ? (
              <div style={s.empty}>No days committed yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Player</th>
                      {mode === 'team' && <th style={s.th}>Team</th>}
                      {allDays.map(d => <th key={d} style={s.th}>Day {d}</th>)}
                      <th style={s.th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {individualStandings.map(p => (
                      <tr key={p.playerId}>
                        <td style={s.td}>
                          <div style={s.tdPlayer}>
                            {p.avatarUrl
                              ? <img src={p.avatarUrl} style={s.tdAvatar} alt="" />
                              : <div style={{ ...s.tdAvatarFallback, background: themeColor }}>{p.name[0]}</div>
                            }
                            {p.name}
                          </div>
                        </td>
                        {mode === 'team' && <td style={s.td}>{p.teamName || '—'}</td>}
                        {allDays.map(d => (
                          <td key={d} style={{ ...s.td, textAlign: 'right' }}>
                            {(byPlayerDay[p.playerId]?.[d] ?? 0).toLocaleString()}
                          </td>
                        ))}
                        <td style={{ ...s.td, textAlign: 'right', fontWeight: 700, color: themeColor }}>
                          {p.totalScore.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  page: { maxWidth: 900, margin: '0 auto', fontFamily: 'sans-serif', paddingBottom: 60 },
  loading: { padding: 60, textAlign: 'center', color: '#aaa' },
  hero: { padding: '32px 24px', textAlign: 'center', borderRadius: '0 0 12px 12px', marginBottom: 0 },
  heroImg: { maxHeight: 80, maxWidth: '100%', objectFit: 'contain', marginBottom: 8 },
  heroTitle: { margin: 0, fontSize: 28, color: '#fff', fontWeight: 900 },
  heroSub: { margin: '6px 0 0', color: 'rgba(255,255,255,0.8)', fontSize: 15 },
  heroBadges: { display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' },
  heroBadge: { background: 'rgba(0,0,0,0.25)', color: '#fff', borderRadius: 20, padding: '4px 12px', fontSize: 12 },
  tabs: { display: 'flex', borderBottom: '1px solid #333', padding: '0 24px' },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', color: '#888', padding: '12px 16px', cursor: 'pointer', fontSize: 14, transition: 'color .15s' },
  tabActive: { color: '#fff', fontWeight: 700 },
  content: { padding: '24px 24px 0' },
  heading: { color: '#fff', fontSize: 17, marginTop: 0, marginBottom: 16 },
  standingsList: { display: 'flex', flexDirection: 'column', gap: 8 },
  standingRow: { display: 'flex', alignItems: 'center', gap: 12, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '12px 16px' },
  rankBadge: { width: 28, height: 28, borderRadius: '50%', background: '#333', color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 },
  avatar: { width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 },
  avatarFallback: { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0 },
  standingInfo: { flex: 1 },
  playerName: { color: '#fff', fontWeight: 600 },
  teamLabel: { color: '#888', fontSize: 12, marginTop: 2 },
  scoreDisplay: { color: '#fff', fontSize: 20, fontWeight: 700 },
  teamCard: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, marginBottom: 12, overflow: 'hidden' },
  teamCardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: '#222' },
  teamCardLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  teamAvatar: { width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' },
  teamAvatarFallback: { width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18 },
  teamName: { color: '#fff', fontWeight: 700, fontSize: 16 },
  handicapLabel: { color: '#888', fontSize: 12, marginTop: 2 },
  memberList: { padding: '8px 16px 12px' },
  memberRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #222' },
  memberName: { color: '#ccc', fontSize: 13 },
  memberScore: { color: '#aaa', fontSize: 13 },
  empty: { color: '#555', textAlign: 'center', padding: 48 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', color: '#888', padding: '8px 12px', borderBottom: '1px solid #333', fontSize: 12, textTransform: 'uppercase', whiteSpace: 'nowrap' },
  td: { padding: '10px 12px', borderBottom: '1px solid #222', color: '#ddd' },
  tdPlayer: { display: 'flex', alignItems: 'center', gap: 8 },
  tdAvatar: { width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' },
  tdAvatarFallback: { width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 11 },
};
