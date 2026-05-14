// src/lib/discord.js
// Fires Discord webhooks on day commit for all game types.
// All fires are independent — one failure doesn't block others.

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

export async function fireboardGameWebhooks({
  eventName,
  dayNumber,
  publicUrl,
  themeColor,
  overallWebhook,
  // playerWebhooks: [{ playerName, webhookUrl, todayScore, totalPosition, badges }]
  playerWebhooks = [],
  // allPlayers: [{ name, position, badges }] sorted by position desc
  allPlayers = [],
}) {
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
    await safePost(overallWebhook, payload);
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
    await safePost(pw.webhookUrl, payload);
  }
}

// ── ALL-PLAY TOURNAMENT ──────────────────────────────────────

export async function fireAllPlayWebhooks({
  eventName,
  dayNumber,
  publicUrl,
  themeColor,
  overallWebhook,
  // teamWebhooks: [{ teamName, webhookUrl, todayScore, wins, losses, ties, points, rank }]
  teamWebhooks = [],
  // allTeams: [{ name, points, wins, losses, ties, rank }] sorted by points desc
  allTeams = [],
}) {
  const color = hexToDecimal(themeColor);
  const label = todayLabel(dayNumber);
  const standingsText = allTeams
    .map((t, i) => `${i + 1}. **${t.name}** — ${t.points}pts (${t.wins}W-${t.losses}L-${t.ties ?? 0}T)`)
    .join('\n') || 'No data';

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
    await safePost(overallWebhook, payload);
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
            { name: '🏆 Full Standings', value: standingsText },
          ],
          footer: { text: 'Keep it up! 💪' },
          url: publicUrl,
        },
      ],
    };
    await safePost(tw.webhookUrl, payload);
  }
}

// ── HIGH SCORE ───────────────────────────────────────────────

export async function fireHighScoreWebhooks({
  eventName,
  dayNumber,
  publicUrl,
  themeColor,
  mode, // 'solo' | 'team'
  overallWebhook,
  // teamWebhooks: [{ teamName, webhookUrl, todayTeamScore, totalTeamScore, rank, members: [{name, todayScore, totalScore}] }]
  teamWebhooks = [],
  // allTeams: [{ name, totalScore, rank }] for team mode
  allTeams = [],
  // allPlayers: [{ name, teamName, totalScore, rank }] always
  allPlayers = [],
}) {
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
    await safePost(overallWebhook, payload);
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
            { name: '👤 Individual Standings', value: playerStandings },
          ],
          footer: { text: 'Keep grinding! 🔥' },
          url: publicUrl,
        },
      ],
    };
    await safePost(tw.webhookUrl, payload);
  }
}

// ── SHARED ───────────────────────────────────────────────────

async function safePost(url, payload) {
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`Discord webhook failed (${res.status}):`, url);
    }
  } catch (err) {
    console.warn('Discord webhook error:', err);
  }
}
