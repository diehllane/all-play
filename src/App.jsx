// src/App.jsx
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';

// Public pages
import HomePage from './pages/public/HomePage';
import StandingsPage from './pages/public/StandingsPage';
import SchedulePage from './pages/public/SchedulePage';
import BracketPage from './pages/public/BracketPage';
import BoardGamePage from './pages/public/BoardGamePage';
import HighScorePage from './pages/public/HighScorePage';
import BingoPage from './pages/public/BingoPage';
import SlotsPage from './pages/public/SlotsPage';

// Admin pages
import LoginPage from './pages/admin/LoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import CreateEventPage from './pages/admin/CreateEventPage';
import EventDetailPage from './pages/admin/EventDetailPage';
import AllPlayEditPage from './pages/admin/AllPlayEditPage';
import ScoreEntryPage from './pages/admin/ScoreEntryPage';
import ChangePasswordPage from './pages/admin/ChangePasswordPage';
import ExportPage from './pages/admin/ExportPage';
import BoardGameEventDetailPage from './pages/admin/BoardGameEventDetailPage';
import BoardGameScoreEntryPage from './pages/admin/BoardGameScoreEntryPage';
import BoardGameEditPage from './pages/admin/BoardGameEditPage';
import HighScoreEventDetailPage from './pages/admin/HighScoreEventDetailPage';
import HighScoreScoreEntryPage from './pages/admin/HighScoreScoreEntryPage';
import HighScoreEditPage from './pages/admin/HighScoreEditPage';
import BingoEventDetailPage from './pages/admin/BingoEventDetailPage';
import BingoScoreEntryPage from './pages/admin/BingoScoreEntryPage';
import BingoEditPage from './pages/admin/BingoEditPage';
import SlotsEventDetailPage from './pages/admin/SlotsEventDetailPage';
import SlotsScoreEntryPage from './pages/admin/SlotsScoreEntryPage';
import SlotsEditPage from './pages/admin/SlotsEditPage';
import OwnerPage from './pages/admin/OwnerPage';
import StaffPanel from './pages/admin/StaffPanel';
import AuditLogPage from './pages/admin/AuditLogPage';
import EventStaffPage from './pages/admin/EventStaffPage';
import PlayerPage from './pages/player/PlayerPage';

const BASE = '/all-play';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Admin area: owner, staff accounts, or anyone assigned to at least one event
function RequireStaff({ children }) {
  const { user, profile, loading, isAnyStaff } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (profile && !isAnyStaff) {
    return <Navigate to={profile.role === 'player' ? '/player' : '/'} replace />;
  }
  return children;
}

// Account-level: owner or Event Runner account (create events, Staff Panel)
function RequireRunner({ children }) {
  const { user, profile, loading, canCreateEvents } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (profile && !canCreateEvents) {
    return <Navigate to="/admin" replace />;
  }
  return children;
}

// Per-event: checks the role on the event in the URL (:eventId or :id).
// If the role isn't known yet (e.g. an event created moments ago), re-reads
// assignments once before sending the user back to the dashboard.
function RequireEventRole({ need, children }) {
  const { user, loading, eventRole, refreshAssignments } = useAuth();
  const params = useParams();
  const eventId = params.eventId ?? params.id;
  const role = eventRole(eventId);
  const [checkedFor, setCheckedFor] = useState(null);
  const allowed = need === 'manage'
    ? role === 'owner' || role === 'event_runner'
    : role === 'owner' || role === 'event_runner' || role === 'scorer';

  useEffect(() => {
    if (loading || !user || allowed || checkedFor === eventId) return;
    let cancelled = false;
    refreshAssignments().finally(() => { if (!cancelled) setCheckedFor(eventId); });
    return () => { cancelled = true; };
  }, [loading, user, allowed, checkedFor, eventId, refreshAssignments]);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (allowed) return children;
  if (checkedFor !== eventId) return null; // re-checking
  return <Navigate to="/admin" replace state={{ denied: eventId }} />;
}
const RequireEventManager = ({ children }) => <RequireEventRole need="manage">{children}</RequireEventRole>;
const RequireEventStaff   = ({ children }) => <RequireEventRole need="score">{children}</RequireEventRole>;

