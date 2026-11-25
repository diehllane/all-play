import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

// Per-event roles (2026-11-24)
// ─────────────────────────────
// Access to an event comes from user_event_assignments (role 'event_runner' or
// 'scorer'), not from the account's global role. Owners have access everywhere.
// The account-level role still decides who may CREATE events (owner/event_runner)
// and who sees the Staff/Owner panels. The database enforces all of this in RLS;
// the helpers here only decide what the UI shows.

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [assignments, setAssignments] = useState({}) // event_id → 'event_runner' | 'scorer'
  const [loading, setLoading] = useState(true)

  const fetchAssignments = useCallback(async (userId) => {
    if (!userId) { setAssignments({}); return {} }
    const { data } = await supabase
      .from('user_event_assignments')
      .select('event_id, role')
      .eq('user_id', userId)
    const map = {}
    for (const a of data ?? []) map[a.event_id] = a.role
    setAssignments(map)
    return map
  }, [])

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else {
        setProfile(null)
        setAssignments({})
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchProfile(userId) {
    const [{ data }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      fetchAssignments(userId),
    ])
    // Immediately sign out suspended accounts
    if (data && data.is_active === false) {
      await supabase.auth.signOut()
      setUser(null)
      setProfile(null)
      setAssignments({})
      setLoading(false)
      return
    }
    setProfile(data)
    setLoading(false)
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error }
    // Check suspension after sign-in
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: prof } = await supabase.from('profiles').select('is_active').eq('id', user.id).single()
      if (prof?.is_active === false) {
        await supabase.auth.signOut()
        return { error: { message: 'This account has been suspended. Contact an admin.' } }
      }
    }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setAssignments({})
  }

  const refreshAssignments = useCallback(() => fetchAssignments(user?.id), [fetchAssignments, user?.id])

  const isOwner = profile?.role === 'owner'
  const isActive = !!profile && profile.is_active !== false && profile.role !== 'revoked'

  /** 'owner' | 'event_runner' | 'scorer' | null for one event. */
  const eventRole = useCallback((eventId) => {
    if (!isActive) return null
    if (isOwner) return 'owner'
    return assignments[eventId] ?? null
  }, [assignments, isOwner, isActive])

  const value = {
    user, profile, loading, signIn, signOut,
    assignments, refreshAssignments, eventRole,
    isOwner,
    // Account-level: may create new events
    canCreateEvents: isActive && (isOwner || profile?.role === 'event_runner'),
    // Staff somewhere: owner, staff account, or assigned to at least one event
    isAnyStaff: isActive && (isOwner || ['event_runner', 'scorer'].includes(profile?.role) || Object.keys(assignments).length > 0),
    // Runs at least one event (or owner)
    isAnyEventRunner: isActive && (isOwner || Object.values(assignments).includes('event_runner')),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

/**
 * Permissions for the event in the current route (:eventId or :id), or for an
 * explicit event id. canManage = owner or this event's runner; canScore adds scorers.
 */
export function useEventPermissions(explicitEventId) {
  const params = useParams()
  const { eventRole } = useAuth()
  const eventId = explicitEventId ?? params.eventId ?? params.id
  const role = eventId ? eventRole(eventId) : null
  return {
    eventId,
    role,
    canManage: role === 'owner' || role === 'event_runner',
    canScore: role === 'owner' || role === 'event_runner' || role === 'scorer',
  }
}
