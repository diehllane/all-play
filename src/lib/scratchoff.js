// src/lib/scratchoff.js
// Scratch-off lottery tickets for the Slots prize store.
//
// Model: each scratch-off "game" is a finite, pre-printed pool of tickets.
// The event runner sets the total ticket count and how many prizes exist at
// each tier; everything else in the pool is a losing ticket. Every purchase
// draws one ticket from what's left (without replacement), so the printed odds
// are exact, just like a real roll of scratchers.
//
// All money movement and the draw itself happen server-side in Postgres:
//   buy_scratch_ticket()    — deducts CPC, draws the outcome, builds the 9-cell grid
//   reveal_scratch_ticket() — marks scratched, posts any win to slots_prize_board
// Both are SECURITY DEFINER with the same auth rule as purchase_store_item
// (caller must be the player's linked account, or event_runner/owner).

import { supabase } from './supabase';

// Highest → lowest value, matching the slot machine pay table.
export const SCRATCH_SYMBOLS = ['masterball', 'pokeball', 'greatball', 'ultraball', 'pikachu', 'eevee', 'rare_candy', 'potion', 'berry'];

export const SCRATCH_SYMBOL_LABELS = {
  masterball: 'Masterball', pokeball: 'Pokeball', greatball: 'Greatball',
  ultraball: 'Ultraball', pikachu: 'Pikachu', eevee: 'Eevee',
  rare_candy: 'Rare Candy', potion: 'Potion', berry: 'Berry',
};

export const SCRATCH_SYMBOL_IMAGES = {
  masterball: '/all-play/images/slots/masterball.png',
  pokeball:   '/all-play/images/slots/pokeball.png',
  greatball:  '/all-play/images/slots/greatball.png',
  ultraball:  '/all-play/images/slots/ultraball.png',
  pikachu:    '/all-play/images/slots/pikachu.png',
  eevee:      '/all-play/images/slots/eevee.png',
  rare_candy: '/all-play/images/slots/rarecandy.png',
  potion:     '/all-play/images/slots/potion.png',
  berry:      '/all-play/images/slots/berry.png',
};

export const MAX_SCRATCH_TIERS = 9;

/**
 * Default icon for a tier: Grand prize = Masterball, lowest tier = Berry,
 * tiers in between spread evenly across the remaining symbols.
 * @param {number} index 0-based position (0 = grand prize)
 * @param {number} tierCount total tiers in the game
 */
export function defaultTierIcon(index, tierCount) {
  if (tierCount <= 1) return SCRATCH_SYMBOLS[0];
  const last = SCRATCH_SYMBOLS.length - 1;
  return SCRATCH_SYMBOLS[Math.round((index * last) / (tierCount - 1))];
}

/**
 * Odds as printed on the back of a ticket, from the starting pool.
 * Returns { overall, tiers: [{ ...tier, oneIn }], totalPrizes, losers }.
 * oneIn is null when a tier has no prizes.
 */
export function computeOdds(totalTickets, tiers) {
  const total = Number(totalTickets) || 0;
  const withOdds = tiers.map(t => {
    const n = Number(t.prize_count) || 0;
    return { ...t, oneIn: n > 0 && total > 0 ? total / n : null };
  });
  const totalPrizes = withOdds.reduce((sum, t) => sum + (Number(t.prize_count) || 0), 0);
  return {
    overall: totalPrizes > 0 && total > 0 ? total / totalPrizes : null,
    tiers: withOdds,
    totalPrizes,
    losers: total - totalPrizes,
  };
}

/** "1 in 4.25" style, trimming trailing zeros. */
export function formatOneIn(oneIn) {
  if (oneIn === null || !isFinite(oneIn)) return '—';
  const rounded = oneIn >= 100 ? Math.round(oneIn) : Math.round(oneIn * 100) / 100;
  return `1 in ${rounded.toLocaleString()}`;
}

/**
 * Validates a game draft before it's saved. Returns an error string or null.
 */
