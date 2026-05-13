// src/lib/boardgame.js
// Board game calculation utilities

/**
 * Calculate moves for a player given their raw daily score and event config.
 */
export function calcMoves(rawScore, config) {
  const { score_divisor, score_operation, score_rounding, min_moves_per_day, max_moves_per_day } = config;

  let moves;
  if (score_operation === 'multiply') {
    moves = rawScore * score_divisor;
  } else {
    moves = score_divisor > 0 ? rawScore / score_divisor : rawScore;
  }

  if (score_rounding === 'ceil') moves = Math.ceil(moves);
  else if (score_rounding === 'floor') moves = Math.floor(moves);
  else moves = Math.round(moves);

  // Apply minimum
  moves = Math.max(moves, min_moves_per_day || 0);

  // Apply maximum cap if set
  if (max_moves_per_day > 0) {
    moves = Math.min(moves, max_moves_per_day);
  }

  return moves;
}

/**
 * Given a current position and squares to move, resolve the final position
 * applying any jump squares, with chain-jump protection.
 * Returns { finalPosition, squaresVisited, badges, prizes }
 */
export function resolveMovement(currentPos, moves, squares, trackLength) {
  const squareMap = {};
  squares.forEach(s => { squareMap[s.square_number] = s; });

  let pos = Math.min(currentPos + moves, trackLength);
  const squaresVisited = [];
  const badges = [];
  const prizes = [];

  // Collect all squares passed through
  for (let i = currentPos + 1; i <= pos; i++) {
    squaresVisited.push(i);
    const sq = squareMap[i];
    if (!sq) continue;
    if (sq.type === 'gym') badges.push(sq);
    if (sq.type === 'prize') prizes.push(sq);
  }

  // Resolve landing square jumps (one level only — no chain reactions by design)
  const landing = squareMap[pos];
  if (landing) {
    if ((landing.type === 'bonus_jump' || landing.type === 'penalty_jump') && landing.jump_to != null) {
      const dest = landing.jump_to;
      // Check squares between jump source and destination for badges/prizes
      if (dest > pos) {
        for (let i = pos + 1; i <= dest; i++) {
          const sq = squareMap[i];
          if (!sq) continue;
          if (sq.type === 'gym') badges.push(sq);
          if (sq.type === 'prize') prizes.push(sq);
        }
      }
      pos = Math.min(dest, trackLength);
    } else if (landing.type === 'bonus_small' && landing.move_amount) {
      pos = Math.min(pos + landing.move_amount, trackLength);
    } else if (landing.type === 'penalty_small' && landing.move_amount) {
      pos = Math.max(pos - Math.abs(landing.move_amount), 0);
    }
  }

  return { finalPosition: pos, squaresVisited, badges, prizes };
}

/**
 * Calculate the badge count for each player given their committed position
 * and the full squares list.
 */
export function calcBadges(position, squares) {
  return squares.filter(s => s.type === 'gym' && s.square_number <= position);
}

/**
 * Calculate which prize squares a player has reached or passed.
 */
export function calcPrizes(position, squares) {
  return squares.filter(s => s.type === 'prize' && s.square_number <= position);
}

/**
 * Build a snake-pattern grid mapping square numbers to { row, col }.
 * Row 0 is top (left→right), row 1 is right→left, etc.
 */
export function buildGrid(trackLength, gridColumns) {
  const grid = {};
  for (let sq = 0; sq <= trackLength; sq++) {
    const row = Math.floor(sq / gridColumns);
    const colInRow = sq % gridColumns;
    const col = row % 2 === 0 ? colInRow : gridColumns - 1 - colInRow;
    grid[sq] = { row, col };
  }
  return grid;
}

/**
 * Default board squares for a 252-square Kanto/Johto board.
 * Used to pre-populate the board builder for new board game events.
 */
