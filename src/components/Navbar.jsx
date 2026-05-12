import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Navbar({ eventSlug, eventName }) {
  const { user, profile, signOut } = useAuth()
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-brand">
          <span className="brand-dot" />
          PokeNexus
        </Link>

        <ul className="navbar-links">
          {eventSlug && (
            <>
              <li><Link to={`/event/${eventSlug}/standings`}
                className={location.pathname.includes('/standings') ? 'active' : ''}>
                Standings
              </Link></li>
              <li><Link to={`/event/${eventSlug}/schedule`}
                className={location.pathname.includes('/schedule') ? 'active' : ''}>
                Schedule
              </Link></li>
              <li><Link to={`/event/${eventSlug}/bracket`}
                className={location.pathname.includes('/bracket') ? 'active' : ''}>
                Bracket
              </Link></li>
            </>
          )}

          {user ? (
            <>
              <li><Link to="/admin" className={isAdmin ? 'active' : ''}>Dashboard</Link></li>
              <li><Link to="/admin/change-password" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Change Password</Link></li>
              <li>
                <button
                  onClick={signOut}
                  className="btn btn-secondary btn-sm"
                  style={{ cursor: 'pointer' }}
                >
                  Sign Out
                </button>
              </li>
            </>
          ) : (
            <li>
              <Link to="/admin/login" className="btn btn-secondary btn-sm">
                Sign In
              </Link>
            </li>
          )}
        </ul>
      </div>
    </nav>
  )
}
