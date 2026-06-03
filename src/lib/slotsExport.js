// src/lib/slotsExport.js
// XLSX export for Slots events.
// 6 sheets: Players & Balances, Score Entries, Commits, Spins, Prize Board, Audit Log.

import * as XLSX from 'xlsx';
import { supabase } from './supabase';

export async function exportSlotsXLSX(eventId, eventName) {
  // Fetch all data in parallel
  const [
    { data: players },
    { data: categories },
    { data: scoreEntries },
    { data: commits },
    { data: spins },
    { data: prizeBoard },
    { data: storeItems },
    { data: auditLog },
  ] = await Promise.all([
    supabase.from('slots_players').select('*').eq('event_id', eventId).order('display_name'),
    supabase.from('slots_categories').select('*').eq('event_id', eventId).order('sort_order'),
    supabase.from('slots_score_entries')
      .select('*, slots_players(display_name), slots_categories(label, point_value)')
      .eq('event_id', eventId)
      .order('day_number').order('saved_at'),
    supabase.from('slots_commits').select('*').eq('event_id', eventId).order('day_number'),
    supabase.from('slots_spins').select('*, slots_players(display_name)').eq('event_id', eventId).order('spun_at', { ascending: false }).limit(5000),
    supabase.from('slots_prize_board')
      .select('*, slots_players(display_name), slots_store_items(label)')
      .eq('event_id', eventId)
      .order('purchased_at'),
    supabase.from('slots_store_items').select('*').eq('event_id', eventId),
    supabase.from('slots_audit_log').select('*, profiles(email)').eq('event_id', eventId).order('created_at', { ascending: false }).limit(2000),
  ]);

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Players & Balances ───────────────────────────────────────────
  const playerRows = (players ?? []).map(p => ({
    'Player':              p.display_name,
    'Slot Tokens':         p.slot_tokens,
    'Casino Prize Coins':  p.casino_prize_coins,
    'Total Tokens Spent':  p.total_tokens_spent,
    'Total CPC Won':       p.total_cpc_won,
    'Total Spins':         p.total_spins,
    'Jackpots Hit':        p.jackpots_hit,
    'Joined':              new Date(p.created_at).toLocaleString(),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(playerRows), 'Players & Balances');

  // ── Sheet 2: Score Entries ────────────────────────────────────────────────
  const entryRows = (scoreEntries ?? []).map(e => ({
    'Day':         e.day_number,
    'Player':      e.slots_players?.display_name ?? '—',
    'Category':    e.slots_categories?.label ?? '—',
    'Count':       e.encounter_count,
    'Points':      e.points_calculated,
    'Saved At':    new Date(e.saved_at).toLocaleString(),
    'Committed':   e.committed_at ? new Date(e.committed_at).toLocaleString() : 'Pending',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entryRows), 'Score Entries');

  // ── Sheet 3: Commits ──────────────────────────────────────────────────────
  const commitRows = (commits ?? []).flatMap(c => {
    const results = Array.isArray(c.player_results) ? c.player_results : [];
    if (results.length === 0) {
      return [{
        'Day':             c.day_number,
        'Committed At':    new Date(c.committed_at).toLocaleString(),
        'Player':          '—',
        'Raw Score':       0,
        'Tokens Awarded':  0,
        'Token Balance After': 0,
        'Discord Sent':    c.discord_sent ? 'Yes' : 'No',
      }];
    }
    return results.map(r => ({
      'Day':                 c.day_number,
      'Committed At':        new Date(c.committed_at).toLocaleString(),
      'Player':              r.playerName,
      'Raw Score':           r.rawScore,
      'Tokens Awarded':      r.tokensAwarded,
      'Token Balance After': r.tokenBalanceAfter,
      'Discord Sent':        c.discord_sent ? 'Yes' : 'No',
    }));
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(commitRows), 'Commits');

  // ── Sheet 4: Spins ────────────────────────────────────────────────────────
  const spinRows = (spins ?? []).map(s => ({
    'Player':       s.slots_players?.display_name ?? '—',
    'Reels':        (s.reels ?? []).join(' | '),
    'Outcome':      s.outcome_id,
    'Payout (CPC)': s.payout_cpc,
    'Tokens Spent': s.tokens_spent,
    'CPC Wagered':  s.cpc_wagered,
    'Tokens Before': s.balance_before?.tokens ?? '—',
    'CPC Before':    s.balance_before?.cpc ?? '—',
    'Tokens After':  s.balance_after?.tokens ?? '—',
    'CPC After':     s.balance_after?.cpc ?? '—',
    'Spun At':       new Date(s.spun_at).toLocaleString(),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(spinRows), 'Spins');

  // ── Sheet 5: Prize Board ──────────────────────────────────────────────────
  const itemMap = {};
  for (const item of storeItems ?? []) itemMap[item.id] = item;

  const prizeRows = (prizeBoard ?? []).map(p => ({
    'Player':        p.slots_players?.display_name ?? '—',
    'Prize':         p.slots_store_items?.label ?? '—',
    'Cost (CPC)':    p.cost_cpc_at_purchase,
    'Purchased At':  new Date(p.purchased_at).toLocaleString(),
    'Paid':          p.paid ? 'Yes' : 'No',
    'Paid At':       p.paid_at ? new Date(p.paid_at).toLocaleString() : '—',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prizeRows), 'Prize Board');

  // ── Sheet 6: Audit Log ────────────────────────────────────────────────────
  const auditRows = (auditLog ?? []).map(a => ({
    'Time':    new Date(a.created_at).toLocaleString(),
    'Actor':   a.profiles?.email ?? '—',
    'Action':  a.action,
    'Metadata': a.metadata ? JSON.stringify(a.metadata) : '—',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(auditRows), 'Audit Log');

  // ── Download ──────────────────────────────────────────────────────────────
  const filename = `${(eventName || 'Slots').replace(/[^a-z0-9]/gi, '_')}_Export.xlsx`;
  XLSX.writeFile(wb, filename);
}
