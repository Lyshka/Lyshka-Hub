import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

type ParsedSteamInput = {
  steamId?: string;
  vanity?: string;
};

type ResolveResponse = {
  response?: {
    success?: number;
    steamid?: string;
    message?: string;
  };
};

type OwnedGamesResponse = {
  response?: {
    game_count?: number;
    games?: {
      appid: number;
      name?: string;
      img_icon_url?: string;
    }[];
  };
};

type OwnedGameInfo = {
  appId: string;
  name: string;
  imageUrl: string;
};

type WishlistEntry = {
  priority?: number;
  added?: number;
};

type WishlistApiResponse = {
  response?: {
    items?: {
      appid?: number;
      priority?: number;
      date_added?: number;
    }[];
  };
};

type AppDetailsResponse = {
  [appId: string]: {
    success?: boolean;
    data?: {
      name?: string;
      header_image?: string;
    };
  };
};

function headerImage(appId: string) {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
}

function parseSteamInput(input: string): ParsedSteamInput {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new BadRequestException('Укажи Steam профиль');
  }

  const profileMatch = trimmed.match(
    /steamcommunity\.com\/profiles\/(\d{17})/i,
  );
  if (profileMatch) {
    return { steamId: profileMatch[1] };
  }

  const idMatch = trimmed.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
  if (idMatch) {
    return { vanity: decodeURIComponent(idMatch[1]) };
  }

  if (/^\d{17}$/.test(trimmed)) {
    return { steamId: trimmed };
  }

  if (/^[a-zA-Z0-9_-]{2,32}$/.test(trimmed)) {
    return { vanity: trimmed };
  }

  throw new BadRequestException(
    'Некорректный Steam профиль. Вставь ссылку, Steam ID или ник.',
  );
}

async function resolveVanityUrl(
  vanity: string,
  apiKey: string,
): Promise<string> {
  const response = await fetch(
    `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}`,
  );
  if (!response.ok) {
    throw new ForbiddenException('Steam API недоступен');
  }
  const data = (await response.json()) as ResolveResponse;
  if (data.response?.success === 1 && data.response.steamid) {
    return data.response.steamid;
  }
  throw new BadRequestException('Steam профиль не найден');
}

async function resolveSteamId(input: string, apiKey: string): Promise<string> {
  const parsed = parseSteamInput(input);
  if (parsed.steamId) {
    return parsed.steamId;
  }
  if (!apiKey) {
    throw new ForbiddenException('Steam API ключ не настроен на сервере');
  }
  if (parsed.vanity) {
    return resolveVanityUrl(parsed.vanity, apiKey);
  }
  throw new BadRequestException('Не удалось определить Steam профиль');
}

async function fetchOwnedGames(
  steamId: string,
  apiKey: string,
): Promise<Map<string, OwnedGameInfo>> {
  if (!apiKey) {
    throw new ForbiddenException(
      'STEAM_API_KEY не задан на сервере — вкладка «Есть» не может загрузить библиотеку.',
    );
  }

  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
    include_appinfo: '1',
    include_played_free_games: '1',
    include_free_sub: '1',
    format: 'json',
  });

  const response = await fetch(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${params.toString()}`,
  );

  if (!response.ok) {
    throw new ForbiddenException(
      'Не удалось загрузить библиотеку Steam. Проверь STEAM_API_KEY.',
    );
  }

  const data = (await response.json()) as OwnedGamesResponse;
  const responseBody = data.response;
  const games = responseBody?.games;
  const gameCount = responseBody?.game_count;

  if (!responseBody || (games == null && gameCount == null)) {
    throw new ForbiddenException(
      'Библиотека скрыта. В Steam: Конфиденциальность → Список игр → Открытый.',
    );
  }

  if (!games || games.length === 0) {
    if (gameCount === 0) {
      throw new ForbiddenException(
        'Библиотека пуста или скрыта. Открой «Список игр» в конфиденциальности Steam.',
      );
    }
    throw new ForbiddenException(
      'Библиотека скрыта. В Steam: Конфиденциальность → Список игр → Открытый.',
    );
  }

  const owned = new Map<string, OwnedGameInfo>();
  for (const game of games) {
    if (!game.appid) {
      continue;
    }
    const appId = String(game.appid);
    owned.set(appId, {
      appId,
      name: game.name?.trim() || `Игра ${appId}`,
      imageUrl: headerImage(appId),
    });
  }
  return owned;
}

async function fetchWishlist(
  steamId: string,
): Promise<Map<string, WishlistEntry>> {
  const response = await fetch(
    `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${encodeURIComponent(steamId)}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; LyshkaHub/1.0)',
      },
    },
  );

  if (response.status === 403 || response.status === 401) {
    throw new ForbiddenException(
      'Wishlist скрыт. Сделай профиль и список желаемого публичными в Steam.',
    );
  }

  if (!response.ok) {
    throw new ForbiddenException('Не удалось загрузить wishlist из Steam');
  }

  const raw = await response.text();
  if (!raw.trim()) {
    return new Map();
  }

  let data: WishlistApiResponse;
  try {
    data = JSON.parse(raw) as WishlistApiResponse;
  } catch {
    throw new ForbiddenException(
      'Steam вернул некорректный ответ. Проверь, что профиль и wishlist публичные.',
    );
  }

  const items = data.response?.items ?? [];
  const map = new Map<string, WishlistEntry>();
  for (const item of items) {
    if (!item?.appid) {
      continue;
    }
    map.set(String(item.appid), {
      priority: item.priority ?? 0,
      added: item.date_added,
    });
  }
  return map;
}