export function validateScratchGame(draft) {
  if (!draft.label?.trim()) return 'Give the ticket a name.';
  const cost = Number(draft.cost_cpc);
  if (!Number.isFinite(cost) || cost < 0) return 'Ticket price must be 0 CPC or more.';
  const total = Number(draft.total_tickets);
  if (!Number.isInteger(total) || total < 1) return 'Total tickets must be a whole number of at least 1.';
  if (!draft.tiers?.length) return 'Add at least one prize tier.';
  if (draft.tiers.length > MAX_SCRATCH_TIERS) return `A ticket can have at most ${MAX_SCRATCH_TIERS} prize tiers.`;
  for (const [i, t] of draft.tiers.entries()) {
    if (!t.prize_label?.trim()) return `Tier ${i + 1} needs a prize name.`;
    const n = Number(t.prize_count);
    if (!Number.isInteger(n) || n < 1) return `Tier ${i + 1} needs a prize count of at least 1.`;
  }
  const iconKeys = draft.tiers.map(t => (t.icon_url?.trim() ? `url:${t.icon_url.trim()}` : `sym:${t.icon}`));
  if (new Set(iconKeys).size !== iconKeys.length) return 'Each tier needs its own icon, or players can\'t tell prizes apart.';
  const prizes = draft.tiers.reduce((sum, t) => sum + Number(t.prize_count), 0);
  if (prizes > total) return `There are ${prizes} prizes but only ${total} tickets. Add tickets or remove prizes.`;
  if (draft.max_per_player !== '' && draft.max_per_player != null) {
    const m = Number(draft.max_per_player);
    if (!Number.isInteger(m) || m < 1) return 'Max per player must be blank or a whole number of at least 1.';
  }
  return null;
}

// ─── DATA ─────────────────────────────────────────────────────────────────────

/** Games + tiers for an event. activeOnly hides games that are switched off. */
export async function fetchScratchGames(eventId, { activeOnly = false } = {}) {
  let q = supabase.from('slots_scratch_games').select('*, slots_scratch_tiers(*)').eq('event_id', eventId).order('sort_order').order('created_at');
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(g => ({
    ...g,
    tiers: [...(g.slots_scratch_tiers ?? [])].sort((a, b) => a.tier_rank - b.tier_rank),
  }));
}

