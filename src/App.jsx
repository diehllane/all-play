// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import PlayerPage from './pages/player/PlayerPage';

const BASE = '/all-play';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Scorer, event_runner, owner — blocks players
function RequireStaff({ children }) {
  const { user, profile, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  const staffRoles = ['scorer', 'event_runner', 'owner'];
  if (profile && !staffRoles.includes(profile.role)) {
    return <Navigate to={profile.role === 'player' ? '/player' : '/'} replace />;
  }
  return children;
}

// Event_runner or owner — blocks scorers and players
function RequireRunner({ children }) {
  const { user, profile, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  const runnerRoles = ['event_runner', 'owner'];
  if (profile && !runnerRoles.includes(profile.role)) {
    return <Navigate to="/admin" replace />;
  }
  return children;
}

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

          {/* All-Play — score entry: RequireStaff; management: RequireRunner */}
          <Route path="/admin/events/:id" element={<RequireRunner><EventDetailPage /></RequireRunner>} />
          <Route path="/admin/events/:id/edit" element={<RequireRunner><AllPlayEditPage /></RequireRunner>} />
          <Route path="/admin/events/:id/scores" element={<RequireStaff><ScoreEntryPage /></RequireStaff>} />
          <Route path="/admin/events/:id/export" element={<RequireRunner><ExportPage /></RequireRunner>} />

          {/* Board Game — score entry: RequireStaff; management: RequireRunner */}
          <Route path="/admin/board/:eventId" element={<RequireRunner><BoardGameEventDetailPage /></RequireRunner>} />
          <Route path="/admin/board/:eventId/scores" element={<RequireStaff><BoardGameScoreEntryPage /></RequireStaff>} />
          <Route path="/admin/board/:eventId/edit" element={<RequireRunner><BoardGameEditPage /></RequireRunner>} />

          {/* High Score */}
          <Route path="/admin/highscore/:id" element={<RequireRunner><HighScoreEventDetailPage /></RequireRunner>} />
          <Route path="/admin/highscore/:id/scores" element={<RequireStaff><HighScoreScoreEntryPage /></RequireStaff>} />
          <Route path="/admin/highscore/:id/edit" element={<RequireRunner><HighScoreEditPage /></RequireRunner>} />

          {/* Bingo */}
          <Route path="/admin/bingo/:eventId" element={<RequireRunner><BingoEventDetailPage /></RequireRunner>} />
          <Route path="/admin/bingo/:eventId/scores" element={<RequireStaff><BingoScoreEntryPage /></RequireStaff>} />
          <Route path="/admin/bingo/:eventId/edit" element={<RequireRunner><BingoEditPage /></RequireRunner>} />

          {/* Slots */}
          <Route path="/admin/slots/:eventId" element={<RequireRunner><SlotsEventDetailPage /></RequireRunner>} />
          <Route path="/admin/slots/:eventId/scores" element={<RequireStaff><SlotsScoreEntryPage /></RequireStaff>} />
          <Route path="/admin/slots/:eventId/edit" element={<RequireRunner><SlotsEditPage /></RequireRunner>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