async function fetchGameMeta(appId: string): Promise<{
  name: string;
  imageUrl: string;
}> {
  try {
    const response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=ru&l=russian`,
      {
        headers: { 'User-Agent': 'LyshkaHub/1.0' },
      },
    );
    if (!response.ok) {
      return { name: `Игра ${appId}`, imageUrl: headerImage(appId) };
    }
    const data = (await response.json()) as AppDetailsResponse;
    const item = data[appId];
    if (!item?.success || !item.data?.name) {
      return { name: `Игра ${appId}`, imageUrl: headerImage(appId) };
    }
    return {
      name: item.data.name,
      imageUrl: item.data.header_image || headerImage(appId),
    };
  } catch {
    return { name: `Игра ${appId}`, imageUrl: headerImage(appId) };
  }
}

async function fetchGamesMeta(appIds: string[]) {
  const result = new Map<string, { name: string; imageUrl: string }>();
  const chunkSize = 4;
  for (let i = 0; i < appIds.length; i += chunkSize) {
    const chunk = appIds.slice(i, i + chunkSize);
    const items = await Promise.all(
      chunk.map(async (appId) => {
        const meta = await fetchGameMeta(appId);
        return [appId, meta] as const;
      }),
    );
    for (const [appId, meta] of items) {
      result.set(appId, meta);
    }
  }
  return result;
}

async function fetchPlayerSummary(
  steamId: string,
  apiKey: string,
): Promise<{ personaName: string; avatarUrl: string; vanityLogin: string }> {
  if (!apiKey) {
    return { personaName: steamId, avatarUrl: '', vanityLogin: '' };
  }

  const response = await fetch(
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(steamId)}`,
  );
  if (!response.ok) {
    return { personaName: steamId, avatarUrl: '', vanityLogin: '' };
  }

  const data = (await response.json()) as {
    response?: {
      players?: {
        personaname?: string;
        avatarfull?: string;
        avatarmedium?: string;
        avatar?: string;
        profileurl?: string;
      }[];
    };
  };
  const player = data.response?.players?.[0];
  const profileUrl = player?.profileurl ?? '';
  const vanityMatch = profileUrl.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
  return {
    personaName: player?.personaname?.trim() || steamId,
    avatarUrl:
      player?.avatarfull ||
      player?.avatarmedium ||
      player?.avatar ||
      '',
    vanityLogin: vanityMatch ? decodeURIComponent(vanityMatch[1]) : '',
  };
}

type InventoryItemRaw = {
  assetId: string;
  classId: string;
  instanceId: string;
  name: string;
  marketHashName: string;
  iconUrl: string;
  amount: number;
  marketable: boolean;
  typeLabel: string;
  rarity: string;
  exterior: string;
};

type InventoryPage = {
  assets?: {
    assetid?: string;
    classid?: string;
    instanceid?: string;
    amount?: string;
  }[];
  descriptions?: {
    classid?: string;
    instanceid?: string;
    name?: string;
    market_name?: string;
    market_hash_name?: string;
    icon_url?: string;
    marketable?: number;
    tags?: {
      category?: string;
      internal_name?: string;
      localized_tag_name?: string;
    }[];
  }[];
  more_items?: number;
  last_assetid?: string;
  success?: number | boolean;
  total_inventory_count?: number;
};

function economyImage(iconPath: string) {
  if (!iconPath) {
    return '';
  }
  if (iconPath.startsWith('http')) {
    return iconPath;
  }
  return `https://community.cloudflare.steamstatic.com/economy/image/${iconPath}`;
}

function tagValue(
  tags: NonNullable<InventoryPage['descriptions']>[number]['tags'],
  category: string,
) {
  const tag = tags?.find((item) => item.category === category);
  return tag?.localized_tag_name?.trim() || '';
}

function itemMetaFromTags(
  tags: NonNullable<InventoryPage['descriptions']>[number]['tags'],
) {
  return {
    typeLabel: tagValue(tags, 'Type'),
    rarity: tagValue(tags, 'Rarity'),
    exterior: tagValue(tags, 'Exterior'),
  };
}

