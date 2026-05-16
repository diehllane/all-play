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

// Admin pages
import LoginPage from './pages/admin/LoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import CreateEventPage from './pages/admin/CreateEventPage';
import EventDetailPage from './pages/admin/EventDetailPage';
import ScoreEntryPage from './pages/admin/ScoreEntryPage';
import ManageScorersPage from './pages/admin/ManageScorersPage';
import ChangePasswordPage from './pages/admin/ChangePasswordPage';
import ExportPage from './pages/admin/ExportPage';
import BoardGameEventDetailPage from './pages/admin/BoardGameEventDetailPage';
import BoardGameScoreEntryPage from './pages/admin/BoardGameScoreEntryPage';
import BoardGameEditPage from './pages/admin/BoardGameEditPage';
import HighScoreEventDetailPage from './pages/admin/HighScoreEventDetailPage';
import HighScoreScoreEntryPage from './pages/admin/HighScoreScoreEntryPage';
import BingoEventDetailPage from './pages/admin/BingoEventDetailPage';
import BingoScoreEntryPage from './pages/admin/BingoScoreEntryPage';
import BingoEditPage from './pages/admin/BingoEditPage';

const BASE = '/all-play';

// Simple auth guard — redirects to /login if not authenticated
function RequireAuth({ children }) {
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

          {/* Auth */}
          <Route path="/login" element={<LoginPage />} />

          {/* Admin */}
          <Route path="/admin" element={<RequireAuth><AdminDashboard /></RequireAuth>} />
          <Route path="/admin/events/create" element={<RequireAuth><CreateEventPage /></RequireAuth>} />
          <Route path="/admin/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />

          {/* All-Play admin */}
          <Route path="/admin/events/:id" element={<RequireAuth><EventDetailPage /></RequireAuth>} />
          <Route path="/admin/events/:id/scores" element={<RequireAuth><ScoreEntryPage /></RequireAuth>} />
          <Route path="/admin/events/:id/scorers" element={<RequireAuth><ManageScorersPage /></RequireAuth>} />
          <Route path="/admin/events/:id/export" element={<RequireAuth><ExportPage /></RequireAuth>} />

          {/* Board Game admin */}
          <Route path="/admin/board/:eventId" element={<RequireAuth><BoardGameEventDetailPage /></RequireAuth>} />
          <Route path="/admin/board/:eventId/scores" element={<RequireAuth><BoardGameScoreEntryPage /></RequireAuth>} />
          <Route path="/admin/board/:eventId/edit" element={<RequireAuth><BoardGameEditPage /></RequireAuth>} />

          {/* High Score admin */}
          <Route path="/admin/highscore/:id" element={<RequireAuth><HighScoreEventDetailPage /></RequireAuth>} />
          <Route path="/admin/highscore/:id/scores" element={<RequireAuth><HighScoreScoreEntryPage /></RequireAuth>} />

          {/* Bingo admin */}
          <Route path="/admin/bingo/:eventId" element={<RequireAuth><BingoEventDetailPage /></RequireAuth>} />
          <Route path="/admin/bingo/:eventId/scores" element={<RequireAuth><BingoScoreEntryPage /></RequireAuth>} />
          <Route path="/admin/bingo/:eventId/edit" element={<RequireAuth><BingoEditPage /></RequireAuth>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
