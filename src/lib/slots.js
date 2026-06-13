// src/lib/slots.js
// Core logic for the Slots game mode.
// Covers: commit day, undo commit, token calculation, Discord webhook, event seeding.
// Spin resolution is handled server-side by the slots-spin Edge Function.

import { supabase } from './supabase';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const DEFAULT_SYMBOL_IMAGES = {
  masterball: null,
  pokeball:   null,
  greatball:  null,
  ultraball:  null,
  pikachu:    null,
  eevee:      null,
  rare_candy: null,
  potion:     null,
  berry:      null,
};

export const SYMBOL_LABELS = {
  masterball: 'Masterball',
  pokeball:   'Pokeball',
  greatball:  'Greatball',
  ultraball:  'Ultraball',
  pikachu:    'Pikachu',
  eevee:      'Eevee',
  rare_candy: 'Rare Candy',
  potion:     'Potion',
  berry:      'Berry',
};

// ─── TOKEN CALCULATION ────────────────────────────────────────────────────────

/**
 * Calculate tokens awarded to a player for a given raw score.
 * Mirrors the formula used by other game modes.
 */
export function calcTokens(rawScore, config) {
  const {
    score_divisor = 1,
    score_operation = 'divide',
    score_rounding = 'floor',
    min_tokens_per_day = 0,
    max_tokens_per_day = 0,
  } = config;

  let tokens;
  if (score_operation === 'multiply') {
    tokens = rawScore * score_divisor;
  } else {
    tokens = score_divisor > 0 ? rawScore / score_divisor : rawScore;
  }

  if (score_rounding === 'ceil')  tokens = Math.ceil(tokens);
  else if (score_rounding === 'round') tokens = Math.round(tokens);
  else tokens = Math.floor(tokens);

  tokens = Math.max(tokens, min_tokens_per_day || 0);
  if (max_tokens_per_day > 0) tokens = Math.min(tokens, max_tokens_per_day);

  return tokens;
}

// ─── DATA FETCHING ────────────────────────────────────────────────────────────

export async function fetchSlotsEventData(eventId) {
  const [
    { data: config },
    { data: categories },
    { data: players },
    { data: commits },
    { data: storeItems },
  ] = await Promise.all([
    supabase.from('slots_config').select('*').eq('event_id', eventId).single(),
    supabase.from('slots_categories').select('*').eq('event_id', eventId).eq('is_active', true).order('sort_order'),
    supabase.from('slots_players').select('*').eq('event_id', eventId).order('display_name'),
    supabase.from('slots_commits').select('*').eq('event_id', eventId).order('day_number', { ascending: false }),
    supabase.from('slots_store_items').select('*').eq('event_id', eventId).eq('is_active', true).order('cost_cpc'),
  ]);
  return { config, categories, players, commits, storeItems };
}

export async function fetchUncommittedEntries(eventId, dayNumber) {
  const { data, error } = await supabase
    .from('slots_score_entries')
    .select('*, slots_players(id, display_name), slots_categories(id, label, point_value)')
    .eq('event_id', eventId)
    .eq('day_number', dayNumber)
    .is('committed_at', null)
    .order('saved_at');
  if (error) throw error;
  return data ?? [];
}

export async function getNextDayNumber(eventId) {
  const { data } = await supabase
    .from('slots_commits')
    .select('day_number')
    .eq('event_id', eventId)
    .order('day_number', { ascending: false })
    .limit(1);
  return data?.length > 0 ? data[0].day_number + 1 : 1;
}