export const DEFAULT_BOARD_SQUARES = [
  { square_number: 0,   type: 'start',        label: 'Start',               icon: '🏁', description: 'Your journey begins here.' },
  { square_number: 125, type: 'center',        label: 'Indigo Plateau',      icon: '🏥', description: 'Pokemon Center — heal up!' },
  { square_number: 126, type: 'elite',         label: 'Kanto Elite 4',       icon: '⚔️',  description: 'Face the Kanto Elite Four.' },
  { square_number: 250, type: 'center',        label: 'Pokemon Center',      icon: '🏥', description: 'Rest and recover.' },
  { square_number: 251, type: 'elite',         label: 'Indigo Plateau',      icon: '⚔️',  description: 'The Johto Elite Four await.' },
  { square_number: 252, type: 'finish',        label: 'Johto Elite 4',       icon: '🏆', description: 'Congratulations! You finished!' },
  // Kanto Gyms
  { square_number: 14,  type: 'gym', label: 'Pewter City Gym',    icon: '🪨', badge: 'Boulder Badge' },
  { square_number: 28,  type: 'gym', label: 'Cerulean City Gym',  icon: '💧', badge: 'Cascade Badge' },
  { square_number: 42,  type: 'gym', label: 'Vermilion City Gym', icon: '⚡', badge: 'Thunder Badge' },
  { square_number: 56,  type: 'gym', label: 'Celadon City Gym',   icon: '🌿', badge: 'Rainbow Badge' },
  { square_number: 70,  type: 'gym', label: 'Fuchsia City Gym',   icon: '☠️',  badge: 'Soul Badge' },
  { square_number: 84,  type: 'gym', label: 'Saffron City Gym',   icon: '🔮', badge: 'Marsh Badge' },
  { square_number: 98,  type: 'gym', label: 'Cinnabar Island Gym',icon: '🔥', badge: 'Volcano Badge' },
  { square_number: 112, type: 'gym', label: 'Viridian City Gym',  icon: '🌍', badge: 'Earth Badge' },
  // Johto Gyms
  { square_number: 140, type: 'gym', label: 'Violet City Gym',    icon: '🌬️', badge: 'Zephyr Badge' },
  { square_number: 153, type: 'gym', label: 'Azalea Town Gym',    icon: '🐛', badge: 'Hive Badge' },
  { square_number: 166, type: 'gym', label: 'Goldenrod City Gym', icon: '🌾', badge: 'Plain Badge' },
  { square_number: 179, type: 'gym', label: 'Ecruteak City Gym',  icon: '👻', badge: 'Fog Badge' },
  { square_number: 192, type: 'gym', label: 'Cianwood City Gym',  icon: '🌊', badge: 'Storm Badge' },
  { square_number: 205, type: 'gym', label: 'Olivine City Gym',   icon: '⚙️',  badge: 'Mineral Badge' },
  { square_number: 218, type: 'gym', label: 'Mahogany Town Gym',  icon: '🧊', badge: 'Glacier Badge' },
  { square_number: 231, type: 'gym', label: 'Blackthorn City Gym',icon: '🐉', badge: 'Rising Badge' },
  // Prize squares
  { square_number: 34,  type: 'prize',        label: '10 Quick Balls',  icon: '🎁', description: 'You earned 10 Quick Balls!' },
  { square_number: 69,  type: 'prize',        label: '5 Mystery Boxes', icon: '📦', description: 'You earned 5 Mystery Boxes!' },
  { square_number: 180, type: 'prize',        label: '1 Ability Capsule',icon: '💊', description: 'You earned 1 Ability Capsule!' },
  // Bonus jumps
  { square_number: 20,  type: 'bonus_jump',   label: 'Short Cut!',  icon: '⬆️',  jump_to: 34,  description: 'Jump ahead to Square 34!' },
  { square_number: 55,  type: 'bonus_jump',   label: 'Short Cut!',  icon: '⬆️',  jump_to: 69,  description: 'Jump ahead to Square 69!' },
  { square_number: 160, type: 'bonus_jump',   label: 'Short Cut!',  icon: '⬆️',  jump_to: 180, description: 'Jump ahead to Square 180!' },
  // Penalty jumps
  { square_number: 40,  type: 'penalty_jump', label: 'Setback!',    icon: '⬇️',  jump_to: 14,  description: 'Back to Pewter City Gym!' },
  { square_number: 85,  type: 'penalty_jump', label: 'Setback!',    icon: '⬇️',  jump_to: 70,  description: 'Back to Fuchsia City Gym!' },
  { square_number: 130, type: 'penalty_jump', label: 'Setback!',    icon: '⬇️',  jump_to: 98,  description: 'Back to Cinnabar Island Gym!' },
  { square_number: 195, type: 'penalty_jump', label: 'Setback!',    icon: '⬇️',  jump_to: 140, description: 'Back to Violet City Gym!' },
  { square_number: 230, type: 'penalty_jump', label: 'Setback!',    icon: '⬇️',  jump_to: 218, description: 'Back to Mahogany Town Gym!' },
  // Small bonus squares
  ...([8,22,48,62,78,100,115,135,150,168,190,210,235,248]).map(n => ({
    square_number: n, type: 'bonus_small', icon: '✨', move_amount: 2, label: '+2 Steps'
  })),
  // Small penalty squares
  ...([12,30,52,73,90,108,118,145,162,175,200,220,240,245]).map(n => ({
    square_number: n, type: 'penalty_small', icon: '💢', move_amount: 2, label: '-2 Steps'
  })),
];

export const SQUARE_TYPES = [
  { value: 'start',        label: 'Start',          color: '#4caf50' },
  { value: 'finish',       label: 'Finish',          color: '#ffd700' },
  { value: 'center',       label: 'Pokemon Center',  color: '#e91e63' },
  { value: 'gym',          label: 'Gym',             color: '#1565c0' },
  { value: 'elite',        label: 'Elite 4',         color: '#6a1b9a' },
  { value: 'prize',        label: 'Prize',           color: '#ff6f00' },
  { value: 'bonus_jump',   label: 'Bonus Jump',      color: '#00897b' },
  { value: 'penalty_jump', label: 'Penalty Jump',    color: '#b71c1c' },
  { value: 'bonus_small',  label: 'Small Bonus',     color: '#2e7d32' },
  { value: 'penalty_small',label: 'Small Penalty',   color: '#c62828' },
  { value: 'flavor',       label: 'Flavor Only',     color: '#546e7a' },
];

export function squareColor(type, themeColor = '#c62828') {
  const found = SQUARE_TYPES.find(t => t.value === type);
  return found ? found.color : themeColor;
}
