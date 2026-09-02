import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import NodeCS2 = require('node-cs2');
import QRCode from 'qrcode';
import {
  EAuthTokenPlatformType,
  LoginSession,
} from 'steam-session';
import SteamUser = require('steam-user');
import { PrismaService } from '../prisma/prisma.service';

const CS2_XP_BASE = 327680000;
const CS2_XP_LEVEL_SIZE = 5000;

type GcRanking = {
  rank_id?: number | null;
  rank_type_id?: number | null;
};

type GcProfile = NodeCS2.PlayerProfile & {
  ranking?: GcRanking | null;
  rankings?: GcRanking[];
};

type PendingLoginState =
  | 'waiting'
  | 'scanned'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'failed';

type PendingLogin = {
  userId: bigint;
  profileId: string;
  session: LoginSession;
  qrDataUrl: string | null;
  expiresAt: Date;
  state: PendingLoginState;
  message: string | null;
  cleanupTimer: NodeJS.Timeout | null;
};

type GcStats = {
  cs2ProfileRank: number | null;
  cs2ProfileXp: number | null;
  cs2PremierRating: number | null;
  cs2WingmanRank: number | null;
};

function asPositiveInt(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.round(number);
}

function getRanking(profile: GcProfile, type: number) {
  const rankings = [
    ...(Array.isArray(profile.rankings) ? profile.rankings : []),
    ...(profile.ranking ? [profile.ranking] : []),
  ];
  return (
    rankings.find((ranking) => ranking.rank_type_id === type)?.rank_id ?? null
  );
}

function parseGcStats(profile: GcProfile): GcStats {
  const rawXp = asPositiveInt(profile.player_cur_xp);
  const progress =
    rawXp != null && rawXp >= CS2_XP_BASE
      ? (rawXp - CS2_XP_BASE) % CS2_XP_LEVEL_SIZE
      : null;

  return {
    cs2ProfileRank: asPositiveInt(profile.player_level),
    cs2ProfileXp: progress,
    cs2PremierRating: asPositiveInt(getRanking(profile, 11)),
    cs2WingmanRank: asPositiveInt(getRanking(profile, 7)),
  };
}

@Injectable()
export class SteamGcService implements OnModuleDestroy {
  private readonly pending = new Map<string, PendingLogin>();
  private readonly running = new Map<string, Promise<GcStats | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleDestroy() {
    for (const entry of this.pending.values()) {
      entry.session.cancelLoginAttempt();
      if (entry.cleanupTimer) {
        clearTimeout(entry.cleanupTimer);
      }
    }
    this.pending.clear();
  }

  private key(userId: bigint, profileId: string) {
    return `${userId.toString()}:${profileId}`;
  }

