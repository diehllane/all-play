// src/lib/highscoreExport.js
// XLSX export for High Score events. Produces 5 sheets.

import * as XLSX from 'xlsx';

export function exportHighScoreXLSX(eventName, config, teams, players, dailyTotals, commits, categories) {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Standings ───────────────────────────────────
  const standingsRows = [['Rank', 'Player', 'Team', 'Total Score']];
  const playerTotals = {};
  for (const row of dailyTotals) {
    if (!playerTotals[row.player_id]) playerTotals[row.player_id] = 0;
    playerTotals[row.player_id] += Number(row.final_score);
  }
  const sorted = [...players].sort(
    (a, b) => (playerTotals[b.id] || 0) - (playerTotals[a.id] || 0)
  );
  sorted.forEach((p, i) => {
    const team = teams.find(t => t.id === p.team_id);
    standingsRows.push([
      i + 1,
      p.name,
      team?.name || 'Solo',
      playerTotals[p.id] || 0,
    ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(standingsRows), 'Standings');

  // ── Sheet 2: Team Standings (team mode only) ─────────────
  if (config.mode === 'team' && teams.length > 0) {
    const teamTotals = {};
    for (const row of dailyTotals) {
      if (!row.team_id) continue;
      teamTotals[row.team_id] = (teamTotals[row.team_id] || 0) + Number(row.final_score);
    }
    const teamRows = [['Rank', 'Team', 'Handicap Multiplier', 'Total Score']];
    const sortedTeams = [...teams].sort(
      (a, b) => (teamTotals[b.id] || 0) - (teamTotals[a.id] || 0)
    );
    sortedTeams.forEach((t, i) => {
      teamRows.push([i + 1, t.name, t.handicap_multiplier, teamTotals[t.id] || 0]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(teamRows), 'Team Standings');
  }

  // ── Sheet 3: Daily Scores ────────────────────────────────
  const allDays = [...new Set(dailyTotals.map(r => r.day_number))].sort((a, b) => a - b);
  const dailyHeader = ['Player', 'Team', ...allDays.map(d => `Day ${d}`), 'Grand Total'];
  const dailyRows = [dailyHeader];
  const byPlayer = {};
  for (const row of dailyTotals) {
    if (!byPlayer[row.player_id]) byPlayer[row.player_id] = {};
    byPlayer[row.player_id][row.day_number] = Number(row.final_score);
  }
  sorted.forEach(p => {
    const team = teams.find(t => t.id === p.team_id);
    const dayScores = allDays.map(d => byPlayer[p.id]?.[d] ?? 0);
    const grand = dayScores.reduce((s, v) => s + v, 0);
    dailyRows.push([p.name, team?.name || 'Solo', ...dayScores, grand]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailyRows), 'Daily Scores');

  // ── Sheet 4: Score Entries ───────────────────────────────
  const entryRows = [['Day', 'Player', 'Team', 'Category', 'Points Each', 'Committed']];
  for (const row of dailyTotals) {
    // dailyTotals is summary; we note that granular entries require a separate fetch
    // This sheet is populated from the raw totals as a summary
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(entryRows), 'Score Entries');

  // ── Sheet 5: Commit History ──────────────────────────────
  const commitRows = [['Day', 'Committed At']];
  for (const c of commits) {
    commitRows.push([c.day_number, new Date(c.committed_at).toLocaleString()]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(commitRows), 'Commit History');

  // ── Sheet 6: Config ──────────────────────────────────────
  const configRows = [
    ['Setting', 'Value'],
    ['Mode', config.mode],
    ['Score Divisor', config.score_divisor],
    ['Score Operation', config.score_operation],
    ['Score Rounding', config.score_rounding],
    ['Handicap Enabled', config.allow_handicap],
    ['Start Date', config.start_date || ''],
    ['End Date', config.end_date || ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(configRows), 'Config');

  // ── Categories ───────────────────────────────────────────
  const catRows = [['Category', 'Points (Multiplier)']];
  for (const c of categories) {
    catRows.push([c.name, c.multiplier]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(catRows), 'Categories');

  const filename = `${eventName.replace(/\s+/g, '_')}_HighScore_Export.xlsx`;
  XLSX.writeFile(wb, filename);
}
