import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  fetchBulkMarketPricesUsd,
  fetchCs2Inventory,
  fetchGamesMeta,
  fetchMarketPriceUsd,
  fetchOwnedGames,
  fetchPlayerSummary,
  fetchWishlist,
  parseSteamInput,
  resolveSteamId,
  sleep,
} from './games.steam';

function serializeProfile(
  profile: {
    id: string;
    steamId: string;
    vanityUrl: string | null;
    personaName: string;
    avatarUrl: string;
    accountEmail?: string;
    accountLogin?: string;
    active: boolean;
    lastSyncAt: Date | null;
    lastInventorySyncAt?: Date | null;
    inventoryHidden?: boolean;
  },
  stats?: {
    total: number;
    owned: number;
    missing: number;
    inventoryValueUsd: number;
    inventoryCount: number;
  },
) {
  return {
    id: profile.id,
    steamId: profile.steamId,
    vanityUrl: profile.vanityUrl,
    personaName: profile.personaName || profile.steamId,
    avatarUrl: profile.avatarUrl,
    accountEmail: profile.accountEmail ?? '',
    accountLogin: profile.accountLogin ?? '',
    active: profile.active,
    profileUrl: profile.vanityUrl
      ? `https://steamcommunity.com/id/${profile.vanityUrl}`
      : `https://steamcommunity.com/profiles/${profile.steamId}`,
    lastSyncAt: profile.lastSyncAt?.toISOString() ?? null,
    lastInventorySyncAt: profile.lastInventorySyncAt?.toISOString() ?? null,
    inventoryHidden: Boolean(profile.inventoryHidden),
    stats: stats ?? {
      total: 0,
      owned: 0,
      missing: 0,
      inventoryValueUsd: 0,
      inventoryCount: 0,
    },
  };
}

