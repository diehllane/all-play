/**
 * Calculate a team's total score for a day given encounter counts and categories.
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
 * Win = 3, Tie = 2 each, Loss = 1
 */
export function getMatchupPoints(homeScore, awayScore) {
  if (homeScore > awayScore) return { homePoints: 3, awayPoints: 1 }
  if (awayScore > homeScore) return { homePoints: 1, awayPoints: 3 }
  return { homePoints: 2, awayPoints: 2 }
}

/**
 * Calculate the league average score for a given day.
 */
export function calculateLeagueAverage(teamScores) {
  if (!teamScores.length) return 0
  const sum = teamScores.reduce((a, b) => a + b, 0)
  return sum / teamScores.length
}

/**
 * Recalculate standings for all teams in an event from scratch.
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

  leagueAvgOutcomes.forEach(outcome => {
    if (!outcome.is_calculated) return
    const team = standingsMap[outcome.team_id]
    if (!team) return
    team.total_points += outcome.team_points
    if (outcome.team_points === 3) team.league_avg_wins++
    else if (outcome.team_points === 1) team.league_avg_losses++
    else team.league_avg_ties++
  })

  dailyScores.forEach(score => {
    if (!score.is_finalized) return
    const team = standingsMap[score.team_id]
    if (!team) return
    team.total_score += score.calculated_total
    team.days_played++
  })

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
 * Generate winner's bracket seedings.
 * All teams seeded by standings. Highest vs lowest pairing.
 * Top seeds get byes if not power of 2.
 */
export function generateWinnersBracket(sortedTeams, eventId) {
  const n = sortedTeams.length
  if (n < 2) return []

  let bracketSize = 1
  while (bracketSize < n) bracketSize *= 2

  const seeds = sortedTeams.map((t, i) => ({ ...t, seed: i + 1 }))
  const matches = []
  let matchNumber = 1

  const round1Pairs = []
  for (let i = 0; i < bracketSize / 2; i++) {
    const highSeed = seeds[i] || null
    const lowSeedIndex = bracketSize - 1 - i
    const lowSeed = seeds[lowSeedIndex] || null

    if (highSeed && !lowSeed) {
      round1Pairs.push({ team1: highSeed, team2: null, is_bye: true })
    } else if (highSeed && lowSeed) {
      round1Pairs.push({ team1: highSeed, team2: lowSeed, is_bye: false })
    }
  }

  round1Pairs.forEach(pair => {
    matches.push({
      event_id: eventId,
      bracket_type: 'winners',
      round_number: 1,
      match_number: matchNumber++,
      team1_id: pair.team1?.id || null,
      team2_id: pair.team2?.id || null,
      is_bye: pair.is_bye,
      winner_id: pair.is_bye ? pair.team1?.id : null,
      is_finalized: pair.is_bye,
      series_game: 1,
      series_wins_team1: 0,
      series_wins_team2: 0,
    })
  })

  // Generate subsequent rounds
  let roundMatches = round1Pairs.length
  let round = 2
  while (roundMatches > 1) {
    roundMatches = roundMatches / 2
    for (let i = 0; i < roundMatches; i++) {
      matches.push({
        event_id: eventId,
        bracket_type: 'winners',
        round_number: round,
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        is_bye: false,
        winner_id: null,
        is_finalized: false,
        series_game: 1,
        series_wins_team1: 0,
        series_wins_team2: 0,
      })
    }
    round++
  }

  return matches
}

/**
 * Generate loser's bracket skeleton based on actual team count.
 * Only real (non-bye) W-R1 matches produce losers.
 * @param {number} actualTeamCount - real number of teams
 * @param {string} eventId
 * @param {Array} winnersBracket - the generated winner's bracket matches
 */
export function generateLosersBracket(actualTeamCount, eventId, winnersBracket = []) {
  const matches = []
  let matchNumber = 1000

  // Count real (non-bye) matches in W-R1 — these produce the initial losers
  const realR1Matches = winnersBracket.filter(m => m.round_number === 1 && !m.is_bye)
  const initialLosers = realR1Matches.length // one loser per real R1 match

  if (initialLosers === 0) return [] // no losers bracket needed

  // How many winners bracket rounds exist (excluding R1)?
  const maxWinnersRound = winnersBracket.reduce((max, m) => Math.max(max, m.round_number), 0)

  // Loser's bracket structure:
  // - L-R1: initialLosers teams play (if ≥2), or wait for more to arrive
  // - Each winners bracket round (R2, R3...) drops new losers into the losers bracket
  // - Losers bracket alternates: receive new losers → internal play → receive → internal → ...

  let currentLosers = initialLosers
  let round = 1

  // If only 1 initial loser, they wait — losers bracket starts when W-R2 produces a loser
  if (initialLosers < 2) {
    // Start with W-R2 losers arriving — now 2 teams (1 initial + 1 from W-R2)
    currentLosers = 2
    // Don't generate a standalone L-R1, the first match is when 2 losers can play
  }

  // Generate rounds until only 1 team remains
  let winnersRoundDropping = 2 // W-R2 losers drop into L first
  while (currentLosers >= 2) {
    const matchCount = Math.floor(currentLosers / 2)
    for (let i = 0; i < matchCount; i++) {
      matches.push({
        event_id: eventId,
        bracket_type: 'losers',
        round_number: round,
        match_number: matchNumber++,
        team1_id: null,
        team2_id: null,
        is_bye: false,
        winner_id: null,
        is_finalized: false,
        series_game: 1,
        series_wins_team1: 0,
        series_wins_team2: 0,
      })
    }

    const survivors = matchCount
    round++
    winnersRoundDropping++

    // Next round: survivors + new losers from next winners round (if any)
    const newLosers = winnersRoundDropping <= maxWinnersRound ? 1 : 0
    currentLosers = survivors + newLosers

    // Safety: don't generate too many rounds
    if (round > 20) break
  }

  return matches
}

/**
 * Determine series winner based on format and current wins.
 */
export function getSeriesWinner(winsTeam1, winsTeam2, format) {
  const winsNeeded = format === 'best_of_3' ? 2 : format === 'best_of_5' ? 3 : 1
  if (winsTeam1 >= winsNeeded) return 'team1'
  if (winsTeam2 >= winsNeeded) return 'team2'
  return null
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

export function getRoundName(round, totalRounds, bracketType = 'winners') {
  if (bracketType === 'losers') return `Losers R${round}`
  const remaining = totalRounds - round
  if (remaining === 0) return 'Championship'
  if (remaining === 1) return 'Finals'
  if (remaining === 2) return 'Semifinals'
  if (remaining === 3) return 'Quarterfinals'
  return `Round ${round}`
}
