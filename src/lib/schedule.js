/**
 * Generates a round-robin schedule for a list of team IDs.
 * Uses the "circle method" (polygon rotation algorithm).
 * Returns array of rounds, each round is array of {home, away} matchups.
 * If odd number of teams, one team gets a bye each round (null).
 */
export function generateRoundRobin(teamIds) {
  const teams = [...teamIds]
  if (teams.length % 2 !== 0) {
    teams.push(null) // bye placeholder
  }

  const n = teams.length
  const rounds = []
  const fixed = teams[0]
  const rotating = teams.slice(1)

  for (let round = 0; round < n - 1; round++) {
    const roundMatchups = []
    const current = [fixed, ...rotating]

    for (let i = 0; i < n / 2; i++) {
      const home = current[i]
      const away = current[n - 1 - i]
      if (home !== null && away !== null) {
        roundMatchups.push({ home_team_id: home, away_team_id: away })
      }
    }

    rounds.push(roundMatchups)

    // Rotate: move last element of rotating to front
    rotating.unshift(rotating.pop())
  }

  return rounds
}

/**
 * Generates the full schedule rows for DB insertion.
 * @param {string} eventId
 * @param {string} divisionId
 * @param {string[]} teamIds
 * @returns {Array} schedule rows ready for Supabase insert
 */
export function buildScheduleRows(eventId, divisionId, teamIds) {
  const rounds = generateRoundRobin(teamIds)
  const rows = []

  rounds.forEach((round, index) => {
    const dayNumber = index + 1
    round.forEach(matchup => {
      rows.push({
        event_id: eventId,
        division_id: divisionId,
        day_number: dayNumber,
        home_team_id: matchup.home_team_id,
        away_team_id: matchup.away_team_id,
      })
    })
  })

  return rows
}

/**
 * Returns total round robin days (= number of teams in division - 1, min 1)
 */
export function getRoundRobinDays(teamCount) {
  if (teamCount < 2) return 0
  const adjusted = teamCount % 2 === 0 ? teamCount : teamCount + 1
  return adjusted - 1
}
