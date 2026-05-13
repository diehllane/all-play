// src/lib/boardgameExport.js
import * as XLSX from 'xlsx';
import { calcBadges, calcPrizes } from './boardgame';

/**
 * Export a board game event to XLSX with 4 sheets:
 *  1. Players & Positions
 *  2. Daily Score Entries
 *  3. Commit History
 *  4. Board Configuration
 */
export function exportBoardGameXLSX(event, config, players, positions, scoreEntries, commits, squares, categories) {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Players & Positions ──────────────────────────
  const posMap = {};
  positions.forEach(p => { posMap[p.player_id] = p.position; });

  const playerRows = players.map(p => {
    const pos = posMap[p.id] || 0;
    const badges = calcBadges(pos, squares);
    const prizes = calcPrizes(pos, squares);
    return {
      Player: p.name,
      Position: pos,
      'Progress %': ((pos / (config.track_length || 252)) * 100).toFixed(1) + '%',
      'Badge Count': badges.length,
      'Badges Earned': badges.map(b => b.badge).filter(Boolean).join(', '),
      'Prizes Earned': prizes.map(b => b.label).filter(Boolean).join(', '),
    };
  }).sort((a, b) => b.Position - a.Position);

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(playerRows), 'Players & Positions');

  // ── Sheet 2: Daily Score Entries ──────────────────────────
  const catMap = {};
  categories.forEach(c => { catMap[c.id] = c.name; });
  const playerMap = {};
  players.forEach(p => { playerMap[p.id] = p.name; });

  const entryRows = scoreEntries.map(e => ({
    Day: e.day_number,
    Player: playerMap[e.player_id] || e.player_id,
    Category: catMap[e.category_id] || 'Unknown',
    Points: e.points,
    'Entered At': new Date(e.created_at).toLocaleString(),
  })).sort((a, b) => a.Day - b.Day || a.Player.localeCompare(b.Player));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entryRows), 'Score Entries');

  // ── Sheet 3: Daily Totals (pivot: player × day) ───────────
  const days = [...new Set(scoreEntries.map(e => e.day_number))].sort((a, b) => a - b);
  const dailyTotals = players.map(p => {
    const row = { Player: p.name };
    let total = 0;
    days.forEach(d => {
      const sum = scoreEntries
        .filter(e => e.player_id === p.id && e.day_number === d)
        .reduce((acc, e) => acc + (e.points || 0), 0);
      row[`Day ${d}`] = sum;
      total += sum;
    });
    row['Total Score'] = total;
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyTotals), 'Daily Totals');

  // ── Sheet 4: Commit History ───────────────────────────────
  const commitRows = commits.map(c => ({
    Day: c.day_number,
    'Committed At': c.committed_at ? new Date(c.committed_at).toLocaleString() : '',
    'Reverted At': c.reverted_at ? new Date(c.reverted_at).toLocaleString() : '',
    Status: c.reverted_at ? 'Reverted' : 'Committed',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(commitRows), 'Commit History');

  // ── Sheet 5: Board Config ─────────────────────────────────
  const configRows = [
    { Key: 'Track Length',      Value: config.track_length },
    { Key: 'Grid Columns',      Value: config.grid_columns },
    { Key: 'Score Divisor',     Value: config.score_divisor },
    { Key: 'Score Operation',   Value: config.score_operation },
    { Key: 'Score Rounding',    Value: config.score_rounding },
    { Key: 'Min Moves/Day',     Value: config.min_moves_per_day },
    { Key: 'Max Moves/Day',     Value: config.max_moves_per_day === 0 ? 'No cap' : config.max_moves_per_day },
    { Key: 'Badge Bonus',       Value: config.badge_bonus_enabled ? 'Yes' : 'No' },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(configRows), 'Board Config');

  // Write and download
  const filename = `${event.name.replace(/[^a-z0-9]/gi, '_')}_BoardGame_Export.xlsx`;
  XLSX.writeFile(wb, filename);
}
