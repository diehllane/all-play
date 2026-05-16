// src/lib/bingo.js
// Core scoring and commit logic for the Bingo game mode

import { supabase } from './supabase';

// ============================================================
// CONSTANTS
// ============================================================

export const TEAM_COLORS = ['#ef4444', '#22c55e', '#eab308', '#3b82f6']; // R G Y B
export const TEAM_COLOR_NAMES = ['Red', 'Green', 'Yellow', 'Blue'];

// 5x5 grid: define all 12 possible bingo lines
// Each line is an array of positions (0-24, row-major)
export function getBingoLines() {
  const lines = [];
  // 5 rows
  for (let r = 0; r < 5; r++) {
    lines.push({
      type: 'row',
      index: r,
      positions: [r*5, r*5+1, r*5+2, r*5+3, r*5+4],
      configKey: `row${r+1}_value`,
    });
  }
  // 5 cols
  for (let c = 0; c < 5; c++) {
    lines.push({
      type: 'col',
      index: c,
      positions: [c, c+5, c+10, c+15, c+20],
      configKey: `col${c+1}_value`,
    });
  }
  // diag TL→BR
  lines.push({
    type: 'diag',
    index: 0,
    positions: [0, 6, 12, 18, 24],
    configKey: 'diag1_value',
  });
  // diag TR→BL
  lines.push({
    type: 'diag',
    index: 1,
    positions: [4, 8, 12, 16, 20],
    configKey: 'diag2_value',
  });
  return lines;
}

// ============================================================
// TIEBREAKER: given multiple lines that all complete at the same
// time (same triggering square), pick the one that "wins" the
// cash-in according to the rules.
// Returns the winning line.
// ============================================================
function resolveLineTiebreaker(lines, lineValues, squarePointValues) {
  // Sort descending by tiebreaker priority
  const scored = lines.map(line => {
    const bingoValue = lineValues[line.configKey] ?? 0;
    const squareSum = line.positions.reduce((s, p) => s + (squarePointValues[p] ?? 0), 0);
    // tiebreaker 3: first position in the line scanning L→R, T→B, then by type priority
    const firstPos = Math.min(...line.positions);
    const typePriority = line.type === 'row' ? 0 : line.type === 'col' ? 1 : 2;
    return { line, bingoValue, squareSum, firstPos, typePriority };
  });

  scored.sort((a, b) => {
    if (b.bingoValue !== a.bingoValue) return b.bingoValue - a.bingoValue;
    if (b.squareSum !== a.squareSum) return b.squareSum - a.squareSum;
    if (a.firstPos !== b.firstPos) return a.firstPos - b.firstPos;
    return a.typePriority - b.typePriority;
  });

  return scored[0].line;
}

// ============================================================
// CORE COMMIT LOGIC
// Called server-side style: takes all data, returns mutations
// ============================================================

/**
 * calculateCommitResults
 *
 * @param {object} params
 * @param {object} config - bingo_config row
 * @param {array}  squares - bingo_squares rows (with id, position, point_value, is_free_space)
 * @param {array}  players - bingo_players rows
 * @param {array}  teams   - bingo_teams rows (empty for solo)
 * @param {array}  entries - uncommitted bingo_score_entries for this day
 * @param {object} currentCompletions - { [player_id]: { [square_id]: available_count } }
 * @param {object} currentTeamCompletions - { [team_id]: { [square_id]: available_count } }
 * @param {object} currentScores - { [player_id]: { square_score, bingo_score, bingo_count } }
 * @param {object} currentTeamScores - { [team_id]: { square_score, bingo_score, bingo_count } }
 * @param {object} currentIndividualTotals - { [player_id]: { [square_id]: total_count } }
 * @param {number} dayNumber
 * @returns {object} mutations to apply
 */
