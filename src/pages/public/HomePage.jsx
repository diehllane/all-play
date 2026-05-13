// src/pages/public/HomePage.jsx
// Replaces the existing HomePage.
// All events are listed with their type badge.
// Board Game events link to /board/:id
// All-Play events link to /events/:id/standings (existing route)

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

export default function HomePage() {
  const { profile } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setEvents(data || []);
        setLoading(false);
      });
  }, []);

  const boardGames = events.filter(e => e.event_type === 'board_game');
  const allPlays   = events.filter(e => e.event_type !== 'board_game');

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <h2 style={{ margin: 0 }}>PokeNexus Events</h2>
        {profile?.role === 'event_runner' && (
          <Link to="/admin/events/create"
            style={{ padding: '8px 18px', background: '#c62828', border: 'none', color: '#fff', borderRadius: 6, textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
            + Create Event
          </Link>
        )}
      </div>

      {loading && <div style={{ opacity: 0.5 }}>Loading events...</div>}

      {!loading && events.length === 0 && (
        <div style={{ opacity: 0.4, fontSize: 15 }}>No events yet.</div>
      )}

      {boardGames.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 14, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>🎲 Board Games</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {boardGames.map(ev => (
              <EventCard key={ev.id} event={ev} />
            ))}
          </div>
        </section>
      )}

      {allPlays.length > 0 && (
        <section>
          <h3 style={{ fontSize: 14, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>🏆 All-Play Tournaments</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {allPlays.map(ev => (
              <EventCard key={ev.id} event={ev} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EventCard({ event }) {
  const isBoardGame = event.event_type === 'board_game';
  const publicUrl   = isBoardGame ? `/board/${event.id}` : `/events/${event.id}/standings`;
  const adminUrl    = isBoardGame ? `/admin/board/${event.id}` : `/admin/events/${event.id}`;
  const { profile } = useAuth();
  const isRunner    = profile?.role === 'event_runner';

  const dateRange = [event.start_date, event.end_date]
    .filter(Boolean)
    .map(d => new Date(d).toLocaleDateString())
    .join(' – ');

  return (
    <div style={{ background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: 8, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{event.name}</span>
          <span style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 600,
            background: isBoardGame ? '#1a3a5c' : '#1a3a1a',
            color: isBoardGame ? '#90caf9' : '#81c784',
            textTransform: 'uppercase', letterSpacing: 0.5
          }}>
            {isBoardGame ? 'Board Game' : 'All-Play'}
          </span>
        </div>
        {dateRange && <div style={{ fontSize: 12, opacity: 0.55 }}>{dateRange}</div>}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Link to={publicUrl}
          style={{ padding: '6px 14px', background: '#2a2a3e', border: '1px solid #444', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 13 }}>
          {isBoardGame ? '🎮 View Board' : '📊 Standings'}
        </Link>
        {isRunner && (
          <Link to={adminUrl}
            style={{ padding: '6px 14px', background: '#c62828', border: 'none', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 13 }}>
            Manage
          </Link>
        )}
      </div>
    </div>
  );
}
