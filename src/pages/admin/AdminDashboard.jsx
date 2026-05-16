// src/pages/admin/AdminDashboard.jsx

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const ACC = '#c62828';

export default function AdminDashboard() {
  const { profile } = useAuth();
  const isRunner = profile?.role === 'event_runner';

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('events')
        .select('id, name, slug, event_type, status, start_date, end_date, created_at')
        .order('created_at', { ascending: false });
      setEvents(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const boardGames = events.filter(e => e.event_type === 'board_game');
  const allPlay = events.filter(e => e.event_type === 'all_play');
  const highScore = events.filter(e => e.event_type === 'high_score');
  const bingo = events.filter(e => ['bingo_solo', 'bingo_team'].includes(e.event_type));

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Admin Dashboard</h1>
        <div style={s.headerRight}>
          <span style={s.roleTag}>{profile?.role}</span>
          {isRunner && (
            <Link to="/admin/events/create" style={s.createBtn}>+ Create Event</Link>
          )}
        </div>
      </div>

      {loading ? (
        <div style={s.loading}>Loading events...</div>
      ) : (
        <>
          <EventSection title="🏆 High Score Events" events={highScore} type="high_score" />
          <EventSection title="🎲 Board Game Events" events={boardGames} type="board_game" />
          <EventSection title="⚔️ All-Play Tournaments" events={allPlay} type="all_play" />
          <EventSection title="🎯 Bingo Events" events={bingo} type="bingo" />
        </>
      )}
    </div>
  );
}

function EventSection({ title, events, type }) {
  if (events.length === 0) return null;
  return (
    <div style={s.section}>
      <h2 style={s.sectionTitle}>{title}</h2>
      <div style={s.grid}>
        {events.map(e => <EventCard key={e.id} event={e} type={type} />)}
      </div>
    </div>
  );
}

function EventCard({ event, type }) {
  const statusColor = {
    active: '#4caf50',
    playoffs: '#ff9800',
    completed: '#888',
  }[event.status] || '#888';

  const isBingo = type === 'bingo';

  const adminPath =
    isBingo ? `/admin/bingo/${event.id}` :
    type === 'board_game' ? `/admin/board/${event.id}` :
    type === 'high_score' ? `/admin/highscore/${event.id}` :
    `/admin/events/${event.id}`;

  const publicPath =
    isBingo ? `/bingo/${event.id}` :
    type === 'board_game' ? `/board/${event.id}` :
    type === 'high_score' ? `/highscore/${event.id}` :
    `/events/${event.slug}/standings`;

  const scorePath =
    isBingo ? `/admin/bingo/${event.id}/scores` :
    type === 'board_game' ? `/admin/board/${event.id}/scores` :
    type === 'high_score' ? `/admin/highscore/${event.id}/scores` :
    `/admin/events/${event.id}/scores`;

  const typeBadgeLabel =
    event.event_type === 'bingo_solo' ? 'Solo Bingo' :
    event.event_type === 'bingo_team' ? 'Team Bingo' :
    null;

  return (
    <div style={s.card}>
      <div style={s.cardTop}>
        <div>
          <div style={s.cardName}>{event.name}</div>
          <div style={s.cardMeta}>
            <span style={{ ...s.statusDot, background: statusColor }} />
            <span style={s.statusText}>{event.status}</span>
            {typeBadgeLabel && (
              <span style={s.typeBadge}>{typeBadgeLabel}</span>
            )}
          </div>
        </div>
      </div>
      <div style={s.cardActions}>
        <Link to={adminPath} style={s.actionLink}>Manage</Link>
        <Link to={scorePath} style={s.actionLink}>Scores</Link>
        {isBingo && (
          <Link to={`/admin/bingo/${event.id}/edit`} style={s.actionLink}>Edit</Link>
        )}
        <Link to={publicPath} style={{ ...s.actionLink, ...s.publicLink }}>Public ↗</Link>
      </div>
    </div>
  );
}

const s = {
  page: { maxWidth: 960, margin: '0 auto', padding: '28px 16px', fontFamily: 'sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, flexWrap: 'wrap', gap: 12 },
  title: { color: '#fff', fontSize: 22, margin: 0 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  roleTag: { background: '#2a2a2a', color: '#888', borderRadius: 4, padding: '3px 10px', fontSize: 12 },
  createBtn: { background: ACC, color: '#fff', borderRadius: 6, padding: '8px 16px', textDecoration: 'none', fontSize: 13, fontWeight: 700 },
  loading: { color: '#888', textAlign: 'center', padding: 40 },
  section: { marginBottom: 32 },
  sectionTitle: { color: '#fff', fontSize: 15, marginBottom: 12 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '14px 16px' },
  cardTop: { marginBottom: 12 },
  cardName: { color: '#fff', fontWeight: 600, fontSize: 15, marginBottom: 4 },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  statusDot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block' },
  statusText: { color: '#888', fontSize: 12 },
  typeBadge: { background: '#2a1a00', color: '#f90', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600 },
  cardActions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  actionLink: { background: '#2a2a2a', color: '#ccc', borderRadius: 5, padding: '5px 12px', textDecoration: 'none', fontSize: 12 },
  publicLink: { background: 'none', color: '#888', border: '1px solid #333' },
};