export function calculateCommitResults({
  config,
  squares,
  players,
  teams,
  entries,
  currentCompletions,
  currentTeamCompletions,
  currentScores,
  currentTeamScores,
  currentIndividualTotals,
  dayNumber,
}) {
  const isTeam = config.event_type === 'team';
  const freeSpace = config.free_space_enabled;
  const bingoLines = getBingoLines();
  const lineValues = {};
  for (const line of bingoLines) {
    lineValues[line.configKey] = Number(config[line.configKey] ?? 0);
  }

  // Map square id → position and point_value
  const squareById = {};
  const squareByPosition = {};
  for (const sq of squares) {
    squareById[sq.id] = sq;
    squareByPosition[sq.position] = sq;
  }

  // Point values by position (for tiebreaker)
  const squarePointValues = {};
  for (const sq of squares) {
    squarePointValues[sq.position] = sq.is_free_space ? 0 : Number(sq.point_value);
  }

  // Player map
  const playerById = {};
  for (const p of players) playerById[p.id] = p;

  // Team map
  const teamById = {};
  for (const t of teams) teamById[t.id] = t;

  // ── Step 1: Tally entries into new completions per player ──
  // newPlayerCompletions[player_id][square_id] = count added today
  const newPlayerCompletions = {};
  const dailySquareScore = {}; // [player_id] = score from squares today

  for (const entry of entries) {
    const sq = squareById[entry.square_id];
    if (!sq) continue;
    const pid = entry.player_id;
    if (!newPlayerCompletions[pid]) newPlayerCompletions[pid] = {};
    newPlayerCompletions[pid][entry.square_id] = (newPlayerCompletions[pid][entry.square_id] ?? 0) + entry.quantity;
    // Square score (free space = 0)
    const pts = sq.is_free_space ? 0 : Number(sq.point_value) * entry.quantity;
    dailySquareScore[pid] = (dailySquareScore[pid] ?? 0) + pts;
  }

  // ── Step 2: Build updated available counts ──
  // These are the working pools for bingo detection
  // playerAvail[player_id][square_id] = available (not yet cashed in for team bingo)
  const playerAvail = {};
  for (const p of players) {
    playerAvail[p.id] = { ...(currentCompletions[p.id] ?? {}) };
    const newToday = newPlayerCompletions[p.id] ?? {};
    for (const [sqId, cnt] of Object.entries(newToday)) {
      playerAvail[p.id][sqId] = (playerAvail[p.id][sqId] ?? 0) + cnt;
    }
  }

  // playerIndividualTotal[player_id][square_id] = all-time count (for individual bingo)
  const playerIndividualTotal = {};
  for (const p of players) {
    playerIndividualTotal[p.id] = { ...(currentIndividualTotals[p.id] ?? {}) };
    const newToday = newPlayerCompletions[p.id] ?? {};
    for (const [sqId, cnt] of Object.entries(newToday)) {
      playerIndividualTotal[p.id][sqId] = (playerIndividualTotal[p.id][sqId] ?? 0) + cnt;
    }
  }

  // teamAvail[team_id][square_id] = sum of all player available counts on that team
  const teamAvail = {};
  if (isTeam) {
    for (const t of teams) {
      teamAvail[t.id] = { ...(currentTeamCompletions[t.id] ?? {}) };
    }
    // Add today's new completions to team pools
    for (const p of players) {
      if (!p.team_id) continue;
      const newToday = newPlayerCompletions[p.id] ?? {};
      for (const [sqId, cnt] of Object.entries(newToday)) {
        teamAvail[p.team_id][sqId] = (teamAvail[p.team_id][sqId] ?? 0) + cnt;
      }
    }
  }

  // ── Step 3: Free space — always available ──
  const freeSquare = freeSpace ? squares.find(s => s.is_free_space) : null;

  function getEffectiveCount(avail, sqId, isFree) {
    if (isFree) return Infinity;
    return avail[sqId] ?? 0;
  }

  // ── Step 4: Detect and resolve TEAM bingos ──
  const teamBingosEarned = []; // { team_id, line, squaresUsed: [{square_id, player_id}] }
  const teamDailyBingoScore = {}; // [team_id]

  if (isTeam) {
    for (const team of teams) {
      const avail = teamAvail[team.id];
      // Keep resolving bingos until no more can be formed
      let keepGoing = true;
      while (keepGoing) {
        keepGoing = false;
        // Find all lines that are currently completable
        const completableLines = [];
        for (const line of bingoLines) {
          const canComplete = line.positions.every(pos => {
            const sq = squareByPosition[pos];
            if (!sq) return false;
            return getEffectiveCount(avail, sq.id, sq.is_free_space) >= 1;
          });
          if (canComplete) completableLines.push(line);
        }

        if (completableLines.length === 0) break;

        // If multiple, resolve by tiebreaker
        const winningLine = completableLines.length === 1
          ? completableLines[0]
          : resolveLineTiebreaker(completableLines, lineValues, squarePointValues);

        // Cash in: deduct 1 from each non-free square in the line
        // Track which player contributed each square (for snapshot)
        const squaresUsed = [];
        for (const pos of winningLine.positions) {
          const sq = squareByPosition[pos];
          if (!sq || sq.is_free_space) continue;
          avail[sq.id] = (avail[sq.id] ?? 0) - 1;
          // Find a player on this team who contributed
          const contributingPlayer = players.find(p =>
            p.team_id === team.id && (playerAvail[p.id][sq.id] ?? 0) > 0
          );
          if (contributingPlayer) {
            playerAvail[contributingPlayer.id][sq.id] -= 1;
            squaresUsed.push({ square_id: sq.id, player_id: contributingPlayer.id });
          } else {
            squaresUsed.push({ square_id: sq.id, player_id: null });
          }
        }

        const lineVal = lineValues[winningLine.configKey] ?? 0;
        teamBingosEarned.push({ team_id: team.id, line: winningLine, squaresUsed, lineVal });
        teamDailyBingoScore[team.id] = (teamDailyBingoScore[team.id] ?? 0) + lineVal;
        keepGoing = true;
      }
      // Write back
      teamAvail[team.id] = avail;
    }
  }

  // ── Step 5: Detect INDIVIDUAL bingos ──
  // For solo events, player IS the team — process per player
  // For team events, individual bingo uses the player's own total count (not cashed in by team bingo)
  const individualBingosEarned = []; // { player_id, line, lineVal }
  const playerDailyBingoScore = {}; // [player_id]

  const processIndividualBingos = isTeam
    ? players
    : players; // both modes

  for (const player of processIndividualBingos) {
    const totalPool = playerIndividualTotal[player.id];
    // Individual bingo uses total_count (all-time), not affected by team cash-ins
    // We track how many individual bingos have already been awarded by using
    // a working copy of available individual completions
    const indivAvail = {};
    for (const [sqId, cnt] of Object.entries(totalPool)) {
      indivAvail[sqId] = cnt;
    }

    let keepGoing = true;
    while (keepGoing) {
      keepGoing = false;
      const completableLines = [];
      for (const line of bingoLines) {
        const canComplete = line.positions.every(pos => {
          const sq = squareByPosition[pos];
          if (!sq) return false;
          return getEffectiveCount(indivAvail, sq.id, sq.is_free_space) >= 1;
        });
        if (canComplete) completableLines.push(line);
      }

      if (completableLines.length === 0) break;

      const winningLine = completableLines.length === 1
        ? completableLines[0]
        : resolveLineTiebreaker(completableLines, lineValues, squarePointValues);

      // Cash in from individual pool
      for (const pos of winningLine.positions) {
        const sq = squareByPosition[pos];
        if (!sq || sq.is_free_space) continue;
        indivAvail[sq.id] = (indivAvail[sq.id] ?? 0) - 1;
      }

      const lineVal = lineValues[winningLine.configKey] ?? 0;
      individualBingosEarned.push({ player_id: player.id, line: winningLine, lineVal });
      playerDailyBingoScore[player.id] = (playerDailyBingoScore[player.id] ?? 0) + lineVal;
      keepGoing = true;
    }
  }

  // ── Step 6: Build score updates ──
  const playerScoreUpdates = {};
  for (const p of players) {
    const prev = currentScores[p.id] ?? { square_score: 0, bingo_score: 0, bingo_count: 0 };
    const sqScore = dailySquareScore[p.id] ?? 0;
    const bingoScore = playerDailyBingoScore[p.id] ?? 0;
    const bingoCnt = individualBingosEarned.filter(b => b.player_id === p.id).length;
    playerScoreUpdates[p.id] = {
      square_score: Number(prev.square_score) + sqScore,
      bingo_score: Number(prev.bingo_score) + bingoScore,
      total_score: Number(prev.square_score) + sqScore + Number(prev.bingo_score) + bingoScore,
      bingo_count: Number(prev.bingo_count) + bingoCnt,
    };
  }

  const teamScoreUpdates = {};
  if (isTeam) {
    for (const t of teams) {
      const prev = currentTeamScores[t.id] ?? { square_score: 0, bingo_score: 0, bingo_count: 0 };
      const teamPlayers = players.filter(p => p.team_id === t.id);
      const teamSqScore = teamPlayers.reduce((s, p) => s + (dailySquareScore[p.id] ?? 0), 0);
      const bingoScore = teamDailyBingoScore[t.id] ?? 0;
      const bingoCnt = teamBingosEarned.filter(b => b.team_id === t.id).length;
      teamScoreUpdates[t.id] = {
        square_score: Number(prev.square_score) + teamSqScore,
        bingo_score: Number(prev.bingo_score) + bingoScore,
        total_score: Number(prev.square_score) + teamSqScore + Number(prev.bingo_score) + bingoScore,
        bingo_count: Number(prev.bingo_count) + bingoCnt,
      };
    }
  }

  // ── Step 7: Build daily score rows ──
  const dailyScoreRows = players.map(p => ({
    player_id: p.id,
    day_number: dayNumber,
    square_score: dailySquareScore[p.id] ?? 0,
    bingo_score: playerDailyBingoScore[p.id] ?? 0,
    total_score: (dailySquareScore[p.id] ?? 0) + (playerDailyBingoScore[p.id] ?? 0),
  }));

  return {
    playerAvail,       // updated available counts per player
    teamAvail,         // updated available counts per team
    playerIndividualTotal, // updated all-time totals per player
    playerScoreUpdates,
    teamScoreUpdates,
    teamBingosEarned,
    individualBingosEarned,
    dailyScoreRows,
    dailySquareScore,
    teamDailyBingoScore,
    playerDailyBingoScore,
  };
}

