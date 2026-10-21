// src/lib/webhooks.js
// Discord webhook storage and delivery.
//
// Webhook URLs live in public.event_webhooks, which only event_runner/owner can read.
// Nothing public-facing ever sees a URL. Delivery goes through the `send-discord`
// edge function, which looks the URL up server-side, so scorers can commit days
// (and trigger posts) without ever being able to read the URLs either.
//
// Target shape used everywhere: { scope: 'overall' } | { scope: 'team' | 'player', id: <uuid> }

import { supabase } from './supabase';

const OVERALL = 'overall';

function targetKey(scope, id) {
  return scope === OVERALL ? OVERALL : `${scope}:${id}`;
}

// ── Manager-side (edit pages) ───────────────────────────────────────────────

/**
 * Load all webhook URLs for an event (event_runner/owner only — RLS returns nothing for others).
 * Returns { overall: string, team: { [teamId]: url }, player: { [playerId]: url } }
 */
export async function getEventWebhooks(eventId) {
  const out = { overall: '', team: {}, player: {} };
  if (!eventId) return out;
  const { data, error } = await supabase
    .from('event_webhooks')
    .select('scope, target_id, url')
    .eq('event_id', eventId);
  if (error) {
    console.warn('Could not load webhooks:', error.message);
    return out;
  }
  for (const row of data ?? []) {
    if (row.scope === OVERALL) out.overall = row.url;
    else if (out[row.scope]) out[row.scope][row.target_id] = row.url;
  }
  return out;
}

/**
 * Set or clear one webhook. Blank url deletes the row.
 * scope: 'overall' | 'team' | 'player'; targetId required for team/player.
 */
export async function setEventWebhook(eventId, scope, targetId, url) {
  const clean = (url ?? '').trim();
  const tid = scope === OVERALL ? null : targetId;
  if (scope !== OVERALL && !tid) throw new Error('targetId is required for team/player webhooks');

  if (!clean) {
    let q = supabase.from('event_webhooks').delete().eq('event_id', eventId).eq('scope', scope);
    q = tid ? q.eq('target_id', tid) : q.is('target_id', null);
    const { error } = await q;
    if (error) throw error;
    return;
  }

  if (!/^https:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/webhooks\//.test(clean)) {
    throw new Error('Discord webhook URL must start with https://discord.com/api/webhooks/');
  }

  const { error } = await supabase
    .from('event_webhooks')
    .upsert(
      { event_id: eventId, scope, target_id: tid, url: clean },
      { onConflict: 'event_id,scope,target_id' }
    );
  if (error) throw error;
}

/** Remove the webhook attached to a deleted team/player. Safe to call when none exists. */
export async function clearTargetWebhook(eventId, scope, targetId) {
  if (!eventId || !targetId) return;
  await supabase.from('event_webhooks').delete()
    .eq('event_id', eventId).eq('scope', scope).eq('target_id', targetId);
}

// ── Staff-side (commit flows) ───────────────────────────────────────────────

/**
 * Which targets have a webhook configured — no URLs returned.
 * Available to scorer/event_runner/owner via a SECURITY DEFINER RPC.
 * Returns a Set of keys: 'overall', 'team:<id>', 'player:<id>'.
 */
export async function getWebhookTargets(eventId) {
  const { data, error } = await supabase.rpc('get_webhook_targets', { p_event_id: eventId });
  if (error) {
    console.warn('Could not load webhook targets:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map(r => targetKey(r.scope, r.target_id)));
}

export function hasTarget(targets, scope, id) {
  return targets?.has(targetKey(scope, id)) ?? false;
}

/**
 * Deliver Discord posts server-side. Never throws — a failed webhook must never
 * block or roll back a commit.
 * posts: [{ target: { scope, id? }, payload: <Discord message JSON> }]
 */
export async function sendDiscord(eventId, posts) {
  const list = (posts ?? []).filter(p => p?.target && p?.payload);
  if (!eventId || list.length === 0) return { sent: 0, failed: 0 };
  try {
    const { data, error } = await supabase.functions.invoke('send-discord', {
      body: {
        event_id: eventId,
        posts: list.map(p => ({
          scope: p.target.scope,
          target_id: p.target.scope === OVERALL ? null : p.target.id,
          payload: p.payload,
        })),
      },
    });
    if (error) {
      console.warn('Discord delivery failed:', error.message);
      return { sent: 0, failed: list.length };
    }
    return data ?? { sent: 0, failed: 0 };
  } catch (err) {
    console.warn('Discord delivery error:', err);
    return { sent: 0, failed: list.length };
  }
}
