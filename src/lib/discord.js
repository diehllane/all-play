// src/lib/discord.js
// Builds Discord messages on day commit for All-Play, Board Game and High Score.
// Delivery is server-side via the send-discord edge function (see webhooks.js):
// the browser never sees a webhook URL. Targets are { scope, id } objects.
// A failed post never blocks a commit.

import { sendDiscord } from './webhooks';

const POKEMON_RED = 0xc62828;

function hexToDecimal(hex) {
  if (!hex) return POKEMON_RED;
  const clean = hex.replace('#', '');
  const val = parseInt(clean, 16);
  return isNaN(val) ? POKEMON_RED : val;
}

function todayLabel(dayNumber) {
  return `Day ${dayNumber}`;
}

function formatScore(n) {
  return Number(n || 0).toLocaleString();
}

// ── BOARD GAME ──────────────────────────────────────────────

export async function fireBoardGameWebhooks({
  eventId,
  eventName,
  dayNumber,
  publicUrl,
  themeColor,
  overallWebhook, // { scope: "overall" } or null
  // playerWebhooks: [{ playerName, webhookUrl: { scope: "player", id }, todayScore, totalPosition, badges }]
  playerWebhooks = [],
  // allPlayers: [{ name, position, badges }] sorted by position desc
  allPlayers = [],
}) {
  const posts = [];
  const color = hexToDecimal(themeColor);
  const label = todayLabel(dayNumber);
  const standingsText = allPlayers
    .map((p, i) => `${i + 1}. **${p.name}** — Square ${p.position} (${p.badges} badge${p.badges !== 1 ? 's' : ''})`)
    .join('\n') || 'No data';

  // Overall webhook
  if (overallWebhook) {
    const payload = {
      username: 'PokeNexus Board Game',
      embeds: [
        {
          title: `📋 ${eventName} — ${label} Committed`,
          color,
          fields: [
            {
              name: '🏆 Current Standings',
              value: standingsText,
            },
          ],
          footer: { text: 'Scores locked in. Good luck tomorrow!' },
          url: publicUrl,
        },
      ],
    };
    queuePost(posts, overallWebhook, payload);
  }

  // Per-player webhooks
  for (const pw of playerWebhooks) {
    if (!pw.webhookUrl) continue;
    const payload = {
      username: 'PokeNexus Board Game',
      embeds: [
        {
          title: `🎮 ${pw.playerName} — ${label} Results`,
          color,
          fields: [
            { name: "Today's Score", value: formatScore(pw.todayScore), inline: true },
            { name: 'Current Square', value: String(pw.totalPosition), inline: true },
            { name: 'Badges', value: String(pw.badges), inline: true },
            { name: '🏆 Full Standings', value: standingsText },
          ],
          footer: { text: 'Keep catching! 🎣' },
          url: publicUrl,
        },
      ],
    };
    queuePost(posts, pw.webhookUrl, payload);
  }
  await sendDiscord(eventId, posts);
}

// ── ALL-PLAY TOURNAMENT ──────────────────────────────────────

export async function fireAllPlayWebhooks({
  eventId,
  eventName,
  dayNumber,
  publicUrl,
  themeColor,
  overallWebhook, // { scope: "overall" } or null
  // teamWebhooks: [{ teamName, webhookUrl: { scope: "team", id }, todayScore, wins, losses, ties, points, rank }]
  teamWebhooks = [],
  // allTeams: [{ name, points, wins, losses, ties, rank }] sorted by points desc
  allTeams = [],
}) {
  const posts = [];
  const color = hexToDecimal(themeColor);
  const label = todayLabel(dayNumber);
  const teamStandingsText = allTeams
    .map((t, i) => `${i + 1}. **${t.name}** — ${t.points}pts (${t.wins}W-${t.losses}L-${t.ties ?? 0}T)`)
    .join('\n') || 'No data';
  // Keep standingsText as alias for overall webhook backwards compat
  const standingsText = teamStandingsText;

  if (overallWebhook) {
    const payload = {
      username: 'PokeNexus All-Play',
      embeds: [
        {
          title: `📋 ${eventName} — ${label} Committed`,
          color,
          fields: [{ name: '🏆 Current Standings', value: standingsText }],
          footer: { text: 'Day locked in!' },
          url: publicUrl,
        },
      ],
    };
    queuePost(posts, overallWebhook, payload);
  }

  for (const tw of teamWebhooks) {
    if (!tw.webhookUrl) continue;
    const payload = {
      username: 'PokeNexus All-Play',
      embeds: [
        {
          title: `🎮 ${tw.teamName} — ${label} Results`,
          color,
          fields: [
            { name: "Today's Score", value: formatScore(tw.todayScore), inline: true },
            { name: 'Record', value: `${tw.wins}W-${tw.losses}L-${tw.ties ?? 0}T`, inline: true },
            { name: 'Total Points', value: String(tw.points), inline: true },
            { name: 'Current Rank', value: `#${tw.rank}`, inline: true },
            { name: '🏆 Team Standings', value: teamStandingsText },
          ],
          footer: { text: 'Keep it up! 💪' },
          url: publicUrl,
        },
      ],
    };
    queuePost(posts, tw.webhookUrl, payload);
  }
  await sendDiscord(eventId, posts);
}

