type Cs2AccountStats = {
  steamLevel: number | null;
  cs2Hours: number | null;
  cs2PremierRating: number | null;
  cs2ProfileRank: number | null;
  cs2ProfileXp: number | null;
  cs2WingmanRank: number | null;
};

type Cs2PartialStats = Partial<Cs2AccountStats>;

const STEAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const STEAM_HEADERS = {
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': STEAM_UA,
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

function pickPositiveInt(...values: unknown[]) {
  for (const value of values) {
    const next = positiveInt(value);
    if (next != null && next > 0) {
      return next;
    }
  }
  return null;
}

function pickNumber(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function mergeStats(...sources: Cs2PartialStats[]): Cs2AccountStats {
  return {
    steamLevel: pickNumber(...sources.map((item) => item.steamLevel)) ?? null,
    cs2Hours: pickNumber(...sources.map((item) => item.cs2Hours)) ?? null,
    cs2PremierRating:
      pickPositiveInt(...sources.map((item) => item.cs2PremierRating)) ?? null,
    cs2ProfileRank:
      pickPositiveInt(...sources.map((item) => item.cs2ProfileRank)) ?? null,
    cs2ProfileXp:
      pickPositiveInt(...sources.map((item) => item.cs2ProfileXp)) ?? null,
    cs2WingmanRank:
      pickPositiveInt(...sources.map((item) => item.cs2WingmanRank)) ?? null,
  };
}

function profilePaths(steamId: string, vanityUrl?: string | null) {
  const paths = [`https://steamcommunity.com/profiles/${steamId}`];
  const vanity = vanityUrl?.trim();
  if (vanity) {
    paths.unshift(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}`);
  }
  return paths;
}

function parseLevelXp(text: string) {
  const match = text.match(
    /(?:Уровень|Level)\s*(\d+)\s*,\s*([\d\s.,]+)\s*(?:XP|оп\.?\s*опыта)/i,
  );
  if (!match) {
    return { cs2ProfileRank: null, cs2ProfileXp: null };
  }
  return {
    cs2ProfileRank: positiveInt(match[1]),
    cs2ProfileXp: positiveInt(match[2].replace(/[^\d]/g, '')),
  };
}

function parseSteamCs2Html(html: string) {
  const result: Cs2PartialStats = {};
  const metaMatch = html.match(
    /<meta[^>]+(?:name="Description"|property="og:description")[^>]+content="([^"]+)"/i,
  );
  if (metaMatch?.[1]) {
    Object.assign(result, parseLevelXp(metaMatch[1]));
  }

  const gamecardsMatch = html.match(
    /Counter-Strike 2[\s\S]{0,2500}?(?:Уровень|Level)\s*(\d+)\s*,\s*([\d\s.,]+)\s*(?:XP|оп\.?\s*опыта)/i,
  );
  if (gamecardsMatch) {
    result.cs2ProfileRank =
      positiveInt(gamecardsMatch[1]) ?? result.cs2ProfileRank ?? null;
    result.cs2ProfileXp =
      positiveInt(gamecardsMatch[2].replace(/[^\d]/g, '')) ??
      result.cs2ProfileXp ??
      null;
  }

  const badgeBlockMatch = html.match(
    /(?:badge_gamebadge_730|gamecards\/730|Counter-Strike 2)[\s\S]{0,4000}?(?:Уровень|Level)\s*(\d+)\s*,\s*([\d\s.,]+)\s*(?:XP|оп\.?\s*опыта)/i,
  );
  if (badgeBlockMatch) {
    result.cs2ProfileRank =
      positiveInt(badgeBlockMatch[1]) ?? result.cs2ProfileRank ?? null;
    result.cs2ProfileXp =
      positiveInt(badgeBlockMatch[2].replace(/[^\d]/g, '')) ??
      result.cs2ProfileXp ??
      null;
  }

  const profileBadgeMatch = html.match(
    /game_info_badge[\s\S]{0,1200}?<div class="xp">\s*([\d\s.,]+)\s*(?:XP|оп\.?\s*опыта)/i,
  );
  if (profileBadgeMatch && result.cs2ProfileXp == null) {
    result.cs2ProfileXp = positiveInt(
      profileBadgeMatch[1].replace(/[^\d]/g, ''),
    );
  }

  const playtimeMatch = html.match(
    /([\d\s.,]+)\s*(?:hrs on record|ч\.?\s*в\s*игре)/i,
  );
  if (playtimeMatch) {
    result.cs2Hours = roundHours(
      Number(playtimeMatch[1].replace(/[^\d.]/g, '')),
    );
  }

  return result;
}

async function fetchSteamHtml(url: string) {
  try {
    const response = await fetch(url, { headers: STEAM_HEADERS });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchSteamCs2ProfileStats(
  steamId: string,
  vanityUrl?: string | null,
) {
  const merged: Cs2PartialStats = {};
  const bases = profilePaths(steamId, vanityUrl);

  for (const base of bases) {
    const pages = [
      `${base}/gamecards/730/`,
      `${base}/`,
      `${base}/badges/`,
    ];
    for (const page of pages) {
      const html = await fetchSteamHtml(page);
      if (!html) {
        continue;
      }
      const parsed = parseSteamCs2Html(html);
      merged.cs2ProfileRank =
        pickPositiveInt(merged.cs2ProfileRank, parsed.cs2ProfileRank) ??
        parsed.cs2ProfileRank ??
        null;
      merged.cs2ProfileXp =
        pickPositiveInt(merged.cs2ProfileXp, parsed.cs2ProfileXp) ??
        parsed.cs2ProfileXp ??
        null;
      merged.cs2Hours = pickNumber(merged.cs2Hours, parsed.cs2Hours);
      if (merged.cs2ProfileRank != null && merged.cs2ProfileXp != null) {
        return merged;
      }
    }
  }

  return merged;
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

function gcProfileFromRawXp(rawXp: unknown, rawLevel?: unknown) {
  const xp = positiveInt(rawXp);
  const level = positiveInt(rawLevel);
  if (xp != null && xp > 327680000) {
    const delta = xp - 327680000;
    return {
      cs2ProfileRank: Math.floor(delta / 5000) + 1,
      cs2ProfileXp: delta % 5000,
    };
  }
  if (level != null && level > 0) {
    return {
      cs2ProfileRank: level,
      cs2ProfileXp: null,
    };
  }
  return { cs2ProfileRank: null, cs2ProfileXp: null };
}

function premierFromLeetifyMatches(
  matches: {
    rank?: number | null;
    rank_type?: number | null;
    finished_at?: string | null;
  }[],
) {
  const sorted = [...matches].sort((a, b) => {
    const aTime = a.finished_at ? Date.parse(a.finished_at) : 0;
    const bTime = b.finished_at ? Date.parse(b.finished_at) : 0;
    return bTime - aTime;
  });
  for (const match of sorted) {
    if (match.rank_type === 11 && (match.rank ?? 0) > 0) {
      return positiveInt(match.rank);
    }
  }
  return null;
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
      return {};
    }
    const data = (await response.json()) as {
      privacy_mode?: string;
      ranks?: {
        premier?: number | null;
        renown?: number | null;
        wingman?: number | null;
      };
      recent_matches?: {
        rank?: number | null;
        rank_type?: number | null;
        finished_at?: string | null;
      }[];
    };

    if (data.privacy_mode && data.privacy_mode !== 'public' && !data.ranks) {
      return {};
    }

    const premierFromMatches = premierFromLeetifyMatches(
      data.recent_matches ?? [],
    );

    return {
      cs2PremierRating:
        pickPositiveInt(data.ranks?.premier, premierFromMatches) ?? null,
      cs2ProfileRank: positiveInt(data.ranks?.renown),
      cs2WingmanRank: positiveInt(data.ranks?.wingman),
    } satisfies Cs2PartialStats;
  } catch {
    return {};
  }
}

function readNested(source: unknown, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function fetchCs2SpaceStats(steamId: string, apiKey: string) {
  if (!apiKey) {
    return {};
  }
  try {
    const response = await fetch(
      `https://cs2.space/api/profile/${encodeURIComponent(steamId)}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'LyshkaHub/1.0',
          'x-api-key': apiKey,
        },
      },
    );
    if (!response.ok) {
      return {};
    }
    const data = (await response.json()) as Record<string, unknown>;
    const gcXp = readNested(data, ['steam', 'cs2Stats', 'player_cur_xp']);
    const gcLevel = readNested(data, ['steam', 'cs2Stats', 'player_level']);
    const gcProfile = gcProfileFromRawXp(gcXp, gcLevel);

    return {
      steamLevel: positiveInt(readNested(data, ['steam', 'level'])),
      cs2PremierRating: pickPositiveInt(
        readNested(data, ['leetify', 'ranks', 'premier']),
        readNested(data, ['leetify', 'premier']),
        readNested(data, ['steam', 'premierRating']),
        readNested(data, ['steam', 'cs2', 'premier']),
        readNested(data, ['premier']),
      ),
      cs2ProfileRank: pickPositiveInt(
        gcProfile.cs2ProfileRank,
        readNested(data, ['leetify', 'ranks', 'renown']),
        readNested(data, ['steam', 'cs2Stats', 'player_level']),
      ),
      cs2ProfileXp: pickPositiveInt(
        gcProfile.cs2ProfileXp,
        readNested(data, ['steam', 'cs2Stats', 'player_cur_xp']),
      ),
      cs2WingmanRank: positiveInt(
        readNested(data, ['leetify', 'ranks', 'wingman']),
      ),
    } satisfies Cs2PartialStats;
  } catch {
    return {};
  }
}

async function fetchCs2AccountStats(
  steamId: string,
  apiKey: string,
  options?: {
    vanityUrl?: string | null;
    cs2SpaceApiKey?: string;
  },
): Promise<Cs2AccountStats> {
  const [steamLevel, playtimeHours, leetify, steamProfile, cs2Space] =
    await Promise.all([
      fetchSteamLevel(steamId, apiKey),
      fetchCs2PlaytimeHours(steamId, apiKey),
      fetchLeetifyCs2Stats(steamId),
      fetchSteamCs2ProfileStats(steamId, options?.vanityUrl),
      fetchCs2SpaceStats(steamId, options?.cs2SpaceApiKey ?? ''),
    ]);

  return mergeStats(
    cs2Space,
    leetify,
    steamProfile,
    {
      steamLevel,
      cs2Hours: playtimeHours,
    },
    {
      cs2Hours: steamProfile.cs2Hours,
    },
  );
}

export { fetchCs2AccountStats, type Cs2AccountStats };
