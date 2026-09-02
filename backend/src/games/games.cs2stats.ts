type Cs2AccountStats = {
  steamLevel: number | null;
  cs2Hours: number | null;
  cs2PremierRating: number | null;
  cs2ProfileRank: number | null;
  cs2ProfileXp: number | null;
  cs2WingmanRank: number | null;
};

function roundHours(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

function positiveInt(value: unknown) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return null;
  }
  return Math.round(num);
}

async function fetchSteamLevel(steamId: string, apiKey: string) {
  if (!apiKey) {
    return null;
  }
  try {
    const response = await fetch(
      `https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'LyshkaHub/1.0',
        },
      },
    );
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as {
      response?: { player_level?: number };
    };
    return positiveInt(data.response?.player_level);
  } catch {
    return null;
  }
}

async function fetchCs2PlaytimeHours(steamId: string, apiKey: string) {
  if (!apiKey) {
    return null;
  }
  try {
    const params = new URLSearchParams({
      key: apiKey,
      steamid: steamId,
      include_appinfo: '0',
      include_played_free_games: '1',
      'appids_filter[0]': '730',
      format: 'json',
    });
    const response = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${params.toString()}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'LyshkaHub/1.0',
        },
      },
    );
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as {
      response?: {
        games?: { appid?: number; playtime_forever?: number }[];
      };
    };
    const game = data.response?.games?.find((item) => item.appid === 730);
    if (!game) {
      return null;
    }
    return roundHours((game.playtime_forever ?? 0) / 60);
  } catch {
    return null;
  }
}

async function fetchLeetifyCs2Stats(steamId: string) {
  try {
    const response = await fetch(
      `https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=${encodeURIComponent(steamId)}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'LyshkaHub/1.0',
        },
      },
    );
    if (!response.ok) {
      return {
        cs2PremierRating: null,
        cs2ProfileRank: null,
        cs2WingmanRank: null,
      };
    }
    const data = (await response.json()) as {
      privacy_mode?: string;
      ranks?: {
        premier?: number | null;
        renown?: number | null;
        wingman?: number | null;
      };
    };
    if (data.privacy_mode && data.privacy_mode !== 'public' && !data.ranks) {
      return {
        cs2PremierRating: null,
        cs2ProfileRank: null,
        cs2WingmanRank: null,
      };
    }
    return {
      cs2PremierRating: positiveInt(data.ranks?.premier),
      cs2ProfileRank: positiveInt(data.ranks?.renown),
      cs2WingmanRank: positiveInt(data.ranks?.wingman),
    };
  } catch {
    return {
      cs2PremierRating: null,
      cs2ProfileRank: null,
      cs2WingmanRank: null,
    };
  }
}

async function fetchSteamCs2BadgeStats(steamId: string) {
  try {
    const response = await fetch(
      `https://steamcommunity.com/profiles/${steamId}/badges/`,
      {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; LyshkaHub/1.0)',
        },
      },
    );
    if (!response.ok) {
      return { cs2ProfileRank: null, cs2ProfileXp: null, cs2Hours: null };
    }
    const html = await response.text();
    const blockMatch = html.match(
      /id="badge_gamebadge_730_1_0"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/i,
    );
    const block = blockMatch?.[0] ?? html;
    const levelXpMatch = block.match(/Level\s+(\d+)\s*,\s*([\d,]+)\s*XP/i);
    const playtimeMatch = block.match(/([\d,]+)\s*hrs on record/i);
    return {
      cs2ProfileRank: levelXpMatch ? positiveInt(levelXpMatch[1]) : null,
      cs2ProfileXp: levelXpMatch
        ? positiveInt(levelXpMatch[2].replace(/,/g, ''))
        : null,
      cs2Hours: playtimeMatch
        ? roundHours(Number(playtimeMatch[1].replace(/,/g, '')))
        : null,
    };
  } catch {
    return { cs2ProfileRank: null, cs2ProfileXp: null, cs2Hours: null };
  }
}

async function fetchCs2AccountStats(
  steamId: string,
  apiKey: string,
): Promise<Cs2AccountStats> {
  const [steamLevel, playtimeHours, leetify, badge] = await Promise.all([
    fetchSteamLevel(steamId, apiKey),
    fetchCs2PlaytimeHours(steamId, apiKey),
    fetchLeetifyCs2Stats(steamId),
    fetchSteamCs2BadgeStats(steamId),
  ]);

  return {
    steamLevel,
    cs2Hours: playtimeHours ?? badge.cs2Hours,
    cs2PremierRating: leetify.cs2PremierRating,
    cs2ProfileRank: leetify.cs2ProfileRank ?? badge.cs2ProfileRank,
    cs2ProfileXp: badge.cs2ProfileXp,
    cs2WingmanRank: leetify.cs2WingmanRank,
  };
}

export { fetchCs2AccountStats, type Cs2AccountStats };