  private encryptionKey() {
    const configured = this.configService
      .get<string>('CS2_AUTH_ENCRYPTION_KEY')
      ?.trim();
    const fallback = this.configService.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
    const secret = configured || fallback;
    if (!secret) {
      throw new InternalServerErrorException(
        'На сервере не задан ключ защиты Steam-сессий',
      );
    }
    return createHash('sha256').update(secret).digest();
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  private decrypt(value: string) {
    const [version, ivValue, tagValue, encryptedValue] = value.split('.');
    if (
      version !== 'v1' ||
      !ivValue ||
      !tagValue ||
      !encryptedValue
    ) {
      throw new BadRequestException(
        'Steam-сессия повреждена. Подключи аккаунт заново',
      );
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey(),
        Buffer.from(ivValue, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new BadRequestException(
        'Steam-сессия устарела. Подключи аккаунт заново',
      );
    }
  }

  private async getProfile(userId: number, profileId: string) {
    const profile = await this.prisma.steamProfile.findFirst({
      where: { id: profileId, userId: BigInt(userId) },
    });
    if (!profile) {
      throw new NotFoundException('Аккаунт не найден');
    }
    return profile;
  }

  private clearLater(key: string, entry: PendingLogin) {
    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
    }
    entry.cleanupTimer = setTimeout(() => {
      if (this.pending.get(key) === entry) {
        this.pending.delete(key);
      }
    }, 5 * 60 * 1000);
  }

  private sessionResponse(entry: PendingLogin) {
    return {
      state: entry.state,
      qrDataUrl: entry.qrDataUrl,
      expiresAt: entry.expiresAt.toISOString(),
      message: entry.message,
    };
  }

  async startQrLogin(userId: number, profileId: string) {
    const profile = await this.getProfile(userId, profileId);
    if (profile.cs2AuthToken) {
      return {
        state: 'connected' as const,
        qrDataUrl: null,
        expiresAt: null,
        message: 'Steam уже подключён',
      };
    }

    const key = this.key(profile.userId, profileId);
    const existing = this.pending.get(key);
    if (
      existing &&
      existing.expiresAt.getTime() > Date.now() &&
      (existing.state === 'waiting' ||
        existing.state === 'scanned' ||
        existing.state === 'connecting')
    ) {
      return this.sessionResponse(existing);
    }

    if (existing) {
      existing.session.cancelLoginAttempt();
      if (existing.cleanupTimer) {
        clearTimeout(existing.cleanupTimer);
      }
      this.pending.delete(key);
    }

    const session = new LoginSession(EAuthTokenPlatformType.SteamClient, {
      machineId: true,
      machineFriendlyName: 'Lyshka Hub',
    });
    session.loginTimeout = 180000;
    const expiresAt = new Date(Date.now() + 180000);
    const entry: PendingLogin = {
      userId: profile.userId,
      profileId,
      session,
      qrDataUrl: null,
      expiresAt,
      state: 'waiting',
      message: 'Отсканируй QR-код приложением Steam',
      cleanupTimer: null,
    };

    session.on('remoteInteraction', () => {
      entry.state = 'scanned';
      entry.message = 'Подтверди вход в Steam Guard';
    });
    session.on('authenticated', () => {
      void this.completeQrLogin(key, entry);
    });
    session.on('timeout', () => {
      entry.state = 'expired';
      entry.qrDataUrl = null;
      entry.message = 'Время QR-кода истекло';
      this.clearLater(key, entry);
    });
    session.on('error', () => {
      entry.state = 'failed';
      entry.qrDataUrl = null;
      entry.message = 'Не удалось подтвердить вход в Steam';
      this.clearLater(key, entry);
    });

    this.pending.set(key, entry);
    try {
      const started = await session.startWithQR();
      if (!started.qrChallengeUrl) {
        throw new Error();
      }
      entry.qrDataUrl = await QRCode.toDataURL(started.qrChallengeUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 280,
      });
      return this.sessionResponse(entry);
    } catch {
      entry.state = 'failed';
      entry.qrDataUrl = null;
      entry.message = 'Не удалось создать QR-код Steam';
      this.clearLater(key, entry);
      return this.sessionResponse(entry);
    }
  }

  private async completeQrLogin(key: string, entry: PendingLogin) {
    if (this.pending.get(key) !== entry) {
      return;
    }
    entry.state = 'connecting';
    entry.qrDataUrl = null;
    entry.message = 'Подключаем аккаунт и запрашиваем CS2';

    try {
      const steamId = entry.session.steamID.getSteamID64();
      const refreshToken = entry.session.refreshToken;
      if (!steamId || !refreshToken) {
        throw new Error();
      }
      const profile = await this.prisma.steamProfile.findFirst({
        where: { id: entry.profileId, userId: entry.userId },
      });
      if (!profile || profile.steamId !== steamId) {
        throw new Error();
      }

      await this.prisma.steamProfile.update({
        where: { id: profile.id },
        data: {
          cs2AuthToken: this.encrypt(refreshToken),
          cs2AuthConnectedAt: new Date(),
          cs2AuthAccountName: entry.session.accountName || null,
        },
      });
      await this.syncProfile(profile.id);
      entry.state = 'connected';
      entry.message = 'Steam подключён';
    } catch {
      entry.state = 'failed';
      entry.message = 'Подтверждён другой аккаунт или Steam временно недоступен';
    }
    this.clearLater(key, entry);
  }