export async function fetchPayoutTable(eventId) {
  const { data, error } = await supabase
    .from('slots_payout_table')
    .select('*')
    .eq('event_id', eventId)
    .order('weight', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── PER-PLAYER PURCHASE COUNT ────────────────────────────────────────────────

/**
 * Returns the number of times a specific player has purchased a specific store item.
 */
export async function getPlayerPurchaseCount(playerId, storeItemId) {
  const { count, error } = await supabase
    .from('slots_prize_board')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .eq('store_item_id', storeItemId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Returns a map of store_item_id -> purchase count for a given player across
 * all items in the provided list. Used to batch-load purchase counts for the
 * public store page without N+1 queries.
 */
export async function getPlayerPurchaseCounts(playerId, storeItemIds) {
  if (!storeItemIds.length) return {};
  const { data, error } = await supabase
    .from('slots_prize_board')
    .select('store_item_id')
    .eq('player_id', playerId)
    .in('store_item_id', storeItemIds);
  if (error) throw error;
  const counts = {};
  for (const row of data ?? []) {
    counts[row.store_item_id] = (counts[row.store_item_id] ?? 0) + 1;
  }
  return counts;
}

// ─── COMMIT DAY ───────────────────────────────────────────────────────────────

export async function commitSlotsDay(eventId, dayNumber, userId) {
  // 1. Load config and players
  const { data: config, error: cfgErr } = await supabase
    .from('slots_config')
    .select('*')
    .eq('event_id', eventId)
    .single();
  if (cfgErr) throw cfgErr;

  const { data: players, error: plErr } = await supabase
    .from('slots_players')
    .select('*')
    .eq('event_id', eventId);
  if (plErr) throw plErr;

  // 2. Load uncommitted entries for this day
  const entries = await fetchUncommittedEntries(eventId, dayNumber);
  if (entries.length === 0) throw new Error('No entries to commit for this day.');

  // 3. Build pre-commit snapshot of all player balances
  const preCommitSnapshot = {};
  for (const p of players) {
    preCommitSnapshot[p.id] = {
      slot_tokens:        p.slot_tokens,
      casino_prize_coins: p.casino_prize_coins,
      total_tokens_spent: p.total_tokens_spent,
      total_cpc_won:      p.total_cpc_won,
    };
  }

  // 4. Tally raw score per player from entries
  const rawScores = {};
  for (const e of entries) {
    const pts = Number(e.slots_categories?.point_value ?? 0) * e.encounter_count;
    rawScores[e.player_id] = (rawScores[e.player_id] ?? 0) + pts;
  }

  // 5. Calculate tokens awarded and build player results
  const playerResults = [];
  const playerUpdates = {}; // player_id → { slot_tokens delta }

  for (const p of players) {
    const rawScore = rawScores[p.id] ?? 0;
    const tokensAwarded = calcTokens(rawScore, config);
    playerUpdates[p.id] = tokensAwarded;
    playerResults.push({
      playerId:          p.id,
      playerName:        p.display_name,
      rawScore,
      tokensAwarded,
      tokenBalanceAfter: p.slot_tokens + tokensAwarded,
    });
  }

  // Sort results by raw score descending for Discord message
  playerResults.sort((a, b) => b.rawScore - a.rawScore);

  // 6. Write commit record
  const { data: commitRow, error: commitErr } = await supabase
    .from('slots_commits')
    .insert({
      event_id:             eventId,
      day_number:           dayNumber,
      committed_by:         userId,
      pre_commit_snapshot:  preCommitSnapshot,
      player_results:       playerResults,
      discord_sent:         false,
    })
    .select()
    .single();
  if (commitErr) throw commitErr;

  // 7. Apply token awards to each player
  for (const p of players) {
    const tokens = playerUpdates[p.id] ?? 0;
    if (tokens === 0) continue;
    const { error: upErr } = await supabase
      .from('slots_players')
      .update({ slot_tokens: p.slot_tokens + tokens })
      .eq('id', p.id);
    if (upErr) throw upErr;
  }

  // 8. Mark entries as committed
  const entryIds = entries.map(e => e.id);
  const { error: markErr } = await supabase
    .from('slots_score_entries')
    .update({ committed_at: new Date().toISOString(), commit_id: commitRow.id })
    .in('id', entryIds);
  if (markErr) throw markErr;

  // 9. Write audit log
  await supabase.from('slots_audit_log').insert({
    event_id:  eventId,
    actor_id:  userId,
    action:    'commit',
    metadata:  { day_number: dayNumber, commit_id: commitRow.id, player_count: players.length },
  });

  // 10. Fire Discord webhook (non-blocking)
  if (config.discord_webhook_url) {
    const { data: updatedPlayers } = await supabase
      .from('slots_players')
      .select('id, display_name, slot_tokens, total_cpc_won')
      .eq('event_id', eventId);

    const playerMap = {};
    for (const p of updatedPlayers ?? []) playerMap[p.id] = p;

    sendSlotsDiscordWebhook({
      webhookUrl:    config.discord_webhook_url,
      eventTitle:    config.game_title || 'PokeNexus Slots',
      dayNumber,
      playerResults,
      playerMap,
    }).catch(err => console.warn('Discord webhook failed:', err.message));
  }

  return { commitId: commitRow.id, playerResults };
}

// ─── UNDO COMMIT ──────────────────────────────────────────────────────────────

export async function undoSlotsCommit(eventId) {
  // 1. Get the most recent commit
  const { data: commits, error: cErr } = await supabase
    .from('slots_commits')
    .select('*')
    .eq('event_id', eventId)
    .order('day_number', { ascending: false })
    .limit(1);
  if (cErr) throw cErr;
  if (!commits?.length) throw new Error('No commit to undo.');

  const commit = commits[0];
  const snap   = commit.pre_commit_snapshot;

  // 2. Restore pre-commit token balances for all players in snapshot
  for (const [playerId, balances] of Object.entries(snap)) {
    const { error: upErr } = await supabase
      .from('slots_players')
      .update({ slot_tokens: balances.slot_tokens })
      .eq('id', playerId);
    if (upErr) throw upErr;
  }

  // 3. Un-commit the entries for that day
  const { error: unmarkErr } = await supabase
    .from('slots_score_entries')
    .update({ committed_at: null, commit_id: null })
    .eq('event_id', eventId)
    .eq('commit_id', commit.id);
  if (unmarkErr) throw unmarkErr;

  // 4. Delete the commit record
  const { error: delErr } = await supabase
    .from('slots_commits')
    .delete()
    .eq('id', commit.id);
  if (delErr) throw delErr;

  // 5. Audit log
  await supabase.from('slots_audit_log').insert({
    event_id: eventId,
    action:   'undo_commit',
    metadata: { day_number: commit.day_number, reverted_commit_id: commit.id },
  });

  return { dayNumber: commit.day_number };
}

// ─── DISCORD WEBHOOK ─────────────────────────────────────────────────────────

async function sendSlotsDiscordWebhook({ webhookUrl, eventTitle, dayNumber, playerResults, playerMap }) {
  if (!webhookUrl) return;

  const lines = [`🎰 **${eventTitle} — Day ${dayNumber} Commit**`, ''];

  lines.push('📊 **Today\'s Scores**');
  playerResults.forEach((r, i) => {
    const p = playerMap[r.playerId];
    const totalCpc = p?.total_cpc_won ?? 0;
    const rank = i + 1;
    lines.push(
      `${rank}. **${r.playerName}** — ${r.rawScore.toLocaleString()} pts → ${r.tokensAwarded} 🎟️  (🪙 ${totalCpc.toLocaleString()} total CPC)`
    );
  });

  lines.push('');
  lines.push('💰 **Token Balances after commit**');
  const balanceParts = playerResults.map(r => {
    const p = playerMap[r.playerId];
    return `${r.playerName}: ${(p?.slot_tokens ?? r.tokenBalanceAfter).toLocaleString()} 🎟️`;
  });
  lines.push(balanceParts.join(' | '));

  try {
    await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content: lines.join('\n') }),
    });
  } catch (err) {
    console.warn('Discord webhook error:', err.message);
  }
}