// ============================================================
// DATABASE HELPERS
// ============================================================

export async function fetchBingoEventData(eventId) {
  const [
    { data: config },
    { data: squares },
    { data: players },
    { data: teams },
    { data: completions },
    { data: teamCompletions },
    { data: scores },
    { data: teamScores },
    { data: linesCompleted },
    { data: commits },
    { data: dailyScores },
  ] = await Promise.all([
    supabase.from('bingo_config').select('*').eq('event_id', eventId).single(),
    supabase.from('bingo_squares').select('*').eq('event_id', eventId).order('position'),
    supabase.from('bingo_players').select('*').eq('event_id', eventId).order('sort_order'),
    supabase.from('bingo_teams').select('*').eq('event_id', eventId).order('sort_order'),
    supabase.from('bingo_square_completions').select('*').eq('event_id', eventId),
    supabase.from('bingo_team_square_completions').select('*').eq('event_id', eventId),
    supabase.from('bingo_scores').select('*').eq('event_id', eventId),
    supabase.from('bingo_scores').select('*').eq('event_id', eventId).not('team_id', 'is', null),
    supabase.from('bingo_lines_completed').select('*').eq('event_id', eventId).order('created_at'),
    supabase.from('bingo_commits').select('*').eq('event_id', eventId).order('day_number'),
    supabase.from('bingo_daily_scores').select('*').eq('event_id', eventId),
  ]);

  return { config, squares, players, teams, completions, teamCompletions, scores, teamScores, linesCompleted, commits, dailyScores };
}

