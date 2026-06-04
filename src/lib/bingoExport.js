// src/lib/bingoExport.js
import * as XLSX from 'xlsx';

const LINE_KEYS = [
  { key: 'row1_value', label: 'Row 1' },
  { key: 'row2_value', label: 'Row 2' },
  { key: 'row3_value', label: 'Row 3' },
  { key: 'row4_value', label: 'Row 4' },
  { key: 'row5_value', label: 'Row 5' },
  { key: 'col1_value', label: 'Column 1' },
  { key: 'col2_value', label: 'Column 2' },
  { key: 'col3_value', label: 'Column 3' },
  { key: 'col4_value', label: 'Column 4' },
  { key: 'col5_value', label: 'Column 5' },
  { key: 'diag1_value', label: 'Diagonal ↘' },
  { key: 'diag2_value', label: 'Diagonal ↙' },
];

/**
 * Export a bingo event to XLSX with 5 sheets:
 *  1. Standings        — player/team totals, bingo counts
 *  2. Score Entries    — individual encounter rows by day
 *  3. Daily Totals     — pivot: player × day score
 *  4. Bingos Completed — log of every line completed
 *  5. Board Config     — squares + line values + settings
 */
export function exportBingoXLSX(event, config, players, teams, squares, scoreEntries, commits, scores, linesCompleted, dailyScores) {
  const wb = XLSX.utils.book_new();
  const isTeam = config.event_type === 'team';

  // ── Lookups ───────────────────────────────────────────────
  const playerMap = Object.fromEntries((players ?? []).map(p => [p.id, p.name]));
  const teamMap   = Object.fromEntries((teams   ?? []).map(t => [t.id, t.name]));
  const squareMap = Object.fromEntries((squares ?? []).map(s => [s.position, s.label || `Square ${s.position + 1}`]));

  // ── Sheet 1: Standings ────────────────────────────────────
  const playerScores = (scores ?? []).filter(s => s.player_id);
  const teamScores   = (scores ?? []).filter(s => s.team_id);

  const standingRows = isTeam
    ? (teams ?? [])
        .map(t => {
          const s = teamScores.find(x => x.team_id === t.id) ?? {};
          return {
            Team:          t.name,
            'Square Score':  s.square_score  ?? 0,
            'Bingo Bonus':   s.bingo_score   ?? 0,
            'Total Score':   s.total_score   ?? 0,
            'Bingo Count':   s.bingo_count   ?? 0,
          };
        })
        .sort((a, b) => b['Total Score'] - a['Total Score'])
    : (players ?? [])
        .map(p => {
          const s = playerScores.find(x => x.player_id === p.id) ?? {};
          return {
            Player:          p.name,
            'Square Score':  s.square_score  ?? 0,
            'Bingo Bonus':   s.bingo_score   ?? 0,
            'Total Score':   s.total_score   ?? 0,
            'Bingo Count':   s.bingo_count   ?? 0,
          };
        })
        .sort((a, b) => b['Total Score'] - a['Total Score']);

  // For team events, append individual standings below
  if (isTeam) {
    standingRows.push({}, { Team: '— Individual Standings —', 'Square Score': '', 'Bingo Bonus': '', 'Total Score': '', 'Bingo Count': '' });
    (players ?? [])
      .map(p => {
        const s = playerScores.find(x => x.player_id === p.id) ?? {};
        return {
          Team:            teamMap[p.team_id] ? `${p.name} (${teamMap[p.team_id]})` : p.name,
          'Square Score':  s.square_score  ?? 0,
          'Bingo Bonus':   s.bingo_score   ?? 0,
          'Total Score':   s.total_score   ?? 0,
          'Bingo Count':   s.bingo_count   ?? 0,
        };
      })
      .sort((a, b) => b['Total Score'] - a['Total Score'])
      .forEach(r => standingRows.push(r));
  }

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(standingRows), 'Standings');

  // ── Sheet 2: Score Entries ────────────────────────────────
  const entryRows = (scoreEntries ?? [])
    .map(e => ({
      Day:         e.day_number,
      Player:      playerMap[e.player_id] || e.player_id,
      Team:        isTeam ? (teamMap[teams?.find(t => (players ?? []).find(p => p.id === e.player_id)?.team_id === t.id)?.id] ?? '') : undefined,
      Square:      squareMap[e.square_position] || `Position ${e.square_position}`,
      Points:      e.points ?? 0,
      Quantity:    e.quantity ?? 1,
      'Entered At': e.created_at ? new Date(e.created_at).toLocaleString() : '',
    }))
    .map(r => { if (!isTeam) delete r.Team; return r; })
    .sort((a, b) => a.Day - b.Day || (a.Player ?? '').localeCompare(b.Player ?? ''));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entryRows.length ? entryRows : [{ Note: 'No entries yet' }]), 'Score Entries');

  // ── Sheet 3: Daily Totals (player × day pivot) ────────────
  const days = [...new Set((dailyScores ?? []).map(d => d.day_number))].sort((a, b) => a - b);
  const subjects = isTeam ? (teams ?? []) : (players ?? []);
  const idField  = isTeam ? 'team_id' : 'player_id';
  const nameKey  = isTeam ? 'name' : 'name';

  const dailyRows = subjects.map(s => {
    const row = { [isTeam ? 'Team' : 'Player']: s[nameKey] };
    let total = 0;
    days.forEach(d => {
      const ds = (dailyScores ?? []).find(x => x[idField] === s.id && x.day_number === d);
      const pts = ds ? (ds.square_score ?? 0) + (ds.bingo_score ?? 0) : 0;
      row[`Day ${d}`] = pts;
      total += pts;
    });
    row['Total'] = total;
    return row;
  });

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows.length ? dailyRows : [{ Note: 'No daily data yet' }]), 'Daily Totals');

  // ── Sheet 4: Bingos Completed ─────────────────────────────
  const bingoRows = (linesCompleted ?? [])
    .map(l => ({
      Day:          l.day_number,
      Type:         l.team_id ? 'Team' : 'Individual',
      Who:          l.team_id ? (teamMap[l.team_id] ?? l.team_id) : (playerMap[l.player_id] ?? l.player_id),
      Line:         l.line_key,
      Bonus:        l.bonus_value ?? 0,
      'Completed At': l.created_at ? new Date(l.created_at).toLocaleString() : '',
    }))
    .sort((a, b) => a.Day - b.Day);

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bingoRows.length ? bingoRows : [{ Note: 'No bingos completed yet' }]), 'Bingos Completed');

  // ── Sheet 5: Board Config ─────────────────────────────────
  const configRows = [
    { Key: 'Event Type',     Value: isTeam ? 'Team Bingo' : 'Solo Bingo' },
    { Key: 'Free Space',     Value: config.free_space_enabled ? 'Enabled' : 'Disabled' },
    { Key: 'Score Divisor',  Value: config.score_divisor ?? 1 },
    { Key: 'Score Operation',Value: config.score_operation ?? 'divide' },
    { Key: 'Rounding Mode',  Value: config.score_rounding_mode ?? 'ceil' },
    { Key: '', Value: '' },
    { Key: '— Line Values —', Value: '' },
    ...LINE_KEYS.map(({ key, label }) => ({ Key: label, Value: config[key] ?? 0 })),
    { Key: '', Value: '' },
    { Key: '— Squares —', Value: '' },
    ...(squares ?? []).map(s => ({
      Key:   `Position ${s.position}${s.is_free_space ? ' (FREE)' : ''}`,
      Value: `${s.label || '(no label)'}  |  ${s.point_value ?? 1}pts${s.description ? `  |  ${s.description}` : ''}`,
    })),
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(configRows), 'Board Config');

  // ── Write ─────────────────────────────────────────────────
  const filename = `${(event?.name ?? 'Bingo').replace(/[^a-z0-9]/gi, '_')}_Bingo_Export.xlsx`;
  XLSX.writeFile(wb, filename);
}