// ─── PRIZE STORE ──────────────────────────────────────────────────────────────

/**
 * Purchase a prize store item for a player.
 * Enforces overall quantity limit and per-player limit (max_per_player).
 * Deducts CPC, inserts prize_board row, optionally awards slot tokens,
 * decrements quantity, writes audit log.
 */
export async function purchaseStoreItem(eventId, playerId, storeItemId, actorId) {
  // 1. Fetch player and item
  const [{ data: player, error: pErr }, { data: item, error: iErr }] = await Promise.all([
    supabase.from('slots_players').select('*').eq('id', playerId).single(),
    supabase.from('slots_store_items').select('*').eq('id', storeItemId).single(),
  ]);
  if (pErr) throw pErr;
  if (iErr) throw iErr;
  if (!player) throw new Error('Player not found.');
  if (!item)   throw new Error('Store item not found.');
  if (!item.is_active) throw new Error('This item is no longer available.');

  // 2. Check overall quantity
  if (item.quantity_remaining !== null && item.quantity_remaining <= 0) {
    throw new Error('This item is sold out.');
  }

  // 3. Check per-player limit
  if (item.max_per_player !== null) {
    const playerCount = await getPlayerPurchaseCount(playerId, storeItemId);
    if (playerCount >= item.max_per_player) {
      throw new Error(`You have already purchased this item the maximum number of times (${item.max_per_player}).`);
    }
  }

  // 4. Check CPC balance
  if (player.casino_prize_coins < item.cost_cpc) {
    throw new Error(`Not enough Casino Prize Coins. Need ${item.cost_cpc}, have ${player.casino_prize_coins}.`);
  }

  // 5. Deduct CPC and optionally award tokens
  const newCpc = player.casino_prize_coins - item.cost_cpc;
  let newTokens = player.slot_tokens;
  if (item.pays_out_slot_tokens && item.pays_out_slot_tokens > 0) {
    newTokens += item.pays_out_slot_tokens;
  }

  const { error: upErr } = await supabase
    .from('slots_players')
    .update({ casino_prize_coins: newCpc, slot_tokens: newTokens })
    .eq('id', playerId);
  if (upErr) throw upErr;

  // 6. Decrement overall quantity if limited
  if (item.quantity_remaining !== null) {
    const { error: qErr } = await supabase
      .from('slots_store_items')
      .update({ quantity_remaining: item.quantity_remaining - 1 })
      .eq('id', storeItemId);
    if (qErr) throw qErr;
  }

  // 7. Insert prize board row
  const { data: prizeRow, error: prErr } = await supabase
    .from('slots_prize_board')
    .insert({
      event_id:             eventId,
      player_id:            playerId,
      store_item_id:        storeItemId,
      cost_cpc_at_purchase: item.cost_cpc,
    })
    .select()
    .single();
  if (prErr) throw prErr;

  // 8. Audit log
  await supabase.from('slots_audit_log').insert({
    event_id:  eventId,
    actor_id:  actorId,
    action:    'purchase',
    player_id: playerId,
    metadata:  { store_item_id: storeItemId, store_item_label: item.label, cost_cpc: item.cost_cpc },
  });

  return { prizeRow, newCpc, newTokens };
}