/** A player's own tickets for an event, newest first. */
export async function fetchMyScratchTickets(playerId) {
  if (!playerId) return [];
  const { data, error } = await supabase
    .from('slots_scratch_tickets')
    .select('*')
    .eq('player_id', playerId)
    .order('purchased_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Every ticket in an event (staff only via RLS). */
export async function fetchEventScratchTickets(eventId) {
  const { data, error } = await supabase
    .from('slots_scratch_tickets')
    .select('*, slots_players(display_name)')
    .eq('event_id', eventId)
    .order('purchased_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function buyScratchTicket(eventId, playerId, gameId, actorId) {
  const { data, error } = await supabase.rpc('buy_scratch_ticket', {
    p_event_id: eventId, p_player_id: playerId, p_game_id: gameId, p_actor_id: actorId,
  });
  if (error) throw new Error(error.message || 'Could not buy ticket.');
  return { ticket: data.ticket, newCpc: data.newCpc };
}

export async function revealScratchTicket(ticketId, actorId) {
  const { data, error } = await supabase.rpc('reveal_scratch_ticket', {
    p_ticket_id: ticketId, p_actor_id: actorId,
  });
  if (error) throw new Error(error.message || 'Could not reveal ticket.');
  return { ticket: data.ticket, prizeRow: data.prizeRow };
}

/**
 * Create or update a game and its tiers.
 * Once any ticket has sold, the pool (ticket count, tier counts, price, tier
 * list) is locked so the odds already advertised can't change underneath
 * players. Only presentation fields stay editable then.
 * Sold count is re-read from the database at save time, not taken from UI state.
 */
export async function saveScratchGame(eventId, draft) {
  const err = validateScratchGame(draft);
  if (err) throw new Error(err);

  const base = {
    label: draft.label.trim(),
    description: draft.description?.trim() || null,
    max_per_player: draft.max_per_player === '' || draft.max_per_player == null ? null : Number(draft.max_per_player),
    is_active: draft.is_active !== false,
  };

  const tierRows = (gameId) => draft.tiers.map((t, i) => ({
    game_id: gameId,
    event_id: eventId,
    tier_rank: i + 1,
    prize_label: t.prize_label.trim(),
    icon: t.icon || defaultTierIcon(i, draft.tiers.length),
    icon_url: t.icon_url?.trim() || null,
    prize_count: Number(t.prize_count),
    prizes_remaining: Number(t.prize_count),
  }));

  // ── Create ──
  if (!draft.id) {
    const { data: game, error } = await supabase.from('slots_scratch_games')
      .insert({ ...base, event_id: eventId, cost_cpc: Number(draft.cost_cpc), total_tickets: Number(draft.total_tickets), tickets_remaining: Number(draft.total_tickets), sort_order: draft.sort_order ?? 0 })
      .select().single();
    if (error) throw error;
    const { error: tErr } = await supabase.from('slots_scratch_tiers').insert(tierRows(game.id));
    if (tErr) {
      await supabase.from('slots_scratch_games').delete().eq('id', game.id).select();
      throw tErr;
    }
    return game;
  }

  // ── Update ──
  const { count: sold, error: cErr } = await supabase
    .from('slots_scratch_tickets').select('id', { count: 'exact', head: true }).eq('game_id', draft.id);
  if (cErr) throw cErr;

  if ((sold ?? 0) === 0) {
    const { error: gErr } = await supabase.from('slots_scratch_games')
      .update({ ...base, cost_cpc: Number(draft.cost_cpc), total_tickets: Number(draft.total_tickets), tickets_remaining: Number(draft.total_tickets) })
      .eq('id', draft.id).select();
    if (gErr) throw gErr;
    const { error: dErr } = await supabase.from('slots_scratch_tiers').delete().eq('game_id', draft.id).select();
    if (dErr) throw dErr;
    const { error: tErr } = await supabase.from('slots_scratch_tiers').insert(tierRows(draft.id));
    if (tErr) throw tErr;
    return { id: draft.id };
  }

  // Tickets have sold: presentation-only edits
  const { error: gErr } = await supabase.from('slots_scratch_games').update(base).eq('id', draft.id).select();
  if (gErr) throw gErr;
  for (const t of draft.tiers) {
    if (!t.id) continue;
    const { error: tErr } = await supabase.from('slots_scratch_tiers')
      .update({ prize_label: t.prize_label.trim(), icon: t.icon, icon_url: t.icon_url?.trim() || null })
      .eq('id', t.id).select();
    if (tErr) throw tErr;
  }
  return { id: draft.id, locked: true };
}

export async function setScratchGameActive(gameId, isActive) {
  const { data, error } = await supabase.from('slots_scratch_games').update({ is_active: isActive }).eq('id', gameId).select();
  if (error) throw error;
  if (!data?.length) throw new Error('Update was blocked — check your role.');
}

/** Deletes a game, its tiers and its tickets. Prize board rows already won stay (label kept). */
export async function deleteScratchGame(gameId) {
  const { data, error } = await supabase.from('slots_scratch_games').delete().eq('id', gameId).select();
  if (error) throw error;
  if (!data?.length) throw new Error('Delete was blocked — check your role.');
}

/**
 * Finds the 3 matching cells in a grid. Used for highlighting; the server's
 * win_cells is authoritative but this lets the UI work from the grid alone.
 */
export function findWinCells(grid) {
  const pos = {};
  (grid ?? []).forEach((cell, i) => { (pos[cell.k] ??= []).push(i); });
  const hit = Object.values(pos).find(arr => arr.length >= 3);
  return hit ? hit.slice(0, 3) : null;
}