async function fetchCs2Inventory(steamId: string): Promise<{
  hidden: boolean;
  items: InventoryItemRaw[];
}> {
  const items: InventoryItemRaw[] = [];
  let startAssetId: string | undefined;
  let guard = 0;

  while (guard < 20) {
    guard += 1;
    const params = new URLSearchParams({
      l: 'russian',
      count: '2000',
    });
    if (startAssetId) {
      params.set('start_assetid', startAssetId);
    }

    const response = await fetch(
      `https://steamcommunity.com/inventory/${steamId}/730/2?${params.toString()}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; LyshkaHub/1.0)',
        },
      },
    );

    if (response.status === 403 || response.status === 401) {
      return { hidden: true, items: [] };
    }

    if (response.status === 404) {
      return { hidden: false, items: [] };
    }

    if (!response.ok) {
      throw new ForbiddenException('Не удалось загрузить инвентарь Steam');
    }

    const raw = await response.text();
    if (!raw.trim() || raw.trim() === 'null') {
      return { hidden: true, items: [] };
    }

    let page: InventoryPage;
    try {
      page = JSON.parse(raw) as InventoryPage;
    } catch {
      return { hidden: true, items: [] };
    }

    if (page.success === false || page.success === 0) {
      return { hidden: true, items: [] };
    }

    const descriptions = new Map<string, NonNullable<InventoryPage['descriptions']>[number]>();
    for (const desc of page.descriptions ?? []) {
      if (!desc.classid) {
        continue;
      }
      descriptions.set(`${desc.classid}_${desc.instanceid ?? '0'}`, desc);
    }

    for (const asset of page.assets ?? []) {
      if (!asset.assetid || !asset.classid) {
        continue;
      }
      const desc =
        descriptions.get(`${asset.classid}_${asset.instanceid ?? '0'}`) ??
        descriptions.get(`${asset.classid}_0`);
      const amount = Math.max(1, Number(asset.amount ?? '1') || 1);
      const meta = itemMetaFromTags(desc?.tags);
      items.push({
        assetId: asset.assetid,
        classId: asset.classid,
        instanceId: asset.instanceid ?? '0',
        name: desc?.name || desc?.market_name || `Предмет ${asset.classid}`,
        marketHashName: desc?.market_hash_name || '',
        iconUrl: economyImage(desc?.icon_url ?? ''),
        amount,
        marketable: Boolean(desc?.marketable),
        typeLabel: meta.typeLabel,
        rarity: meta.rarity,
        exterior: meta.exterior,
      });
    }

    if (!page.more_items || !page.last_assetid) {
      break;
    }
    startAssetId = page.last_assetid;
  }

  return { hidden: false, items };
}

let bulkPriceCache: { at: number; map: Map<string, number> } | null = null;

async function fetchBulkMarketPricesUsd(): Promise<Map<string, number>> {
  if (bulkPriceCache && Date.now() - bulkPriceCache.at < 6 * 60 * 60 * 1000) {
    return bulkPriceCache.map;
  }

  const response = await fetch('https://market.csgo.com/api/v2/prices/USD.json', {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; LyshkaHub/1.0)',
    },
  });

  if (!response.ok) {
    return bulkPriceCache?.map ?? new Map();
  }

  const data = (await response.json()) as {
    success?: boolean;
    items?: { market_hash_name?: string; price?: string | number }[];
  };

  if (!data.success || !Array.isArray(data.items)) {
    return bulkPriceCache?.map ?? new Map();
  }

  const map = new Map<string, number>();
  for (const item of data.items) {
    const name = item.market_hash_name?.trim();
    if (!name) {
      continue;
    }
    const value = Number(item.price);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    map.set(name, Math.round(value * 100) / 100);
  }

  bulkPriceCache = { at: Date.now(), map };
  return map;
}

async function fetchMarketPriceUsd(
  marketHashName: string,
): Promise<number | null> {
  if (!marketHashName) {
    return null;
  }

  const params = new URLSearchParams({
    appid: '730',
    currency: '1',
    market_hash_name: marketHashName,
  });

  const response = await fetch(
    `https://steamcommunity.com/market/priceoverview/?${params.toString()}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; LyshkaHub/1.0)',
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    success?: boolean;
    lowest_price?: string;
    median_price?: string;
  };

  if (!data.success) {
    return null;
  }

  const raw = data.lowest_price || data.median_price;
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/[^0-9.]/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export {
  parseSteamInput,
  resolveSteamId,
  fetchOwnedGames,
  fetchWishlist,
  fetchGamesMeta,
  fetchPlayerSummary,
  fetchCs2Inventory,
  fetchBulkMarketPricesUsd,
  fetchMarketPriceUsd,
  sleep,
  headerImage,
};