/**
 * Mark a prize board entry as paid (or unpaid).
 */
export async function setPrizePaid(eventId, prizeBoardId, paid, actorId) {
  const { error } = await supabase
    .from('slots_prize_board')
    .update({
      paid,
      paid_at: paid ? new Date().toISOString() : null,
      paid_by: paid ? actorId : null,
    })
    .eq('id', prizeBoardId);
  if (error) throw error;

  await supabase.from('slots_audit_log').insert({
    event_id: eventId,
    actor_id: actorId,
    action:   paid ? 'prize_paid' : 'prize_unpaid',
    metadata: { prize_board_id: prizeBoardId },
  });
}

// ─── MANUAL TOKEN AWARD / DEDUCT ─────────────────────────────────────────────

export async function awardTokens(eventId, playerId, amount, reason, actorId) {
  const { data: player, error: pErr } = await supabase
    .from('slots_players').select('slot_tokens').eq('id', playerId).single();
  if (pErr) throw pErr;

  const newBalance = Math.max(0, player.slot_tokens + amount);
  const { error: upErr } = await supabase
    .from('slots_players')
    .update({ slot_tokens: newBalance })
    .eq('id', playerId);
  if (upErr) throw upErr;

  await supabase.from('slots_audit_log').insert({
    event_id:  eventId,
    actor_id:  actorId,
    action:    amount >= 0 ? 'token_award' : 'token_deduct',
    player_id: playerId,
    metadata:  { amount, reason, new_balance: newBalance },
  });

  return newBalance;
}

// ─── MANUAL CPC AWARD / DEDUCT ───────────────────────────────────────────────

export async function awardCPC(eventId, playerId, amount, reason, actorId) {
  const { data: player, error: pErr } = await supabase
    .from('slots_players').select('casino_prize_coins').eq('id', playerId).single();
  if (pErr) throw pErr;

  const newBalance = Math.max(0, player.casino_prize_coins + amount);
  const { error: upErr } = await supabase
    .from('slots_players')
    .update({ casino_prize_coins: newBalance })
    .eq('id', playerId);
  if (upErr) throw upErr;

  await supabase.from('slots_audit_log').insert({
    event_id:  eventId,
    actor_id:  actorId,
    action:    amount >= 0 ? 'cpc_award' : 'cpc_deduct',
    player_id: playerId,
    metadata:  { amount, reason, new_balance: newBalance },
  });

  return newBalance;
}

// ─── EVENT CREATION SEED ─────────────────────────────────────────────────────

export async function seedSlotsEvent({
  eventId,
  gameTitle,
  gameSubtitle,
  themeColor,
  discordWebhookUrl,
  scoreDivisor,
  scoreOperation,
  scoreRounding,
  minTokensPerDay,
  maxTokensPerDay,
  categories = [],
}) {
  const { error: cfgErr } = await supabase.from('slots_config').insert({
    event_id:            eventId,
    game_title:          gameTitle,
    game_subtitle:       gameSubtitle || null,
    theme_color:         themeColor || '#c62828',
    discord_webhook_url: discordWebhookUrl || null,
    score_divisor:       scoreDivisor ?? 1,
    score_operation:     scoreOperation || 'divide',
    score_rounding:      scoreRounding || 'floor',
    min_tokens_per_day:  minTokensPerDay ?? 0,
    max_tokens_per_day:  maxTokensPerDay ?? 0,
    symbol_images:       DEFAULT_SYMBOL_IMAGES,
  });
  if (cfgErr) throw cfgErr;

  const { error: seedErr } = await supabase.rpc('seed_slots_payout_table', { p_event_id: eventId });
  if (seedErr) throw seedErr;

  if (categories.length > 0) {
    const rows = categories
      .filter(c => c.label?.trim())
      .map((c, i) => ({
        event_id:    eventId,
        label:       c.label.trim(),
        point_value: Number(c.point_value) || 1,
        sort_order:  c.sort_order ?? i,
      }));
    if (rows.length > 0) {
      const { error: catErr } = await supabase.from('slots_categories').insert(rows);
      if (catErr) throw catErr;
    }
  }
}