  async getQrLoginStatus(userId: number, profileId: string) {
    const profile = await this.getProfile(userId, profileId);
    const key = this.key(profile.userId, profileId);
    const entry = this.pending.get(key);
    if (entry) {
      return this.sessionResponse(entry);
    }
    if (profile.cs2AuthToken) {
      return {
        state: 'connected' as const,
        qrDataUrl: null,
        expiresAt: null,
        message: 'Steam подключён',
      };
    }
    return {
      state: 'idle' as const,
      qrDataUrl: null,
      expiresAt: null,
      message: null,
    };
  }

  async disconnect(userId: number, profileId: string) {
    const profile = await this.getProfile(userId, profileId);
    const key = this.key(profile.userId, profileId);
    const entry = this.pending.get(key);
    if (entry) {
      entry.session.cancelLoginAttempt();
      if (entry.cleanupTimer) {
        clearTimeout(entry.cleanupTimer);
      }
      this.pending.delete(key);
    }
    await this.prisma.steamProfile.update({
      where: { id: profileId },
      data: {
        cs2AuthToken: null,
        cs2AuthConnectedAt: null,
        cs2AuthAccountName: null,
      },
    });
    return {
      state: 'idle' as const,
      qrDataUrl: null,
      expiresAt: null,
      message: null,
    };
  }

  async syncProfile(profileId: string): Promise<GcStats | null> {
    const current = this.running.get(profileId);
    if (current) {
      return current;
    }

    const operation = this.syncProfileInternal(profileId);
    this.running.set(profileId, operation);
    try {
      return await operation;
    } finally {
      this.running.delete(profileId);
    }
  }

  private async syncProfileInternal(profileId: string) {
    const profile = await this.prisma.steamProfile.findUnique({
      where: { id: profileId },
      select: { steamId: true, cs2AuthToken: true },
    });
    if (!profile?.cs2AuthToken) {
      return null;
    }

    const gcProfile = await this.requestProfile(
      profile.steamId,
      this.decrypt(profile.cs2AuthToken),
    );
    const stats = parseGcStats(gcProfile);
    await this.prisma.steamProfile.update({
      where: { id: profileId },
      data: {
        cs2ProfileRank: stats.cs2ProfileRank,
        cs2ProfileXp: stats.cs2ProfileXp,
        cs2PremierRating: stats.cs2PremierRating,
        cs2WingmanRank: stats.cs2WingmanRank,
        cs2StatsSyncedAt: new Date(),
      },
    });
    return stats;
  }

  private requestProfile(steamId: string, refreshToken: string) {
    return new Promise<GcProfile>((resolve, reject) => {
      const steam = new SteamUser();
      const cs2 = new NodeCS2(steam);
      let completed = false;

      const close = () => {
        clearTimeout(timeout);
        try {
          steam.gamesPlayed([]);
        } catch {
          return;
        } finally {
          steam.logOff();
        }
      };
      const finish = (value: GcProfile) => {
        if (completed) {
          return;
        }
        completed = true;
        close();
        resolve(value);
      };
      const fail = () => {
        if (completed) {
          return;
        }
        completed = true;
        close();
        reject(new Error('CS2 Game Coordinator is unavailable'));
      };
      const timeout = setTimeout(fail, 45000);

      steam.once('error', fail);
      cs2.once('error', fail);
      steam.once('loggedOn', () => {
        steam.gamesPlayed([730]);
      });
      cs2.once('connectedToGC', () => {
        void cs2.requestPlayersProfile(steamId).then(finish).catch(fail);
      });

      try {
        steam.logOn({
          refreshToken,
          machineName: 'Lyshka Hub',
        });
      } catch {
        fail();
      }
    });
  }
}
