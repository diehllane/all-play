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
 * Generate loser's bracket skeleton.
 * Losers feed in starting at round 2.
 * Seeded by: round they lost in (later = higher seed), then standings tiebreakers.
 */
export function generateLosersBracket(winnersBracketSize, eventId) {
  // Number of loser's bracket rounds = (winners rounds - 1) * 2 - 1
  // For a standard double elim loser's bracket
  const winnersRounds = Math.log2(winnersBracketSize)
  const matches = []
  let matchNumber = 1000 // offset to avoid collision with winners bracket match numbers

  // Round 1 of losers: first-round losers from winners bracket
  // Each subsequent round alternates between: receiving new losers + playing each other
  let teamsInRound = winnersBracketSize / 2 // losers from winners R1

  for (let round = 1; teamsInRound >= 2; round++) {
    const matchCount = teamsInRound / 2
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
    // Alternate: odd rounds receive new losers from winners (same count), 
    // even rounds only have survivors playing each other
    if (round % 2 === 0) {
      teamsInRound = matchCount // only survivors continue
    } else {
      teamsInRound = matchCount + matchCount // survivors + new losers from next winners round
      // cap at actual teams remaining
      if (teamsInRound > winnersBracketSize / 2) teamsInRound = matchCount
    }
    if (matchCount <= 1) break
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
