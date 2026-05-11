/**
 * Calculate a team's total score for a day given encounter counts and categories.
 * @param {Array} entries - [{category_id, encounter_count}]
 * @param {Array} categories - [{id, multiplier}]
 * @returns {number} total score
 */
export function calculateDayScore(entries, categories) {
  const categoryMap = Object.fromEntries(categories.map(c => [c.id, c.multiplier]))
  return entries.reduce((sum, entry) => {
    const multiplier = categoryMap[entry.category_id] ?? 1
    return sum + (entry.encounter_count * multiplier)
  }, 0)
}

/**
 * Determine matchup outcome points.
 * Returns { homePoints, awayPoints }
 * Win = 3, Tie = 2 each, Loss = 1
 */
export function getMatchupPoints(homeScore, awayScore) {
  if (homeScore > awayScore) return { homePoints: 3, awayPoints: 1 }
  if (awayScore > homeScore) return { homePoints: 1, awayPoints: 3 }
  return { homePoints: 2, awayPoints: 2 }
}

/**
 * Calculate the league average score for a given day.
 * @param {Array} teamScores - array of numeric scores for all teams that day
 * @returns {number} average score
 */
export function calculateLeagueAverage(teamScores) {
  if (!teamScores.length) return 0
  const sum = teamScores.reduce((a, b) => a + b, 0)
  return sum / teamScores.length
}

/**
 * Recalculate standings for all teams in an event from scratch.
 * @param {Array} teams
 * @param {Array} matchupOutcomes - all finalized matchup outcomes
 * @param {Array} leagueAvgOutcomes - all finalized league avg outcomes
 * @param {Array} dailyScores - all finalized daily scores
 * @returns {Array} standings rows ready for upsert
 */
export function recalculateStandings(teams, matchupOutcomes, leagueAvgOutcomes, dailyScores) {
  const standingsMap = {}

  teams.forEach(team => {
    standingsMap[team.id] = {
      team_id: team.id,
      event_id: team.event_id,
      division_id: team.division_id,
      total_points: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      league_avg_wins: 0,
      league_avg_losses: 0,
      league_avg_ties: 0,
      total_score: 0,
      days_played: 0,
      avg_daily_score: 0,
    }
  })

  // Head-to-head matchup outcomes
  matchupOutcomes.forEach(outcome => {
    if (!outcome.is_calculated) return

    const home = standingsMap[outcome.home_team_id]
    const away = standingsMap[outcome.away_team_id]

    if (home) {
      home.total_points += outcome.home_points
      if (outcome.home_points === 3) home.wins++
      else if (outcome.home_points === 1) home.losses++
      else home.ties++
    }

    if (away) {
      away.total_points += outcome.away_points
      if (outcome.away_points === 3) away.wins++
      else if (outcome.away_points === 1) away.losses++
      else away.ties++
    }
  })

  // League average outcomes
  leagueAvgOutcomes.forEach(outcome => {
    if (!outcome.is_calculated) return

    const team = standingsMap[outcome.team_id]
    if (!team) return

    team.total_points += outcome.team_points
    if (outcome.team_points === 3) team.league_avg_wins++
    else if (outcome.team_points === 1) team.league_avg_losses++
    else team.league_avg_ties++
  })

  // Daily scores for average calculation
  dailyScores.forEach(score => {
    if (!score.is_finalized) return
    const team = standingsMap[score.team_id]
    if (!team) return
    team.total_score += score.calculated_total
    team.days_played++
  })

  // Calculate averages
  Object.values(standingsMap).forEach(s => {
    s.avg_daily_score = s.days_played > 0 ? s.total_score / s.days_played : 0
  })

  return Object.values(standingsMap)
}

/**
 * Sort standings for seeding.
 * Primary: total_points DESC
 * Tiebreaker 1: league_avg_wins DESC
 * Tiebreaker 2: avg_daily_score DESC
 */
export function sortStandings(standings) {
  return [...standings].sort((a, b) => {
    if (b.total_points !== a.total_points) return b.total_points - a.total_points
    if (b.league_avg_wins !== a.league_avg_wins) return b.league_avg_wins - a.league_avg_wins
    return b.avg_daily_score - a.avg_daily_score
  })
}

/**
 * Generate playoff bracket seedings.
 * All teams seeded by standings sort order.
 * Highest seed vs lowest seed pairing.
 * Top seeds get byes if total teams not power of 2.
 *
 * Returns array of {team1_id, team2_id, is_bye, round_number, match_number}
 */
export function generatePlayoffBracket(sortedTeams, eventId) {
  const n = sortedTeams.length
  if (n < 2) return []

  // Find next power of 2
  let bracketSize = 1
  while (bracketSize < n) bracketSize *= 2

  const byeCount = bracketSize - n
  const matches = []
  let matchNumber = 1

  // Seed positions: 1 vs last, 2 vs second-to-last, etc.
  // Top byeCount seeds get byes in round 1
  const seeds = sortedTeams.map((t, i) => ({ ...t, seed: i + 1 }))

  // Pair seeds for round 1
  const round1Pairs = []
  for (let i = 0; i < bracketSize / 2; i++) {
    const highSeed = seeds[i] || null
    const lowSeedIndex = bracketSize - 1 - i
    const lowSeed = seeds[lowSeedIndex] || null

    if (highSeed && !lowSeed) {
      // Bye
      round1Pairs.push({ team1: highSeed, team2: null, is_bye: true })
    } else if (highSeed && lowSeed) {
      round1Pairs.push({ team1: highSeed, team2: lowSeed, is_bye: false })
    }
  }

  round1Pairs.forEach(pair => {
    matches.push({
      event_id: eventId,
      round_number: 1,
      match_number: matchNumber++,
      team1_id: pair.team1?.id || null,
      team2_id: pair.team2?.id || null,
      is_bye: pair.is_bye,
      winner_id: pair.is_bye ? pair.team1?.id : null,
      is_finalized: pair.is_bye,
    })
  })

  // Generate subsequent rounds (empty slots for winners to advance into)
  let roundMatches = round1Pairs.length
  let round = 2
  while (roundMatches > 1) {
    roundMatches = roundMatches / 2
    for (let i = 0; i < roundMatches; i++) {
      matches.push({
        event_id: eventId,
        round_number: round,
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        is_bye: false,
        winner_id: null,
        is_finalized: false,
      })
    }
    round++
  }

  return matches
}

export function formatScore(score) {
  if (score === null || score === undefined) return '—'
  return Number(score).toFixed(1)
}

export function getPointLabel(points) {
  if (points === 3) return 'W'
  if (points === 2) return 'T'
  if (points === 1) return 'L'
  return '—'
}
