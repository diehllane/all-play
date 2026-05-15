import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { sortStandings, formatScore, getRoundName } from '../../lib/scoring'
import * as XLSX from 'xlsx'

export default function ExportPage() {
  const { id } = useParams()
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => { fetchEvent() }, [id])

  async function fetchEvent() {
    const { data } = await supabase.from('events').select('*').eq('id', id).single()
    setEvent(data)
    setLoading(false)
  }

  async function handleExport() {
    setExporting(true)
    setMessage(null)
    try {
      const [
        { data: teams }, { data: divisions }, { data: categories }, { data: standings },
        { data: dailyScores }, { data: scoreEntries }, { data: matchupOutcomes },
        { data: leagueAvgOutcomes }, { data: schedule }, { data: bracket }, { data: bracketConfig },
      ] = await Promise.all([
        supabase.from('teams').select('*').eq('event_id', id).order('team_number'),
        supabase.from('divisions').select('*').eq('event_id', id).order('division_number'),
        supabase.from('categories').select('*').eq('event_id', id).order('display_order'),
        supabase.from('standings').select('*').eq('event_id', id),
        supabase.from('daily_scores').select('*').eq('event_id', id).eq('is_finalized', true).order('day_number'),
        supabase.from('score_entries').select('*'),
        supabase.from('matchup_outcomes').select('*').eq('event_id', id).order('day_number'),
        supabase.from('league_average_outcomes').select('*').eq('event_id', id).order('day_number'),
        supabase.from('schedule').select('*').eq('event_id', id).order('day_number'),
        supabase.from('playoff_bracket').select('*').eq('event_id', id).order('bracket_type').order('round_number').order('match_number'),
        supabase.from('bracket_round_config').select('*').eq('event_id', id).order('bracket_type').order('round_number'),
      ])

      const teamMap = Object.fromEntries((teams || []).map(t => [t.id, t]))
      const divMap = Object.fromEntries((divisions || []).map(d => [d.id, d]))
      const catMap = Object.fromEntries((categories || []).map(c => [c.id, c]))
      const wb = XLSX.utils.book_new()

      const sortedStandings = sortStandings(standings || [])
      const standingsRows = [
        ['PokeNexus — ' + event.name], ['Standings'], [],
        ['Rank', 'Team', 'Division', 'Total Points', 'W', 'T', 'L', 'LA-W', 'LA-T', 'LA-L', 'Total Score', 'Days Played', 'Avg Daily Score'],
      ]
      sortedStandings.forEach((s, i) => {
        const team = teamMap[s.team_id]; const div = divMap[s.division_id]
        standingsRows.push([i + 1, team?.display_name || '—', div?.name || '—', s.total_points, s.wins, s.ties, s.losses, s.league_avg_wins, s.league_avg_ties, s.league_avg_losses, Number(s.total_score?.toFixed(2) || 0), s.days_played, Number(s.avg_daily_score?.toFixed(2) || 0)])
      })
      const standingsWs = XLSX.utils.aoa_to_sheet(standingsRows)
      standingsWs['!cols'] = [8, 28, 16, 14, 6, 6, 6, 8, 8, 8, 12, 12, 16].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, standingsWs, 'Standings')

      const maxDay = Math.max(...(schedule || []).map(s => s.day_number), 0)
      const scoreEntriesMap = {}
      ;(scoreEntries || []).forEach(e => { if (!scoreEntriesMap[e.daily_score_id]) scoreEntriesMap[e.daily_score_id] = []; scoreEntriesMap[e.daily_score_id].push(e) })
      const catNames = (categories || []).map(c => c.name)
      const scoreRows = [['PokeNexus — ' + event.name], ['Daily Scores'], [], ['Day', 'Team', 'Division', ...catNames, 'Total Score']]
      for (let day = 1; day <= maxDay; day++) {
        ;(teams || []).forEach(team => {
          const ds = (dailyScores || []).find(s => s.team_id === team.id && s.day_number === day)
          if (!ds) return
          const entries = scoreEntriesMap[ds.id] || []
          const catCounts = (categories || []).map(cat => { const entry = entries.find(e => e.category_id === cat.id); return entry ? entry.encounter_count : 0 })
          scoreRows.push([day, team.display_name, divMap[team.division_id]?.name || '—', ...catCounts, Number(ds.calculated_total?.toFixed(2) || 0)])
        })
        const laRow = (leagueAvgOutcomes || []).find(o => o.day_number === day)
        if (laRow) scoreRows.push([day, '— League Average —', '', ...catNames.map(() => ''), Number(laRow.league_average_score?.toFixed(2) || 0)])
        scoreRows.push([])
      }
      const scoreWs = XLSX.utils.aoa_to_sheet(scoreRows)
      scoreWs['!cols'] = [6, 28, 16, ...catNames.map(() => 12), 12].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, scoreWs, 'Daily Scores')

      const h2hRows = [['PokeNexus — ' + event.name], ['Head-to-Head Results'], [], ['Day', 'Home Team', 'Home Score', 'Home Pts', 'Away Score', 'Away Pts', 'Away Team', 'Result']]
      ;(matchupOutcomes || []).filter(o => o.is_calculated).forEach(o => {
        const home = teamMap[o.home_team_id]; const away = teamMap[o.away_team_id]
        h2hRows.push([o.day_number, home?.display_name || '—', Number(o.home_score?.toFixed(2) || 0), o.home_points, Number(o.away_score?.toFixed(2) || 0), o.away_points, away?.display_name || '—', o.home_points === 3 ? `${home?.display_name} wins` : o.away_points === 3 ? `${away?.display_name} wins` : 'Tie'])
      })
      const h2hWs = XLSX.utils.aoa_to_sheet(h2hRows)
      h2hWs['!cols'] = [6, 28, 12, 10, 12, 10, 28, 28].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, h2hWs, 'H2H Results')

      const laRows = [['PokeNexus — ' + event.name], ['League Average Results'], [], ['Day', 'Team', 'Team Score', 'League Avg', 'Outcome', 'Points']]
      ;(leagueAvgOutcomes || []).filter(o => o.is_calculated).forEach(o => {
        laRows.push([o.day_number, teamMap[o.team_id]?.display_name || '—', Number(o.team_score?.toFixed(2) || 0), Number(o.league_average_score?.toFixed(2) || 0), o.team_points === 3 ? 'Win' : o.team_points === 1 ? 'Loss' : 'Tie', o.team_points])
      })
      const laWs = XLSX.utils.aoa_to_sheet(laRows)
      laWs['!cols'] = [6, 28, 12, 12, 10, 8].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, laWs, 'League Avg Results')

      const winnersBracket = (bracket || []).filter(m => m.bracket_type === 'winners')
      const winnersMaxRound = Math.max(...winnersBracket.map(m => m.round_number), 0)
      const wBracketRows = [['PokeNexus — ' + event.name], ["Winner's Bracket"], [], ['Round', 'Round Name', 'Format', 'Match', 'Team 1', 'Score 1', 'Series W1', 'Team 2', 'Score 2', 'Series W2', 'Winner', 'Status']]
      winnersBracket.filter(m => !m.is_bye).forEach(m => {
        const config = (bracketConfig || []).find(c => c.bracket_type === 'winners' && c.round_number === m.round_number)
        wBracketRows.push([m.round_number, config?.round_name || getRoundName(m.round_number, winnersMaxRound, 'winners'), config?.format?.replace(/_/g, ' ') || 'single', m.match_number, teamMap[m.team1_id]?.display_name || 'TBD', m.team1_score !== null ? Number(m.team1_score?.toFixed(2)) : '', m.series_wins_team1 || 0, teamMap[m.team2_id]?.display_name || 'TBD', m.team2_score !== null ? Number(m.team2_score?.toFixed(2)) : '', m.series_wins_team2 || 0, teamMap[m.winner_id]?.display_name || 'TBD', m.is_finalized ? 'Final' : 'Pending'])
      })
      const wBracketWs = XLSX.utils.aoa_to_sheet(wBracketRows)
      wBracketWs['!cols'] = [8, 16, 12, 8, 28, 10, 10, 28, 10, 10, 28, 10].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, wBracketWs, "Winner's Bracket")

      const losersBracket = (bracket || []).filter(m => m.bracket_type === 'losers')
      const losersMaxRound = Math.max(...losersBracket.map(m => m.round_number), 0)
      const lBracketRows = [['PokeNexus — ' + event.name], ["Loser's Bracket (3rd Place+)"], [], ['Round', 'Round Name', 'Format', 'Match', 'Team 1', 'Score 1', 'Series W1', 'Team 2', 'Score 2', 'Series W2', 'Winner', 'Status']]
      losersBracket.filter(m => !m.is_bye).forEach(m => {
        const config = (bracketConfig || []).find(c => c.bracket_type === 'losers' && c.round_number === m.round_number)
        lBracketRows.push([m.round_number, config?.round_name || getRoundName(m.round_number, losersMaxRound, 'losers'), config?.format?.replace(/_/g, ' ') || 'single', m.match_number, teamMap[m.team1_id]?.display_name || 'TBD', m.team1_score !== null ? Number(m.team1_score?.toFixed(2)) : '', m.series_wins_team1 || 0, teamMap[m.team2_id]?.display_name || 'TBD', m.team2_score !== null ? Number(m.team2_score?.toFixed(2)) : '', m.series_wins_team2 || 0, teamMap[m.winner_id]?.display_name || 'TBD', m.is_finalized ? 'Final' : 'Pending'])
      })
      const lBracketWs = XLSX.utils.aoa_to_sheet(lBracketRows)
      lBracketWs['!cols'] = [8, 16, 12, 8, 28, 10, 10, 28, 10, 10, 28, 10].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, lBracketWs, "Loser's Bracket")

      XLSX.writeFile(wb, `${event.name.replace(/[^a-z0-9]/gi, '_')}_Results.xlsx`)
      setMessage({ type: 'success', text: 'Export downloaded.' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setExporting(false)
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-meta">{event?.name} → Export</div>
        <h1>Export Results</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Downloads a complete Excel workbook with all standings, scores, and bracket results.</p>
      </div>
      <div className="page-content" style={{ maxWidth: 600 }}>
        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
        <div className="card">
          <div className="card-title">Included Sheets</div>
          {[['Standings','Final rankings with W/L/T records'],['Daily Scores','All finalized scores per team per day'],['H2H Results','Every head-to-head matchup outcome'],['League Avg Results',"Each team's daily result vs League Average"],["Winner's Bracket",'1st and 2nd place bracket'],["Loser's Bracket",'3rd place and beyond']].map(([sheet, desc]) => (
            <div key={sheet} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1rem' }}>
              <div style={{ minWidth: 160, fontWeight: 700, fontSize: '0.875rem' }}>{sheet}</div>
              <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)' }}>{desc}</div>
            </div>
          ))}
          <button className="btn btn-primary btn-lg" onClick={handleExport} disabled={exporting} style={{ marginTop: '1.5rem', width: '100%', justifyContent: 'center' }}>
            {exporting ? 'Generating...' : '⬇ Download Excel Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