function serializeGame(row: {
  id: string;
  appId: string;
  name: string;
  imageUrl: string;
  owned: boolean;
  priority: number;
  addedAt: Date | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    appId: row.appId,
    name: row.name,
    imageUrl: row.imageUrl,
    owned: row.owned,
    priority: row.priority,
    addedAt: row.addedAt?.toISOString() ?? null,
    storeUrl: `https://store.steampowered.com/app/${row.appId}`,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private steamApiKey() {
    return this.configService.get<string>('STEAM_API_KEY')?.trim() ?? '';
  }

  private normalizeAccountFields(data?: {
    accountEmail?: string;
    accountLogin?: string;
  }) {
    return {
      accountEmail: (data?.accountEmail ?? '').trim().slice(0, 200),
      accountLogin: (data?.accountLogin ?? '').trim().slice(0, 64),
    };
  }

  private async setActiveProfile(userId: number, profileId: string) {
    const uid = BigInt(userId);
    await this.prisma.steamProfile.updateMany({
      where: { userId: uid },
      data: { active: false },
    });
    await this.prisma.steamProfile.updateMany({
      where: { id: profileId, userId: uid },
      data: { active: true },
    });
  }

  async overview(userId: number) {
    try {
      const uid = BigInt(userId);
      const profiles = await this.prisma.steamProfile.findMany({
        where: { userId: uid },
        orderBy: { createdAt: 'asc' },
      });

      const active = profiles.find((p) => p.active) ?? profiles[0] ?? null;

      if (active && !active.active) {
        await this.setActiveProfile(userId, active.id);
        active.active = true;
      }

      const allGames = await this.prisma.steamWishlistGame.findMany({
        where: { userId: uid },
        select: { steamProfileId: true, owned: true },
      });

      const statsByProfile = new Map<
        string,
        {
          total: number;
          owned: number;
          missing: number;
          inventoryValueUsd: number;
          inventoryCount: number;
        }
      >();
      for (const profile of profiles) {
        statsByProfile.set(profile.id, {
          total: 0,
          owned: 0,
          missing: 0,
          inventoryValueUsd: 0,
          inventoryCount: 0,
        });
      }
      for (const game of allGames) {
        const stats = statsByProfile.get(game.steamProfileId);
        if (!stats) {
          continue;
        }
        stats.total += 1;
        if (game.owned) {
          stats.owned += 1;
        } else {
          stats.missing += 1;
        }
      }

      const inventoryRows = await this.prisma.steamInventoryItem.findMany({
        where: { steamProfileId: { in: profiles.map((p) => p.id) } },
        select: {
          steamProfileId: true,
          amount: true,
          priceUsd: true,
        },
      });
      for (const row of inventoryRows) {
        const stats = statsByProfile.get(row.steamProfileId);
        if (!stats) {
          continue;
        }
        stats.inventoryCount += row.amount;
        if (row.priceUsd != null) {
          stats.inventoryValueUsd += row.priceUsd * row.amount;
        }
      }
      for (const stats of statsByProfile.values()) {
        stats.inventoryValueUsd =
          Math.round(stats.inventoryValueUsd * 100) / 100;
      }

      const aggregate = {
        total: 0,
        owned: 0,
        missing: 0,
        inventoryValueUsd: 0,
        inventoryCount: 0,
      };
      for (const stats of statsByProfile.values()) {
        aggregate.total += stats.total;
        aggregate.owned += stats.owned;
        aggregate.missing += stats.missing;
        aggregate.inventoryValueUsd += stats.inventoryValueUsd;
        aggregate.inventoryCount += stats.inventoryCount;
      }
      aggregate.inventoryValueUsd =
        Math.round(aggregate.inventoryValueUsd * 100) / 100;

      const games = active
        ? await this.prisma.steamWishlistGame.findMany({
            where: { steamProfileId: active.id },
            orderBy: [{ owned: 'asc' }, { priority: 'asc' }, { name: 'asc' }],
          })
        : [];

      const owned = games.filter((g) => g.owned);
      const missing = games.filter((g) => !g.owned);

      return {
        steamConfigured: Boolean(this.steamApiKey()),
        profiles: profiles.map((profile) =>
          serializeProfile(profile, statsByProfile.get(profile.id)),
        ),
        profile: active
          ? serializeProfile(active, statsByProfile.get(active.id))
          : null,
        stats: aggregate,
        owned: owned.map(serializeGame),
        missing: missing.map(serializeGame),
      };
    } catch (err) {
      this.rethrowDbError(err);
    }
  }

  async linkProfile(
    userId: number,
    steamInput: string,
    meta?: { accountEmail?: string; accountLogin?: string },
  ) {
    try {
      const apiKey = this.steamApiKey();
      const parsed = parseSteamInput(steamInput);
      const steamId = await resolveSteamId(steamInput, apiKey);
      const vanityUrl = parsed.vanity ?? null;
      const summary = await fetchPlayerSummary(steamId, apiKey);
      const uid = BigInt(userId);
      const fields = this.normalizeAccountFields(meta);

      const existing = await this.prisma.steamProfile.findUnique({
        where: {
          userId_steamId: {
            userId: uid,
            steamId,
          },
        },
      });
      if (existing) {
        throw new BadRequestException('Этот Steam аккаунт уже добавлен');
      }

      const profile = await this.prisma.steamProfile.create({
        data: {
          userId: uid,
          steamId,
          vanityUrl: vanityUrl || summary.vanityLogin || null,
          personaName: summary.personaName,
          avatarUrl: summary.avatarUrl,
          accountEmail: fields.accountEmail,
          accountLogin: fields.accountLogin,
          active: false,
        },
      });

      await this.setActiveProfile(userId, profile.id);
      try {
        await this.syncProfile(userId, profile.id, true);
      } catch {
        try {
          await this.syncProfile(userId, profile.id, false);
        } catch {
          //
        }
      }
      return this.overview(userId);
    } catch (err) {
      this.rethrowDbError(err);
    }
  }

  async updateProfile(
    userId: number,
    profileId: string,
    meta?: { accountEmail?: string; accountLogin?: string },
  ) {
    try {
      const profile = await this.prisma.steamProfile.findFirst({
        where: { id: profileId, userId: BigInt(userId) },
      });
      if (!profile) {
        throw new NotFoundException('Аккаунт не найден');
      }
      const fields = this.normalizeAccountFields(meta);
      await this.prisma.steamProfile.update({
        where: { id: profileId },
        data: fields,
      });
      return this.overview(userId);
    } catch (err) {
      this.rethrowDbError(err);
    }
  }

  async syncAll(userId: number, isAdmin: boolean) {
    if (!isAdmin) {
      throw new ForbiddenException('Синхронизация доступна только админу');
    }

    try {
      const profiles = await this.prisma.steamProfile.findMany({
        where: { userId: BigInt(userId) },
        orderBy: { createdAt: 'asc' },
      });

      for (const profile of profiles) {
        try {
          await this.syncProfile(userId, profile.id, false);
        } catch {
          //
        }
      }

      return this.overview(userId);
    } catch (err) {
      this.rethrowDbError(err);
    }
  }

  async selectProfile(userId: number, profileId: string) {
    try {
      const profile = await this.prisma.steamProfile.findFirst({
        where: { id: profileId, userId: BigInt(userId) },
      });
      if (!profile) {
        throw new NotFoundException('Аккаунт не найден');
      }
      await this.setActiveProfile(userId, profileId);
      return this.overview(userId);
    } catch (err) {
      this.rethrowDbError(err);
    }
  }

  async deleteProfile(userId: number, profileId: string) {
    try {
      const uid = BigInt(userId);
      const profile = await this.prisma.steamProfile.findFirst({
        where: { id: profileId, userId: uid },
      });
      if (!profile) {
        throw new NotFoundException('Аккаунт не найден');
      }

      await this.prisma.steamProfile.delete({ where: { id: profileId } });

      if (profile.active) {
        const next = await this.prisma.steamProfile.findFirst({
          where: { userId: uid },
          orderBy: { createdAt: 'asc' },
        });
        if (next) {
          await this.setActiveProfile(userId, next.id);
        }
      }

      return this.overview(userId);
    } catch (err) {
      this.rethrowDbError(err);
    }
  }

  async syncProfile(
    userId: number,
    profileId: string,
    required = false,
  ) {
    const apiKey = this.steamApiKey();
    const profile = await this.prisma.steamProfile.findFirst({
      where: { id: profileId, userId: BigInt(userId) },
    });
    if (!profile) {
      throw new NotFoundException('Аккаунт не найден');
    }

    const summary = await fetchPlayerSummary(profile.steamId, apiKey);

    let wishlist: Awaited<ReturnType<typeof fetchWishlist>>;
    try {
      wishlist = await fetchWishlist(profile.steamId);
    } catch (err) {
      if (required) {
        throw err;
      }
      wishlist = new Map();
    }

    let ownedGames: Awaited<ReturnType<typeof fetchOwnedGames>>;
    try {
      ownedGames = await fetchOwnedGames(profile.steamId, apiKey);
    } catch {
      ownedGames = new Map();
    }

    const wishlistIds = [...wishlist.keys()];
    const ownedIds = [...ownedGames.keys()];
    const keepIds = [...new Set([...wishlistIds, ...ownedIds])];
    const missingIds = wishlistIds.filter((id) => !ownedGames.has(id));
    const meta = await fetchGamesMeta(missingIds);
    const now = new Date();
    const uid = BigInt(userId);

    for (const appId of missingIds) {
      const entry = wishlist.get(appId);
      const details = meta.get(appId);
      await this.prisma.steamWishlistGame.upsert({
        where: {
          steamProfileId_appId: {
            steamProfileId: profile.id,
            appId,
          },
        },
        create: {
          userId: uid,
          steamProfileId: profile.id,
          appId,
          name: details?.name ?? `Игра ${appId}`,
          imageUrl: details?.imageUrl ?? '',
          owned: false,
          priority: entry?.priority ?? 0,
          addedAt: entry?.added ? new Date(entry.added * 1000) : null,
          updatedAt: now,
        },
        update: {
          name: details?.name ?? `Игра ${appId}`,
          imageUrl: details?.imageUrl ?? '',
          owned: false,
          priority: entry?.priority ?? 0,
          addedAt: entry?.added ? new Date(entry.added * 1000) : null,
          updatedAt: now,
        },
      });
    }

    for (const [appId, game] of ownedGames) {
      await this.prisma.steamWishlistGame.upsert({
        where: {
          steamProfileId_appId: {
            steamProfileId: profile.id,
            appId,
          },
        },
        create: {
          userId: uid,
          steamProfileId: profile.id,
          appId,
          name: game.name,
          imageUrl: game.imageUrl,
          owned: true,
          priority: 0,
          addedAt: null,
          updatedAt: now,
        },
        update: {
          name: game.name,
          imageUrl: game.imageUrl,
          owned: true,
          priority: 0,
          updatedAt: now,
        },
      });
    }

    if (keepIds.length === 0) {
      await this.prisma.steamWishlistGame.deleteMany({
        where: { steamProfileId: profile.id },
      });
    } else {
      await this.prisma.steamWishlistGame.deleteMany({
        where: {
          steamProfileId: profile.id,
          appId: { notIn: keepIds },
        },
      });
    }

    await this.prisma.steamProfile.update({
      where: { id: profile.id },
      data: {
        lastSyncAt: now,
        personaName: summary.personaName,
        avatarUrl: summary.avatarUrl,
        ...(summary.vanityLogin
          ? {
              vanityUrl: profile.vanityUrl || summary.vanityLogin,
              accountLogin: profile.accountLogin || summary.vanityLogin,
            }
          : {}),
      },
    });

    try {
      await this.syncInventory(profile.id, profile.steamId);
    } catch {
      //
    }
  }

  async syncInventory(profileId: string, steamId: string) {
    const result = await fetchCs2Inventory(steamId);
    const now = new Date();

    if (result.hidden) {
      await this.prisma.steamInventoryItem.deleteMany({
        where: { steamProfileId: profileId },
      });
      await this.prisma.steamProfile.update({
        where: { id: profileId },
        data: {
          inventoryHidden: true,
          lastInventorySyncAt: now,
        },
      });
      return;
    }

    const names = [
      ...new Set(
        result.items
          .filter((item) => item.marketHashName)
          .map((item) => item.marketHashName),
      ),
    ];

    const priceMap = new Map<string, number | null>();
    const staleBefore = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const cached = await this.prisma.steamMarketPrice.findMany({
      where: { marketHashName: { in: names } },
    });
    for (const row of cached) {
      if (row.updatedAt >= staleBefore && row.priceUsd != null) {
        priceMap.set(row.marketHashName, row.priceUsd);
      }
    }

    const bulk = await fetchBulkMarketPricesUsd();
    for (const name of names) {
      if (priceMap.has(name)) {
        continue;
      }
      const bulkPrice = bulk.get(name);
      if (bulkPrice != null) {
        priceMap.set(name, bulkPrice);
        await this.prisma.steamMarketPrice.upsert({
          where: { marketHashName: name },
          create: {
            marketHashName: name,
            priceUsd: bulkPrice,
            updatedAt: now,
          },
          update: {
            priceUsd: bulkPrice,
            updatedAt: now,
          },
        });
      }
    }

    const missing = names.filter((name) => !priceMap.has(name));
    for (const name of missing.slice(0, 40)) {
      const price = await fetchMarketPriceUsd(name);
      priceMap.set(name, price);
      await this.prisma.steamMarketPrice.upsert({
        where: { marketHashName: name },
        create: {
          marketHashName: name,
          priceUsd: price,
          updatedAt: now,
        },
        update: {
          priceUsd: price,
          updatedAt: now,
        },
      });
      await sleep(250);
    }

    const keepAssetIds: string[] = [];
    for (const item of result.items) {
      keepAssetIds.push(item.assetId);
      const priceUsd = item.marketHashName
        ? (priceMap.get(item.marketHashName) ?? null)
        : null;

      await this.prisma.steamInventoryItem.upsert({
        where: {
          steamProfileId_assetId: {
            steamProfileId: profileId,
            assetId: item.assetId,
          },
        },
        create: {
          steamProfileId: profileId,
          assetId: item.assetId,
          classId: item.classId,
          instanceId: item.instanceId,
          name: item.name,
          marketHashName: item.marketHashName,
          iconUrl: item.iconUrl,
          amount: item.amount,
          marketable: item.marketable,
          typeLabel: item.typeLabel,
          rarity: item.rarity,
          exterior: item.exterior,
          priceUsd,
          updatedAt: now,
        },
        update: {
          classId: item.classId,
          instanceId: item.instanceId,
          name: item.name,
          marketHashName: item.marketHashName,
          iconUrl: item.iconUrl,
          amount: item.amount,
          marketable: item.marketable,
          typeLabel: item.typeLabel,
          rarity: item.rarity,
          exterior: item.exterior,
          priceUsd,
          updatedAt: now,
        },
      });
    }

    if (keepAssetIds.length === 0) {
      await this.prisma.steamInventoryItem.deleteMany({
        where: { steamProfileId: profileId },
      });
    } else {
      await this.prisma.steamInventoryItem.deleteMany({
        where: {
          steamProfileId: profileId,
          assetId: { notIn: keepAssetIds },
        },
      });
    }

    await this.prisma.steamProfile.update({
      where: { id: profileId },
      data: {
        inventoryHidden: false,
        lastInventorySyncAt: now,
      },
    });
  }

  async repriceMissingItems(profileId: string) {
    const rows = await this.prisma.steamInventoryItem.findMany({
      where: {
        steamProfileId: profileId,
        priceUsd: null,
        marketHashName: { not: '' },
      },
      select: { id: true, marketHashName: true },
    });
    if (rows.length === 0) {
      return;
    }

    const bulk = await fetchBulkMarketPricesUsd();
    const now = new Date();
    for (const row of rows) {
      const price = bulk.get(row.marketHashName);
      if (price == null) {
        continue;
      }
      await this.prisma.steamInventoryItem.update({
        where: { id: row.id },
        data: { priceUsd: price, updatedAt: now },
      });
      await this.prisma.steamMarketPrice.upsert({
        where: { marketHashName: row.marketHashName },
        create: {
          marketHashName: row.marketHashName,
          priceUsd: price,
          updatedAt: now,
        },
        update: {
          priceUsd: price,
          updatedAt: now,
        },
      });
    }
  }

  async getInventory(userId: number) {
    try {
      const uid = BigInt(userId);
      const profile = await this.prisma.steamProfile.findFirst({
        where: { userId: uid, active: true },
      });
      const active =
        profile ??
        (await this.prisma.steamProfile.findFirst({
          where: { userId: uid },
          orderBy: { createdAt: 'asc' },
        }));

      if (!active) {
        return {
          profile: null,
          hidden: false,
          totalValueUsd: 0,
          itemsCount: 0,
          items: [],
        };
      }

      const stale =
        !active.lastInventorySyncAt ||
        Date.now() - active.lastInventorySyncAt.getTime() >
          12 * 60 * 60 * 1000;

      const needsMeta =
        (await this.prisma.steamInventoryItem.count({
          where: {
            steamProfileId: active.id,
            marketHashName: { not: '' },
            typeLabel: '',
          },
        })) > 0;

      if (stale || needsMeta) {
        try {
          await this.syncInventory(active.id, active.steamId);
        } catch {
          //
        }
      }

      try {
        await this.repriceMissingItems(active.id);
      } catch {
        //
      }

      const fresh = await this.prisma.steamProfile.findUnique({
        where: { id: active.id },
      });
      const items = await this.prisma.steamInventoryItem.findMany({
        where: { steamProfileId: active.id },
      });

      items.sort((a, b) => {
        const aPrice = a.priceUsd;
        const bPrice = b.priceUsd;
        const aHas = aPrice != null;
        const bHas = bPrice != null;
        if (aHas !== bHas) {
          return aHas ? -1 : 1;
        }
        if (aHas && bHas) {
          const aTotal = aPrice * a.amount;
          const bTotal = bPrice * b.amount;
          if (bTotal !== aTotal) {
            return bTotal - aTotal;
          }
        }
        return a.name.localeCompare(b.name, 'ru');
      });

      let totalValueUsd = 0;
      for (const item of items) {
        if (item.priceUsd != null) {
          totalValueUsd += item.priceUsd * item.amount;
        }
      }
      totalValueUsd = Math.round(totalValueUsd * 100) / 100;
      const itemsCount = items.reduce((sum, i) => sum + i.amount, 0);

      return {
        profile: fresh
          ? serializeProfile(fresh, {
              total: 0,
              owned: 0,
              missing: 0,
              inventoryValueUsd: totalValueUsd,
              inventoryCount: itemsCount,
            })
          : null,
        hidden: Boolean(fresh?.inventoryHidden),
        totalValueUsd,
        itemsCount,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          marketHashName: item.marketHashName,
          iconUrl: item.iconUrl,
          amount: item.amount,
          marketable: item.marketable,
          typeLabel: item.typeLabel || 'Другое',
          rarity: item.rarity || '',
          exterior: item.exterior || '',
          priceUsd: item.priceUsd,
          totalUsd:
            item.priceUsd != null
              ? Math.round(item.priceUsd * item.amount * 100) / 100
              : null,
        })),
      };
    } catch (err) {
      this.rethrowDbError(err);
    }
  }

  @Cron('15 6 * * *', { timeZone: 'Europe/Moscow' })
  async dailySyncAll() {
    const profiles = await this.prisma.steamProfile.findMany({
      select: { id: true, userId: true },
    });
    for (const profile of profiles) {
      try {
        await this.syncProfile(Number(profile.userId), profile.id);
      } catch {
        continue;
      }
    }
  }

  private rethrowDbError(err: unknown): never {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: string }).message)
        : '';
    if (
      code === 'P2021' ||
      message.includes('SteamProfile') ||
      message.includes('SteamWishlistGame') ||
      message.includes('SteamInventoryItem')
    ) {
      throw new BadRequestException(
        'Таблицы игр не созданы. Перезапусти backend — миграция должна примениться автоматически.',
      );
    }
    throw err;
  }
}
