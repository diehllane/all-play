// src/lib/highscore.js
// All DB operations and business logic for the High Score game type.

import { supabase } from './supabase';

// ── CONFIG ───────────────────────────────────────────────────

export async function getHSConfig(eventId) {
  const { data, error } = await supabase
    .from('hs_config')
    .select('*')
    .eq('event_id', eventId)
    .single();
  if (error) throw error;
  return data;
}

export async function upsertHSConfig(eventId, config) {
  const { data, error } = await supabase
    .from('hs_config')
    .upsert({ ...config, event_id: eventId }, { onConflict: 'event_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── TEAMS ────────────────────────────────────────────────────

export async function getHSTeams(eventId) {
  const { data, error } = await supabase
    .from('hs_teams')
    .select('*')
    .eq('event_id', eventId)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function createHSTeam(eventId, team) {
  const { data, error } = await supabase
    .from('hs_teams')
    .insert({ ...team, event_id: eventId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateHSTeam(teamId, updates) {
  const { data, error } = await supabase
    .from('hs_teams')
    .update(updates)
    .eq('id', teamId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteHSTeam(teamId) {
  const { error } = await supabase.from('hs_teams').delete().eq('id', teamId);
  if (error) throw error;
}

// ── PLAYERS ──────────────────────────────────────────────────

export async function getHSPlayers(eventId) {
  const { data, error } = await supabase
    .from('hs_players')
    .select('*, hs_teams(id, name, avatar_url, handicap_multiplier)')
    .eq('event_id', eventId)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function createHSPlayer(eventId, player) {
  const { data, error } = await supabase
    .from('hs_players')
    .insert({ ...player, event_id: eventId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateHSPlayer(playerId, updates) {
  const { data, error } = await supabase
    .from('hs_players')
    .update(updates)
    .eq('id', playerId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteHSPlayer(playerId) {
  const { error } = await supabase.from('hs_players').delete().eq('id', playerId);
  if (error) throw error;
}

// ── SCORE ENTRIES (uncommitted) ──────────────────────────────

export async function getHSEntries(eventId, dayNumber) {
  const { data, error } = await supabase
    .from('hs_score_entries')
    .select('*, hs_players(id, name, avatar_url, team_id), categories(id, name, multiplier)')
    .eq('event_id', eventId)
    .eq('day_number', dayNumber)
    .eq('committed', false)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

export async function addHSEntry(eventId, { playerId, teamId, categoryId, pointsEach, dayNumber }) {
  const { data, error } = await supabase
    .from('hs_score_entries')
    .insert({
      event_id: eventId,
      player_id: playerId,
      team_id: teamId,
      category_id: categoryId,
      encounter_count: 1,
      points_each: pointsEach,
      day_number: dayNumber,
      committed: false,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeHSEntry(entryId) {
  const { error } = await supabase.from('hs_score_entries').delete().eq('id', entryId);
  if (error) throw error;
}

// ── DAILY TOTALS ─────────────────────────────────────────────

export async function getHSDailyTotals(eventId) {
  const { data, error } = await supabase
    .from('hs_daily_totals')
    .select('*, hs_players(id, name, avatar_url, team_id), hs_teams(id, name)')
    .eq('event_id', eventId)
    .order('day_number')
    .order('final_score', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── COMMIT / UNDO ────────────────────────────────────────────

export async function commitHSDay(eventId, dayNumber, config, players, teams) {
  // 1. Fetch all uncommitted entries for the day
  const { data: entries, error: eErr } = await supabase
    .from('hs_score_entries')
    .select('*, categories(multiplier)')
    .eq('event_id', eventId)
    .eq('day_number', dayNumber)
    .eq('committed', false);
  if (eErr) throw eErr;

  // 2. Fetch existing daily totals for snapshot
  const { data: existingTotals } = await supabase
    .from('hs_daily_totals')
    .select('*')
    .eq('event_id', eventId);

  // 3. Build per-player raw scores
  const playerScores = {};
  for (const entry of entries) {
    if (!playerScores[entry.player_id]) playerScores[entry.player_id] = 0;
    playerScores[entry.player_id] += entry.points_each;
  }

  // 4. Apply scoring formula from config
  const applyFormula = (raw, player) => {
    const teamMultiplier = (() => {
      if (!config.allow_handicap) return 1;
      const team = teams.find(t => t.id === player.team_id);
      return team?.handicap_multiplier ?? 1;
    })();

    let score = raw * teamMultiplier;
    const divisor = config.score_divisor || 1;
    if (config.score_operation === 'multiply') {
      score = score * divisor;
    } else {
      score = score / divisor;
    }
    if (config.score_rounding === 'ceil') score = Math.ceil(score);
    else if (config.score_rounding === 'floor') score = Math.floor(score);
    else score = Math.round(score);
    return score;
  };

  // 5. Save pre-commit snapshot
  const snapshot = { dailyTotals: existingTotals || [] };
  const { error: commitErr } = await supabase.from('hs_commits').insert({
    event_id: eventId,
    day_number: dayNumber,
    pre_commit_snapshot: snapshot,
  });
  if (commitErr) throw commitErr;

  // 6. Upsert daily totals
  const upserts = players
    .filter(p => playerScores[p.id] !== undefined || true) // include zero-score players
    .map(p => {
      const raw = playerScores[p.id] || 0;
      const final = applyFormula(raw, p);
      return {
        event_id: eventId,
        player_id: p.id,
        team_id: p.team_id || null,
        day_number: dayNumber,
        raw_score: raw,
        final_score: final,
      };
    });

  if (upserts.length > 0) {
    const { error: upsertErr } = await supabase
      .from('hs_daily_totals')
      .upsert(upserts, { onConflict: 'event_id,player_id,day_number' });
    if (upsertErr) throw upsertErr;
  }

  // 7. Mark entries as committed
  if (entries.length > 0) {
    const ids = entries.map(e => e.id);
    const { error: markErr } = await supabase
      .from('hs_score_entries')
      .update({ committed: true })
      .in('id', ids);
    if (markErr) throw markErr;
  }

  return { playerScores, upserts };
}

export async function undoHSDay(eventId, dayNumber) {
  // Fetch most recent commit for this day
  const { data: commits, error: cErr } = await supabase
    .from('hs_commits')
    .select('*')
    .eq('event_id', eventId)
    .eq('day_number', dayNumber)
    .order('committed_at', { ascending: false })
    .limit(1);
  if (cErr) throw cErr;
  if (!commits || commits.length === 0) throw new Error('No commit found for this day');

  const commit = commits[0];
  const snapshot = commit.pre_commit_snapshot;

  // Delete daily totals for this day
  const { error: delErr } = await supabase
    .from('hs_daily_totals')
    .delete()
    .eq('event_id', eventId)
    .eq('day_number', dayNumber);
  if (delErr) throw delErr;

  // Restore snapshot totals (excluding this day — they were already removed)
  // Nothing else to restore since positions aren't tracked in high score

  // Mark day's entries as uncommitted
  const { error: markErr } = await supabase
    .from('hs_score_entries')
    .update({ committed: false })
    .eq('event_id', eventId)
    .eq('day_number', dayNumber)
    .eq('committed', true);
  if (markErr) throw markErr;

  // Remove the commit record
  const { error: delCommit } = await supabase
    .from('hs_commits')
    .delete()
    .eq('id', commit.id);
  if (delCommit) throw delCommit;
}

// ── STANDINGS CALCULATION ────────────────────────────────────

export function buildHSStandings(dailyTotals, players, teams, mode) {
  // Individual standings
  const playerTotals = {};
  for (const row of dailyTotals) {
    if (!playerTotals[row.player_id]) {
      playerTotals[row.player_id] = { totalScore: 0, days: {} };
    }
    playerTotals[row.player_id].totalScore += row.final_score;
    playerTotals[row.player_id].days[row.day_number] = row.final_score;
  }

  const individualStandings = players
    .map(p => {
      const stats = playerTotals[p.id] || { totalScore: 0, days: {} };
      const team = teams.find(t => t.id === p.team_id);
      return {
        playerId: p.id,
        name: p.name,
        avatarUrl: p.avatar_url,
        teamId: p.team_id,
        teamName: team?.name || null,
        totalScore: stats.totalScore,
        days: stats.days,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  if (mode === 'solo') {
    return { individualStandings, teamStandings: [] };
  }

  // Team standings
  const teamTotals = {};
  for (const row of dailyTotals) {
    if (!row.team_id) continue;
    if (!teamTotals[row.team_id]) teamTotals[row.team_id] = { totalScore: 0, days: {} };
    teamTotals[row.team_id].totalScore += row.final_score;
    if (!teamTotals[row.team_id].days[row.day_number]) {
      teamTotals[row.team_id].days[row.day_number] = 0;
    }
    teamTotals[row.team_id].days[row.day_number] += row.final_score;
  }

  const teamStandings = teams
    .map(t => {
      const stats = teamTotals[t.id] || { totalScore: 0, days: {} };
      const members = individualStandings.filter(p => p.teamId === t.id);
      return {
        teamId: t.id,
        name: t.name,
        avatarUrl: t.avatar_url,
        handicapMultiplier: t.handicap_multiplier,
        totalScore: stats.totalScore,
        days: stats.days,
        members,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((t, i) => ({ ...t, rank: i + 1 }));

  return { individualStandings, teamStandings };
}

// ── LAST COMMITTED DAY ───────────────────────────────────────

export async function getHSLastCommittedDay(eventId) {
  const { data, error } = await supabase
    .from('hs_commits')
    .select('day_number')
    .eq('event_id', eventId)
    .order('day_number', { ascending: false })
    .limit(1);
  if (error) return 0;
  return data?.[0]?.day_number ?? 0;
}
