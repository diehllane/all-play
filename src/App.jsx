import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'

// Public pages
import HomePage from './pages/public/HomePage'
import StandingsPage from './pages/public/StandingsPage'
import SchedulePage from './pages/public/SchedulePage'
import BracketPage from './pages/public/BracketPage'

// Admin pages
import LoginPage from './pages/admin/LoginPage'
import AdminDashboard from './pages/admin/AdminDashboard'
import CreateEventPage from './pages/admin/CreateEventPage'
import EventDetailPage from './pages/admin/EventDetailPage'
import ScoreEntryPage from './pages/admin/ScoreEntryPage'
import ManageScorersPage from './pages/admin/ManageScorersPage'

import './styles/global.css'

function ProtectedRoute({ children, requiredRole }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!user) return <Navigate to="/admin/login" replace />
  if (requiredRole && profile?.role !== requiredRole && profile?.role !== 'super_admin') {
    return <Navigate to="/admin" replace />
  }
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/event/:slug/standings" element={<StandingsPage />} />
      <Route path="/event/:slug/schedule" element={<SchedulePage />} />
      <Route path="/event/:slug/bracket" element={<BracketPage />} />
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/event/new" element={<ProtectedRoute requiredRole="event_runner"><CreateEventPage /></ProtectedRoute>} />
      <Route path="/admin/event/:id" element={<ProtectedRoute><EventDetailPage /></ProtectedRoute>} />
      <Route path="/admin/event/:id/score" element={<ProtectedRoute><ScoreEntryPage /></ProtectedRoute>} />
      <Route path="/admin/event/:id/scorers" element={<ProtectedRoute requiredRole="event_runner"><ManageScorersPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
