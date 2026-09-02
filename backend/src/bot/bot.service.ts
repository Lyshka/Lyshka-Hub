import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { readFileSync, existsSync } from 'fs';
import { Telegraf } from 'telegraf';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private cachedUrl: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly configService: ConfigService,
  ) {}

  private readUrlFromFile(): string | null {
    const filePath = this.configService.get<string>('WEBAPP_URL_FILE');
    if (!filePath || !existsSync(filePath)) {
      return null;
    }
    try {
      const value = readFileSync(filePath, 'utf8').trim();
      return value || null;
    } catch {
      return null;
    }
  }

  private resolveWebAppUrlRaw(): string | null {
    const filePath = this.configService.get<string>('WEBAPP_URL_FILE');
    if (filePath) {
      const fromFile = this.readUrlFromFile();
      if (fromFile) {
        return fromFile.replace(/\/$/, '');
      }
      return null;
    }

    const fromEnv = this.configService.get<string>('WEBAPP_URL')?.trim();
    if (!fromEnv) {
      return null;
    }
    return fromEnv.replace(/\/$/, '');
  }

  getWebAppUrl(appSlug?: string): string | null {
    const nextRaw = this.resolveWebAppUrlRaw();
    if (!nextRaw) {
      return null;
    }
    this.cachedUrl = nextRaw;
    return this.withParams(this.cachedUrl, appSlug);
  }

  private withParams(url: string, appSlug?: string): string {
    const version =
      this.configService.get<string>('WEBAPP_CACHE_BUST')?.trim() || '7';
    const base = url.split('?')[0].replace(/\/$/, '');
    const params = new URLSearchParams();
    params.set('v', version);
    if (appSlug?.trim()) {
      params.set('app', appSlug.trim().toLowerCase());
    }
    return `${base}/?${params.toString()}`;
  }

  private withCacheBust(url: string): string {
    return this.withParams(url);
  }

  getAdminIds(): number[] {
    const raw = this.configService.get<string>('ADMIN_IDS') ?? '';
    return raw
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isFinite(id) && id > 0);
  }

  isAdmin(userId: number): boolean {
    const admins = this.getAdminIds();
    return admins.length === 0 || admins.includes(userId);
  }

  async applyMenuButton(url?: string | null) {
    const target = url ?? this.getWebAppUrl();
    if (!target) {
      return;
    }
    try {
      await this.bot.telegram.setChatMenuButton({
        menuButton: {
          type: 'web_app',
          text: 'Lyshka Hub',
          web_app: { url: target },
        },
      });
    } catch {
      return;
    }
  }

  async onModuleInit() {
    await this.applyMenuButton();

    this.timer = setInterval(() => {
      void this.syncWebAppUrl();
    }, 15000);
  }

  private async syncWebAppUrl() {
    const previous = this.cachedUrl;
    const nextRaw = this.resolveWebAppUrlRaw();
    if (nextRaw === previous) {
      return;
    }
    this.cachedUrl = nextRaw;
    if (nextRaw) {
      await this.applyMenuButton();
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async getMe() {
    return this.bot.telegram.getMe();
  }

  async sendMessage(
    chatId: number,
    text: string,
    extra?: Parameters<Telegraf['telegram']['sendMessage']>[2],
  ) {
    return this.bot.telegram.sendMessage(chatId, text, extra);
  }

  async sendPhoto(
    chatId: number,
    photo: string,
    caption?: string,
    extra?: Parameters<Telegraf['telegram']['sendPhoto']>[2],
  ) {
    return this.bot.telegram.sendPhoto(chatId, photo, {
      caption,
      ...extra,
    });
  }

  async sendAnimation(
    chatId: number,
    animation: string,
    caption?: string,
    extra?: Parameters<Telegraf['telegram']['sendAnimation']>[2],
  ) {
    return this.bot.telegram.sendAnimation(chatId, animation, {
      caption,
      ...extra,
    });
  }

  async sendCatMedia(
    chatId: number,
    mediaUrl: string,
    caption?: string,
    extra?: Parameters<Telegraf['telegram']['sendPhoto']>[2],
  ) {
    const animated =
      /\.gif(\?|$)/i.test(mediaUrl) ||
      /cataas\.com\/cat\//i.test(mediaUrl) ||
      /mime_types=gif/i.test(mediaUrl) ||
      /\/gif(\?|$)/i.test(mediaUrl);

    if (animated) {
      try {
        return await this.sendAnimation(chatId, mediaUrl, caption, extra);
      } catch {
        //
      }
    }

    return this.sendPhoto(chatId, mediaUrl, caption, extra);
  }
}
