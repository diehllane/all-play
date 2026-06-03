// src/pages/public/HomePage.jsx

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

export default function HomePage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('events')
        .select('id, name, slug, event_type, status, start_date, end_date')
        .eq('status', 'active')
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
  const slots = events.filter(e => e.event_type === 'slots');

  return (
    <div style={s.page}>
      <div style={s.hero}>
        <h1 style={s.heroTitle}>PokeNexus Events</h1>
        <p style={s.heroSub}>Live scores, standings, and leaderboards</p>
      </div>

      {loading ? (
        <div style={s.loading}>Loading events...</div>
      ) : events.length === 0 ? (
        <div style={s.empty}>No active events right now. Check back soon!</div>
      ) : (
        <>
          {highScore.length > 0 && (
            <Section title="🏆 High Score Events">
              {highScore.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  viewPath={`/highscore/${e.id}`}
                  typeBadge="High Score"
                />
              ))}
            </Section>
          )}

          {boardGames.length > 0 && (
            <Section title="🎲 Board Game Events">
              {boardGames.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  viewPath={`/board/${e.id}`}
                  typeBadge="Board Game"
                />
              ))}
            </Section>
          )}

          {allPlay.length > 0 && (
            <Section title="⚔️ All-Play Tournaments">
              {allPlay.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  viewPath={`/events/${e.slug}/standings`}
                  typeBadge="All-Play"
                />
              ))}
            </Section>
          )}

          {bingo.length > 0 && (
            <Section title="🎯 Bingo Events">
              {bingo.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  viewPath={`/bingo/${e.id}`}
                  typeBadge={e.event_type === 'bingo_team' ? 'Team Bingo' : 'Solo Bingo'}
                />
              ))}
            </Section>
          )}

          {slots.length > 0 && (
            <Section title="🎰 Slots Events">
              {slots.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  viewPath={`/slots/${e.id}`}
                  typeBadge="Slots"
                  badgeColor="#00e5ff"
                  badgeBg="#001a1a"
                />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={s.section}>
      <h2 style={s.sectionTitle}>{title}</h2>
      <div style={s.grid}>{children}</div>
    </div>
  );
}

function EventCard({ event, viewPath, typeBadge, badgeColor, badgeBg }) {
  const formatDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  const start = formatDate(event.start_date);
  const end = formatDate(event.end_date);

  const badgeStyle = {
    ...s.typeBadge,
    ...(badgeColor ? { color: badgeColor } : {}),
    ...(badgeBg ? { background: badgeBg } : {}),
  };

  return (
    <div style={s.card}>
      <div style={s.cardBody}>
        <div style={badgeStyle}>{typeBadge}</div>
        <div style={s.eventName}>{event.name}</div>
        {(start || end) && (
          <div style={s.dates}>{start && end ? `${start} – ${end}` : start || end}</div>
        )}
      </div>
      <div style={s.cardFooter}>
        <Link to={viewPath} style={s.viewBtn}>View Event</Link>
      </div>
    </div>
  );
}

const s = {
  page: { maxWidth: 900, margin: '0 auto', padding: '0 16px 60px', fontFamily: 'sans-serif' },
  hero: { padding: '40px 0 28px', textAlign: 'center' },
  heroTitle: { color: '#fff', fontSize: 30, fontWeight: 900, margin: '0 0 6px' },
  heroSub: { color: '#888', fontSize: 15, margin: 0 },
  loading: { color: '#888', textAlign: 'center', padding: 60 },
  empty: { color: '#666', textAlign: 'center', padding: 80, fontSize: 15 },
  section: { marginBottom: 32 },
  sectionTitle: { color: '#ccc', fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, display: 'flex', flexDirection: 'column' },
  cardBody: { padding: '16px 16px 12px', flex: 1 },
  typeBadge: { display: 'inline-block', background: '#c62828', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, marginBottom: 8, fontWeight: 700 },
  eventName: { color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 4 },
  dates: { color: '#888', fontSize: 12 },
  cardFooter: { padding: '10px 16px 14px', borderTop: '1px solid #222' },
  viewBtn: { display: 'block', background: '#c62828', color: '#fff', borderRadius: 6, padding: '7px 14px', textDecoration: 'none', textAlign: 'center', fontSize: 13, fontWeight: 700 },
};
