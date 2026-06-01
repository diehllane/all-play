// src/lib/audit.js
// Fire-and-forget audit logger. Import logAudit() anywhere an action needs recording.
// Never throws — a failed write never blocks the primary action.

import { supabase } from './supabase'

/**
 * @param {Object} p
 * @param {Object}  p.actor       - profile object from useAuth() { id, email, role }
 * @param {string}  p.eventType   - 'score_entry' | 'commit' | 'undo' | 'config_change' | 'account_create' | 'role_change'
 * @param {string}  p.action      - Human-readable description
 * @param {string}  [p.eventId]   - UUID of the game event
 * @param {string}  [p.eventName] - Display name of game event
 * @param {string}  [p.targetId]  - UUID of player/team being affected
 * @param {string}  [p.targetName]
 * @param {Object}  [p.metadata]  - Any extra JSON data
 */
export async function logAudit({
  actor,
  eventType,
  action,
  eventId    = null,
  eventName  = null,
  targetId   = null,
  targetName = null,
  metadata   = null,
}) {
  try {
    await supabase.from('audit_log').insert({
      actor_id:   actor?.id   ?? null,
      actor_email: actor?.email ?? null,
      actor_role: actor?.role ?? null,
      event_type: eventType,
      event_id:   eventId,
      event_name: eventName,
      target_id:  targetId,
      target_name: targetName,
      action,
      metadata,
    })
  } catch {
    // intentionally silent
  }
}