export async function fetchUncommittedEntries(eventId, dayNumber) {
  const { data } = await supabase
    .from('bingo_score_entries')
    .select('*')
    .eq('event_id', eventId)
    .eq('day_number', dayNumber)
    .eq('committed', false);
  return data ?? [];
}

export async function getNextDayNumber(eventId) {
  const { data } = await supabase
    .from('bingo_commits')
    .select('day_number')
    .eq('event_id', eventId)
    .order('day_number', { ascending: false })
    .limit(1);
  return data && data.length > 0 ? data[0].day_number + 1 : 1;
}

// ============================================================
// DISCORD WEBHOOK
// ============================================================

async function sendDiscordWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('Discord webhook failed:', e.message);
  }
}

function buildDiscordMessage({ config, teams, players, results, dayNumber, teamScoreUpdates, playerScoreUpdates }) {
  const isTeam = config.event_type === 'team';
  const eventName = config.game_title || 'Bingo Event';
  const lines = [`**${eventName} — Day ${dayNumber} Results**`];

  if (isTeam) {
    const teamRows = teams
      .map(t => ({
        name: t.name,
        scores: teamScoreUpdates[t.id] ?? { total_score: 0, bingo_count: 0 },
        bingosToday: results.teamBingosEarned.filter(b => b.team_id === t.id).length,
      }))
      .sort((a, b) => b.scores.total_score - a.scores.total_score);

    lines.push('', '**Team Standings**');
    teamRows.forEach((t, i) => {
      const todayBingos = t.bingosToday > 0 ? ` *(+${t.bingosToday} bingo${t.bingosToday > 1 ? 's' : ''} today)*` : '';
      lines.push(`${i + 1}. **${t.name}** — ${t.scores.total_score} pts (${t.scores.bingo_count} total bingos)${todayBingos}`);
    });

    const playerRows = players
      .map(p => ({
        name: p.name,
        team: teams.find(t => t.id === p.team_id)?.name ?? '',
        scores: playerScoreUpdates[p.id] ?? { total_score: 0, bingo_count: 0 },
        bingosToday: results.individualBingosEarned.filter(b => b.player_id === p.id).length,
      }))
      .sort((a, b) => b.scores.total_score - a.scores.total_score);

    lines.push('', '**Individual Standings**');
    playerRows.forEach((p, i) => {
      const todayBingos = p.bingosToday > 0 ? ` *(+${p.bingosToday} bingo${p.bingosToday > 1 ? 's' : ''} today)*` : '';
      lines.push(`${i + 1}. **${p.name}** [${p.team}] — ${p.scores.total_score} pts${todayBingos}`);
    });
  } else {
    const playerRows = players
      .map(p => ({
        name: p.name,
        scores: playerScoreUpdates[p.id] ?? { total_score: 0, bingo_count: 0 },
        bingosToday: results.individualBingosEarned.filter(b => b.player_id === p.id).length,
      }))
      .sort((a, b) => b.scores.total_score - a.scores.total_score);

    lines.push('', '**Standings**');
    playerRows.forEach((p, i) => {
      const todayBingos = p.bingosToday > 0 ? ` *(+${p.bingosToday} bingo${p.bingosToday > 1 ? 's' : ''} today)*` : '';
      lines.push(`${i + 1}. **${p.name}** — ${p.scores.total_score} pts (${p.scores.bingo_count} total bingos)${todayBingos}`);
    });
  }

  return { content: lines.join('\n') };
}

