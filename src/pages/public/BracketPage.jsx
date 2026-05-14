import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Navbar from '../../components/Navbar'
import { formatScore, getRoundName } from '../../lib/scoring'

function MatchupCard({ match, teams, maxRound, bracketType }) {
  const getTeam = (id) => teams.find(t => t.id === id)
  const team1 = getTeam(match.team1_id)
  const team2 = getTeam(match.team2_id)
  const isChampion = bracketType === 'winners' && match.round_number === maxRound && match.winner_id
  const isLosersChampion = bracketType === 'losers' && match.round_number === maxRound && match.winner_id

  return (
    <div className="card" style={{
      padding: '0.75rem',
      borderColor: isChampion ? 'var(--accent-gold)' : isLosersChampion ? 'var(--accent-purple)' : 'var(--border)',
      boxShadow: isChampion ? 'var(--shadow-glow)' : 'none',
      minWidth: '220px',
    }}>
      {isChampion && (
        <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-gold)', marginBottom: '0.5rem', textAlign: 'center' }}>
          🏆 Champion
        </div>
      )}
      {isLosersChampion && (
        <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-purple)', marginBottom: '0.5rem', textAlign: 'center' }}>
          🥉 3rd Place
        </div>
      )}

      {[{ team: team1, score: match.team1_score, wins: match.series_wins_team1, id: match.team1_id },
        { team: team2, score: match.team2_score, wins: match.series_wins_team2, id: match.team2_id }].map((side, i) => (
        <div key={i}>
          {i === 1 && <div style={{ height: '1px', background: 'var(--border)', margin: '0.25rem 0' }} />}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.4rem 0.5rem', borderRadius: 4,
            background: match.winner_id === side.id ? 'rgba(46,196,182,0.1)' : 'transparent',
          }}>
            <span style={{
              fontSize: '0.82rem', fontWeight: 600,
              color: match.winner_id === side.id ? 'var(--win)'
                : match.winner_id && match.winner_id !== side.id ? 'var(--text-muted)'
                : 'var(--text-primary)'
            }}>
              {side.team ? side.team.display_name : <span style={{ color: 'var(--text-muted)' }}>TBD</span>}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {side.wins > 0 && (
                <span style={{ fontSize: '0.7rem', color: 'var(--win)', fontFamily: 'var(--font-mono)' }}>{side.wins}W</span>
              )}
              {side.score !== null && side.score !== undefined && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem', fontWeight: 700 }}>
                  {formatScore(side.score)}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}

      {!match.is_finalized && (
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.5rem' }}>Pending</div>
      )}
    </div>
  )
}

export default function BracketPage() {
  const { slug } = useParams()
  const [event, setEvent] = useState(null)
  const [bracket, setBracket] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('winners')

  useEffect(() => { fetchAll() }, [slug])

  async function fetchAll() {
    const { data: ev } = await supabase.from('events').select('*').eq('slug', slug).single()
    if (!ev) { setLoading(false); return }
    setEvent(ev)

    const [{ data: bracketData }, { data: teamsData }] = await Promise.all([
      supabase.from('playoff_bracket').select('*').eq('event_id', ev.id).order('round_number').order('match_number'),
      supabase.from('teams').select('*').eq('event_id', ev.id)
    ])

    setBracket(bracketData || [])
    setTeams(teamsData || [])
    setLoading(false)
  }

  const winnersBracket = bracket.filter(m => m.bracket_type === 'winners' && !m.is_bye)
  const losersBracket = bracket.filter(m => m.bracket_type === 'losers' && !m.is_bye)

  const winnersMaxRound = winnersBracket.reduce((max, m) => Math.max(max, m.round_number), 0)
  const losersMaxRound = losersBracket.reduce((max, m) => Math.max(max, m.round_number), 0)

  if (loading) return <><Navbar /><div className="loading-screen"><div className="spinner" /></div></>
  if (!event) return <><Navbar /><div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div></>

  const renderBracket = (matches, maxRound, bracketType) => {
    if (matches.length === 0) return (
      <div className="empty-state">
        <div className="empty-state-icon">🏆</div>
        <h3>Bracket Not Yet Generated</h3>
        <p>The playoff bracket will be generated once the round robin is complete.</p>
      </div>
    )

    const rounds = Array.from({ length: maxRound }, (_, i) => i + 1)

    return (
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: '2rem', minWidth: 'fit-content', padding: '1rem 0' }}>
          {rounds.map(round => {
            const roundMatches = matches.filter(m => m.round_number === round)
            if (roundMatches.length === 0) return null
            return (
              <div key={round} style={{ display: 'flex', flexDirection: 'column', minWidth: '240px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: bracketType === 'winners' ? 'var(--accent-gold)' : 'var(--accent-purple)', marginBottom: '0.75rem' }}>
                  {getRoundName(round, maxRound, bracketType)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', justifyContent: 'space-around', flex: 1 }}>
                  {roundMatches.map(match => (
                    <MatchupCard key={match.id} match={match} teams={teams} maxRound={maxRound} bracketType={bracketType} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      <Navbar eventSlug={slug} eventName={event.name} />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">{event.name}</div>
          <h1>Playoff Bracket</h1>
          <div className="page-header-actions">
            <Link to={`/events/${slug}/standings`} className="btn btn-secondary btn-sm">Standings</Link>
            <Link to={`/events/${slug}/schedule`} className="btn btn-secondary btn-sm">Schedule</Link>
          </div>
        </div>

        <div className="page-content">
          <div className="tab-bar">
            <button className={`tab-btn ${activeTab === 'winners' ? 'active' : ''}`} onClick={() => setActiveTab('winners')}>
              Winner's Bracket <span style={{ marginLeft: '0.3rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>1st–2nd</span>
            </button>
            <button className={`tab-btn ${activeTab === 'losers' ? 'active' : ''}`} onClick={() => setActiveTab('losers')}>
              Loser's Bracket <span style={{ marginLeft: '0.3rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>3rd+</span>
            </button>
          </div>

          {activeTab === 'winners' && renderBracket(winnersBracket, winnersMaxRound, 'winners')}
          {activeTab === 'losers' && renderBracket(losersBracket, losersMaxRound, 'losers')}
        </div>
      </div>
    </>
  )
}
