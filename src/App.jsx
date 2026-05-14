// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

// Public pages
import HomePage from './pages/public/HomePage';
import StandingsPage from './pages/public/StandingsPage';
import SchedulePage from './pages/public/SchedulePage';
import BracketPage from './pages/public/BracketPage';
import BoardGamePage from './pages/public/BoardGamePage';
import HighScorePage from './pages/public/HighScorePage';

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

const BASE = '/all-play';

export default function App() {
  return (
    <BrowserRouter basename={BASE}>
      <AuthProvider>
        <Navbar />
        <Routes>
          {/* ── Public ── */}
          <Route path="/" element={<HomePage />} />

          {/* All-Play public */}
          <Route path="/events/:slug/standings" element={<StandingsPage />} />
          <Route path="/events/:slug/schedule" element={<SchedulePage />} />
          <Route path="/events/:slug/bracket" element={<BracketPage />} />

          {/* Board Game public */}
          <Route path="/board/:eventId" element={<BoardGamePage />} />

          {/* High Score public */}
          <Route path="/highscore/:id" element={<HighScorePage />} />

          {/* ── Auth ── */}
          <Route path="/login" element={<LoginPage />} />

          {/* ── Admin (protected) ── */}
          <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/events/create" element={<ProtectedRoute><CreateEventPage /></ProtectedRoute>} />
          <Route path="/admin/change-password" element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>} />

          {/* All-Play admin */}
          <Route path="/admin/events/:id" element={<ProtectedRoute><EventDetailPage /></ProtectedRoute>} />
          <Route path="/admin/events/:id/scores" element={<ProtectedRoute><ScoreEntryPage /></ProtectedRoute>} />
          <Route path="/admin/events/:id/scorers" element={<ProtectedRoute><ManageScorersPage /></ProtectedRoute>} />
          <Route path="/admin/events/:id/export" element={<ProtectedRoute><ExportPage /></ProtectedRoute>} />

          {/* Board Game admin */}
          <Route path="/admin/board/:eventId" element={<ProtectedRoute><BoardGameEventDetailPage /></ProtectedRoute>} />
          <Route path="/admin/board/:eventId/scores" element={<ProtectedRoute><BoardGameScoreEntryPage /></ProtectedRoute>} />
          <Route path="/admin/board/:eventId/edit" element={<ProtectedRoute><BoardGameEditPage /></ProtectedRoute>} />

          {/* High Score admin */}
          <Route path="/admin/highscore/:id" element={<ProtectedRoute><HighScoreEventDetailPage /></ProtectedRoute>} />
          <Route path="/admin/highscore/:id/scores" element={<ProtectedRoute><HighScoreScoreEntryPage /></ProtectedRoute>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