// ── HIGH SCORE ───────────────────────────────────────────────

export async function fireHighScoreWebhooks({
  eventId,
  eventName,
  dayNumber,
  publicUrl,
  themeColor,
  mode, // 'solo' | 'team'
  overallWebhook, // { scope: "overall" } or null
  // teamWebhooks: [{ teamName, webhookUrl: { scope: "team", id }, todayTeamScore, totalTeamScore, rank, members: [{name, todayScore, totalScore}] }]
  teamWebhooks = [],
  // allTeams: [{ name, totalScore, rank }] for team mode
  allTeams = [],
  // allPlayers: [{ name, teamName, totalScore, rank }] always
  allPlayers = [],
}) {
  const posts = [];
  const color = hexToDecimal(themeColor);
  const label = todayLabel(dayNumber);

  const playerStandings = allPlayers
    .map((p, i) => {
      const teamPart = p.teamName ? ` (${p.teamName})` : '';
      return `${i + 1}. **${p.name}**${teamPart} — ${formatScore(p.totalScore)} pts`;
    })
    .join('\n') || 'No data';

  const teamStandings = mode === 'team'
    ? allTeams.map((t, i) => `${i + 1}. **${t.name}** — ${formatScore(t.totalScore)} pts`).join('\n')
    : null;

  if (overallWebhook) {
    const fields = [];
    if (teamStandings) {
      fields.push({ name: '🏆 Team Standings', value: teamStandings });
    }
    fields.push({ name: '👤 Individual Standings', value: playerStandings });

    const payload = {
      username: 'PokeNexus High Score',
      embeds: [
        {
          title: `📋 ${eventName} — ${label} Committed`,
          color,
          fields,
          footer: { text: 'Scores locked in!' },
          url: publicUrl,
        },
      ],
    };
    queuePost(posts, overallWebhook, payload);
  }

  for (const tw of teamWebhooks) {
    if (!tw.webhookUrl) continue;
    const memberLines = (tw.members || [])
      .map(m => `• **${m.name}**: ${formatScore(m.todayScore)} today / ${formatScore(m.totalScore)} total`)
      .join('\n') || 'No members';

    const payload = {
      username: 'PokeNexus High Score',
      embeds: [
        {
          title: `🎮 ${tw.teamName} — ${label} Results`,
          color,
          fields: [
            { name: "Team Score Today", value: formatScore(tw.todayTeamScore), inline: true },
            { name: 'Team Total', value: formatScore(tw.totalTeamScore), inline: true },
            { name: 'Rank', value: `#${tw.rank}`, inline: true },
            { name: '👥 Member Breakdown', value: memberLines },
            { name: '🏆 Team Standings', value: teamStandings || 'No data' },
            { name: '👤 Individual Standings', value: playerStandings },
          ],
          footer: { text: 'Keep grinding! 🔥' },
          url: publicUrl,
        },
      ],
    };
    queuePost(posts, tw.webhookUrl, payload);
  }
  await sendDiscord(eventId, posts);
}

// ── SHARED ───────────────────────────────────────────────────

function queuePost(posts, target, payload) {
  // target: { scope: 'overall' } | { scope: 'team' | 'player', id }
  if (!target?.scope) return;
  posts.push({ target, payload });
}