function RequireOwner({ children }) {
  const { user, profile, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (profile && profile.role !== 'owner') return <Navigate to="/admin" replace />;
  return children;
}

function RequirePlayer({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter basename={BASE}>
      <AuthProvider>
        <Navbar />
        <Routes>
          {/* Public */}
          <Route path="/" element={<HomePage />} />
          <Route path="/events/:slug/standings" element={<StandingsPage />} />
          <Route path="/events/:slug/schedule" element={<SchedulePage />} />
          <Route path="/events/:slug/bracket" element={<BracketPage />} />
          <Route path="/board/:eventId" element={<BoardGamePage />} />
          <Route path="/highscore/:id" element={<HighScorePage />} />
          <Route path="/bingo/:eventId" element={<BingoPage />} />
          <Route path="/slots/:eventId" element={<SlotsPage />} />

          {/* Auth */}
          <Route path="/login" element={<LoginPage />} />

          {/* Player dashboard */}
          <Route path="/player" element={<RequirePlayer><PlayerPage /></RequirePlayer>} />

          {/* Owner only */}
          <Route path="/admin/owner" element={<RequireOwner><OwnerPage /></RequireOwner>} />
          <Route path="/admin/audit" element={<RequireOwner><AuditLogPage /></RequireOwner>} />

          {/* Staff Panel — event_runner and owner */}
          <Route path="/admin/panel" element={<RequireRunner><StaffPanel /></RequireRunner>} />

          {/* Admin dashboard — all staff */}
          <Route path="/admin" element={<RequireStaff><AdminDashboard /></RequireStaff>} />
          <Route path="/admin/events/create" element={<RequireRunner><CreateEventPage /></RequireRunner>} />
          <Route path="/admin/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
          <Route path="/admin/events/:id/staff" element={<RequireEventManager><EventStaffPage /></RequireEventManager>} />

          {/* All-Play — score entry: RequireStaff; management: RequireRunner */}
          <Route path="/admin/events/:id" element={<RequireEventManager><EventDetailPage /></RequireEventManager>} />
          <Route path="/admin/events/:id/edit" element={<RequireEventManager><AllPlayEditPage /></RequireEventManager>} />
          <Route path="/admin/events/:id/scores" element={<RequireEventStaff><ScoreEntryPage /></RequireEventStaff>} />
          <Route path="/admin/events/:id/export" element={<RequireEventManager><ExportPage /></RequireEventManager>} />

          {/* Board Game — score entry: RequireStaff; management: RequireRunner */}
          <Route path="/admin/board/:eventId" element={<RequireEventManager><BoardGameEventDetailPage /></RequireEventManager>} />
          <Route path="/admin/board/:eventId/scores" element={<RequireEventStaff><BoardGameScoreEntryPage /></RequireEventStaff>} />
          <Route path="/admin/board/:eventId/edit" element={<RequireEventManager><BoardGameEditPage /></RequireEventManager>} />

          {/* High Score */}
          <Route path="/admin/highscore/:id" element={<RequireEventManager><HighScoreEventDetailPage /></RequireEventManager>} />
          <Route path="/admin/highscore/:id/scores" element={<RequireEventStaff><HighScoreScoreEntryPage /></RequireEventStaff>} />
          <Route path="/admin/highscore/:id/edit" element={<RequireEventManager><HighScoreEditPage /></RequireEventManager>} />

          {/* Bingo */}
          <Route path="/admin/bingo/:eventId" element={<RequireEventManager><BingoEventDetailPage /></RequireEventManager>} />
          <Route path="/admin/bingo/:eventId/scores" element={<RequireEventStaff><BingoScoreEntryPage /></RequireEventStaff>} />
          <Route path="/admin/bingo/:eventId/edit" element={<RequireEventManager><BingoEditPage /></RequireEventManager>} />

          {/* Slots */}
          <Route path="/admin/slots/:eventId" element={<RequireEventManager><SlotsEventDetailPage /></RequireEventManager>} />
          <Route path="/admin/slots/:eventId/scores" element={<RequireEventStaff><SlotsScoreEntryPage /></RequireEventStaff>} />
          <Route path="/admin/slots/:eventId/edit" element={<RequireEventManager><SlotsEditPage /></RequireEventManager>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