// ============================================================
// COMMIT TO DATABASE
// ============================================================

export async function commitBingoDay(eventId, dayNumber, userId) {
  // 1. Load all needed data
  const {
    config, squares, players, teams,
    completions, teamCompletions, scores, teamScores,
  } = await fetchBingoEventData(eventId);

  if (!config) throw new Error('Bingo config not found');

  const entries = await fetchUncommittedEntries(eventId, dayNumber);
  if (entries.length === 0) throw new Error('No entries to commit for this day');

  // 2. Build current state maps
  const currentCompletions = {};
  const currentIndividualTotals = {};
  for (const c of (completions ?? [])) {
    if (!currentCompletions[c.player_id]) currentCompletions[c.player_id] = {};
    if (!currentIndividualTotals[c.player_id]) currentIndividualTotals[c.player_id] = {};
    currentCompletions[c.player_id][c.square_id] = c.available_count;
    currentIndividualTotals[c.player_id][c.square_id] = c.total_count;
  }

  const currentTeamCompletions = {};
  for (const c of (teamCompletions ?? [])) {
    if (!currentTeamCompletions[c.team_id]) currentTeamCompletions[c.team_id] = {};
    currentTeamCompletions[c.team_id][c.square_id] = c.available_count;
  }

  const currentScores = {};
  for (const s of (scores ?? [])) {
    if (s.player_id) currentScores[s.player_id] = s;
  }

  const currentTeamScores = {};
  for (const s of (teamScores ?? [])) {
    if (s.team_id) currentTeamScores[s.team_id] = s;
  }

  // 3. Pre-commit snapshot for undo
  const preCommitSnapshot = {
    completions: completions ?? [],
    teamCompletions: teamCompletions ?? [],
    scores: scores ?? [],
    teamScores: teamScores ?? [],
    linesCompleted: (await supabase.from('bingo_lines_completed').select('*').eq('event_id', eventId)).data ?? [],
    dailyScores: (await supabase.from('bingo_daily_scores').select('*').eq('event_id', eventId)).data ?? [],
  };

  // 4. Calculate results
  const results = calculateCommitResults({
    config,
    squares,
    players,
    teams,
    entries,
    currentCompletions,
    currentTeamCompletions,
    currentScores,
    currentTeamScores,
    currentIndividualTotals,
    dayNumber,
  });

  // 5. Write commit record
  const { data: commitRow, error: commitError } = await supabase
    .from('bingo_commits')
    .insert({
      event_id: eventId,
      day_number: dayNumber,
      committed_by: userId,
      pre_commit_snapshot: preCommitSnapshot,
      results_summary: {
        teamBingos: results.teamBingosEarned.length,
        individualBingos: results.individualBingosEarned.length,
        entriesCommitted: entries.length,
      },
    })
    .select()
    .single();
  if (commitError) throw commitError;

  const commitId = commitRow.id;

  // 6. Mark entries as committed
  const entryIds = entries.map(e => e.id);
  await supabase.from('bingo_score_entries').update({ committed: true }).in('id', entryIds);

  // 7. Upsert player square completions
  const completionUpserts = [];
  for (const player of players) {
    const avail = results.playerAvail[player.id] ?? {};
    const total = results.playerIndividualTotal[player.id] ?? {};
    const allSquareIds = new Set([...Object.keys(avail), ...Object.keys(total)]);
    for (const sqId of allSquareIds) {
      completionUpserts.push({
        event_id: eventId,
        player_id: player.id,
        square_id: sqId,
        available_count: avail[sqId] ?? 0,
        total_count: total[sqId] ?? 0,
      });
    }
  }
  if (completionUpserts.length > 0) {
    await supabase.from('bingo_square_completions')
      .upsert(completionUpserts, { onConflict: 'event_id,player_id,square_id' });
  }

  // 8. Upsert team square completions
  if (config.event_type === 'team') {
    const teamCompletionUpserts = [];
    for (const team of teams) {
      const avail = results.teamAvail[team.id] ?? {};
      for (const [sqId, cnt] of Object.entries(avail)) {
        teamCompletionUpserts.push({
          event_id: eventId,
          team_id: team.id,
          square_id: sqId,
          available_count: cnt,
        });
      }
    }
    if (teamCompletionUpserts.length > 0) {
      await supabase.from('bingo_team_square_completions')
        .upsert(teamCompletionUpserts, { onConflict: 'event_id,team_id,square_id' });
    }
  }

  // 9. Upsert player scores
  const playerScoreUpserts = players.map(p => ({
    event_id: eventId,
    player_id: p.id,
    team_id: null,
    ...results.playerScoreUpdates[p.id],
  }));
  if (playerScoreUpserts.length > 0) {
    await supabase.from('bingo_scores')
      .upsert(playerScoreUpserts, { onConflict: 'event_id,player_id' });
  }

  // 10. Upsert team scores
  if (config.event_type === 'team') {
    const teamScoreUpserts = teams.map(t => ({
      event_id: eventId,
      player_id: null,
      team_id: t.id,
      ...results.teamScoreUpdates[t.id],
    }));
    if (teamScoreUpserts.length > 0) {
      await supabase.from('bingo_scores')
        .upsert(teamScoreUpserts, { onConflict: 'event_id,team_id' });
    }
  }

  // 11. Insert bingo lines completed
  const lineInserts = [];
  for (const b of results.teamBingosEarned) {
    lineInserts.push({
      event_id: eventId,
      team_id: b.team_id,
      player_id: null,
      is_individual: false,
      line_type: b.line.type,
      line_index: b.line.index,
      line_value: b.lineVal,
      day_number: dayNumber,
      commit_id: commitId,
      squares_used: b.squaresUsed,
    });
  }
  for (const b of results.individualBingosEarned) {
    const player = players.find(p => p.id === b.player_id);
    lineInserts.push({
      event_id: eventId,
      team_id: player?.team_id ?? null,
      player_id: b.player_id,
      is_individual: true,
      line_type: b.line.type,
      line_index: b.line.index,
      line_value: b.lineVal,
      day_number: dayNumber,
      commit_id: commitId,
      squares_used: null,
    });
  }
  if (lineInserts.length > 0) {
    await supabase.from('bingo_lines_completed').insert(lineInserts);
  }

  // 12. Send Discord webhook (fire-and-forget, never blocks commit)
  const discordPayload = buildDiscordMessage({
    config,
    teams: teams ?? [],
    players,
    results,
    dayNumber,
    teamScoreUpdates: results.teamScoreUpdates,
    playerScoreUpdates: results.playerScoreUpdates,
  });
  // Overall event webhook
  await sendDiscordWebhook(config.discord_webhook_url, discordPayload);
  // Per-team webhooks (team events only)
  if (config.event_type === 'team' && teams?.length > 0) {
    await Promise.all(
      teams
        .filter(t => t.discord_webhook_url)
        .map(t => sendDiscordWebhook(t.discord_webhook_url, discordPayload))
    );
  }

  // 13. Insert daily scores
  const dailyInserts = results.dailyScoreRows.map(r => ({
    event_id: eventId,
    ...r,
  }));
  if (dailyInserts.length > 0) {
    await supabase.from('bingo_daily_scores')
      .upsert(dailyInserts, { onConflict: 'event_id,player_id,day_number' });
  }

  return { success: true, commitId, results };
}

