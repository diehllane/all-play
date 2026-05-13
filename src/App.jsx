// src/App.jsx
// Replaces the existing App.jsx.
// Adds board game routes alongside all existing all-play routes.

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Public pages
import HomePage        from './pages/public/HomePage';
import StandingsPage   from './pages/public/StandingsPage';
import SchedulePage    from './pages/public/SchedulePage';
import BracketPage     from './pages/public/BracketPage';
import BoardGamePage   from './pages/public/BoardGamePage';

// Admin pages
import LoginPage                  from './pages/admin/LoginPage';
import AdminDashboard             from './pages/admin/AdminDashboard';
import CreateEventPage            from './pages/admin/CreateEventPage';
import EventDetailPage            from './pages/admin/EventDetailPage';
import ScoreEntryPage             from './pages/admin/ScoreEntryPage';
import ManageScorersPage          from './pages/admin/ManageScorersPage';
import ChangePasswordPage         from './pages/admin/ChangePasswordPage';
import ExportPage                 from './pages/admin/ExportPage';
import BoardGameEventDetailPage   from './pages/admin/BoardGameEventDetailPage';
import BoardGameScoreEntryPage    from './pages/admin/BoardGameScoreEntryPage';

function ProtectedRoute({ children, requiredRole }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (requiredRole && profile?.role !== requiredRole) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  return (
    <>
      <Routes>
        {/* ── Public ────────────────────────────────────────── */}
        <Route path="/"                               element={<HomePage />} />
        <Route path="/events/:eventId/standings"      element={<StandingsPage />} />
        <Route path="/events/:eventId/schedule"       element={<SchedulePage />} />
        <Route path="/events/:eventId/bracket"        element={<BracketPage />} />

        {/* Board game public board */}
        <Route path="/board/:eventId"                 element={<BoardGamePage />} />

        {/* ── Auth ──────────────────────────────────────────── */}
        <Route path="/login"                          element={<LoginPage />} />

        {/* ── Admin: shared ─────────────────────────────────── */}
        <Route path="/admin" element={
          <ProtectedRoute><AdminDashboard /></ProtectedRoute>
        } />
        <Route path="/admin/events/create" element={
          <ProtectedRoute requiredRole="event_runner"><CreateEventPage /></ProtectedRoute>
        } />
        <Route path="/change-password" element={
          <ProtectedRoute><ChangePasswordPage /></ProtectedRoute>
        } />

        {/* ── Admin: All-Play event management ──────────────── */}
        <Route path="/admin/events/:eventId" element={
          <ProtectedRoute requiredRole="event_runner"><EventDetailPage /></ProtectedRoute>
        } />
        <Route path="/admin/events/:eventId/scores" element={
          <ProtectedRoute><ScoreEntryPage /></ProtectedRoute>
        } />
        <Route path="/admin/events/:eventId/scorers" element={
          <ProtectedRoute requiredRole="event_runner"><ManageScorersPage /></ProtectedRoute>
        } />
        <Route path="/admin/events/:eventId/export" element={
          <ProtectedRoute requiredRole="event_runner"><ExportPage /></ProtectedRoute>
        } />

        {/* ── Admin: Board Game event management ────────────── */}
        <Route path="/admin/board/:eventId" element={
          <ProtectedRoute requiredRole="event_runner"><BoardGameEventDetailPage /></ProtectedRoute>
        } />
        <Route path="/admin/board/:eventId/scores" element={
          <ProtectedRoute><BoardGameScoreEntryPage /></ProtectedRoute>
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/all-play">
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