// ============================================================
// UNDO LAST COMMIT
// ============================================================

export async function undoBingoCommit(eventId) {
  // Get the last commit
  const { data: lastCommit } = await supabase
    .from('bingo_commits')
    .select('*')
    .eq('event_id', eventId)
    .order('day_number', { ascending: false })
    .limit(1)
    .single();

  if (!lastCommit) throw new Error('No commit to undo');

  const snap = lastCommit.pre_commit_snapshot;
  const dayNumber = lastCommit.day_number;

  // Restore completions
  await supabase.from('bingo_square_completions').delete().eq('event_id', eventId);
  if (snap.completions?.length > 0) {
    await supabase.from('bingo_square_completions').insert(snap.completions);
  }

  await supabase.from('bingo_team_square_completions').delete().eq('event_id', eventId);
  if (snap.teamCompletions?.length > 0) {
    await supabase.from('bingo_team_square_completions').insert(snap.teamCompletions);
  }

  // Restore scores
  await supabase.from('bingo_scores').delete().eq('event_id', eventId);
  if (snap.scores?.length > 0) {
    await supabase.from('bingo_scores').insert(snap.scores);
  }

  // Restore lines completed
  await supabase.from('bingo_lines_completed').delete().eq('event_id', eventId);
  if (snap.linesCompleted?.length > 0) {
    await supabase.from('bingo_lines_completed').insert(snap.linesCompleted);
  }

  // Restore daily scores
  await supabase.from('bingo_daily_scores').delete().eq('event_id', eventId);
  if (snap.dailyScores?.length > 0) {
    await supabase.from('bingo_daily_scores').insert(snap.dailyScores);
  }

  // Un-commit the entries for that day
  await supabase.from('bingo_score_entries')
    .update({ committed: false })
    .eq('event_id', eventId)
    .eq('day_number', dayNumber)
    .eq('committed', true);

  // Delete the commit record
  await supabase.from('bingo_commits').delete().eq('id', lastCommit.id);

  return { success: true, dayNumber };
}

// ============================================================
// LINE LABEL HELPERS
// ============================================================

export function getLineName(line) {
  if (line.type === 'row') return `Row ${line.index + 1}`;
  if (line.type === 'col') return `Column ${line.index + 1}`;
  if (line.type === 'diag' && line.index === 0) return 'Diagonal (↘)';
  if (line.type === 'diag' && line.index === 1) return 'Diagonal (↙)';
  return 'Unknown';
}

export function getLineKey(line) {
  return `${line.type}-${line.index}`;
}
