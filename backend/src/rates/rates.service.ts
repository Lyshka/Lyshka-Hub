import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Markup } from 'telegraf';
import { AppsService } from '../apps/apps.service';
import { BotService } from '../bot/bot.service';
import { formatYmd } from '../common/calendar';
import { PrismaService } from '../prisma/prisma.service';
import {
  fetchPriorbankCardRates,
  type CardQuote,
  type CardRates,
} from './rates.priorbank';
import { RATE_WATCH_KEYS, type RateWatchKey } from './rates.dto';
import { fetchVisaUsdToEur } from './rates.visa';

const TIME_ZONE = 'Europe/Minsk';
const COMMISSION_RATE = 0.01;

export const RATES_SEEN_PREFIX = 'rates:seen:';

const WATCH_META: Record<
  RateWatchKey,
  { currency: 'USD' | 'EUR'; side: 'buy' | 'sell'; title: string }
> = {
  usd_buy: { currency: 'USD', side: 'buy', title: 'USD покупка' },
  usd_sell: { currency: 'USD', side: 'sell', title: 'USD продажа' },
  eur_buy: { currency: 'EUR', side: 'buy', title: 'EUR покупка' },
  eur_sell: { currency: 'EUR', side: 'sell', title: 'EUR продажа' },
};

@Injectable()
export class RatesService {
  private cachedRates: CardRates | null = null;
  private cachedAt = 0;
  private readonly activeKeys = new Set<RateWatchKey>();
  private readonly lastAlertSentAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly botService: BotService,
    private readonly appsService: AppsService,
  ) {}

  async overview(userId: number) {
    const [rates, watches] = await Promise.all([
      this.getCardRates(),
      this.ensureWatches(userId),
    ]);

    return {
      rates: this.serializeRates(rates),
      watches: watches.map((watch) => this.serializeWatch(watch, rates)),
      commissionRate: COMMISSION_RATE,
    };
  }

  async updateWatch(
    userId: number,
    key: RateWatchKey,
    data: { enabled?: boolean; threshold?: number | null },
  ) {
    await this.ensureWatches(userId);

    const updated = await this.prisma.rateWatch.update({
      where: {
        userId_key: {
          userId: BigInt(userId),
          key,
        },
      },
      data: {
        ...(typeof data.enabled === 'boolean' ? { enabled: data.enabled } : {}),
        ...(data.threshold !== undefined
          ? { threshold: data.threshold }
          : {}),
      },
    });

    const rates = await this.getCardRates();
    return {
      rates: this.serializeRates(rates),
      watch: this.serializeWatch(updated, rates),
    };
  }

  async calculate(_userId: number, amountUsd: number) {
    const [visa, cardRates] = await Promise.all([
      fetchVisaUsdToEur(amountUsd),
      this.getCardRates(true),
    ]);

    if (!visa || !cardRates?.eur) {
      return {
        ok: false as const,
        error: 'Не удалось получить курсы для расчёта',
      };
    }

    const eurAmount = amountUsd * visa.rate;
    const eurBuy = cardRates.eur.buy;
    const bynAmount = eurAmount * eurBuy;
    const commission = bynAmount * COMMISSION_RATE;
    const total = bynAmount + commission;

    return {
      ok: true as const,
      amountUsd,
      visa: {
        rate: visa.rate,
        source: visa.source,
        asOf: visa.asOf ?? null,
      },
      eurAmount,
      priorbank: {
        eurBuy,
        date: cardRates.eur.date ?? null,
        time: cardRates.eur.time ?? null,
      },
      bynAmount,
      commissionRate: COMMISSION_RATE,
      commission,
      total,
    };
  }

  muteWatchForToday(userId: number, key: RateWatchKey) {
    const today = formatYmd(new Date(), TIME_ZONE);
    return this.prisma.rateWatch.updateMany({
      where: {
        userId: BigInt(userId),
        key,
      },
      data: { mutedOn: today },
    });
  }

  @Cron('0 * * * *', { timeZone: TIME_ZONE })
  async sendHourlyDigest() {
    const rates = await this.getCardRates(true);
    if (!rates?.usd && !rates?.eur) {
      return;
    }

    const text = this.buildDigestMessage(rates);
    const subscribers = await this.appsService.listSubscriberIds('rates');

    for (const chatId of subscribers) {
      try {
        await this.botService.sendMessage(chatId, text);
      } catch {
        //
      }
    }
  }

  @Cron('*/5 * * * *', { timeZone: TIME_ZONE })
  async checkThresholds() {
    const rates = await this.getCardRates(true);
    if (!rates) {
      return;
    }

    const watches = await this.prisma.rateWatch.findMany({
      where: {
        enabled: true,
        threshold: { not: null },
      },
    });

    const newlyTriggered: Array<{
      userId: number;
      key: RateWatchKey;
      threshold: number;
      value: number;
    }> = [];

    this.activeKeys.clear();

    for (const watch of watches) {
      if (!this.isWatchKey(watch.key) || watch.threshold == null) {
        continue;
      }
      const value = this.readWatchValue(watch.key, rates);
      if (value == null || value < watch.threshold) {
        continue;
      }

      this.activeKeys.add(watch.key);
      newlyTriggered.push({
        userId: Number(watch.userId),
        key: watch.key,
        threshold: watch.threshold,
        value,
      });
    }

    for (const item of newlyTriggered) {
      await this.sendWatchAlert(item, rates);
    }
  }

  @Cron('* * * * *', { timeZone: TIME_ZONE })
  async sendMinuteAlerts() {
    if (this.activeKeys.size === 0) {
      return;
    }

    const rates = await this.getCardRates(true);
    if (!rates) {
      return;
    }

    const keys = [...this.activeKeys];
    const watches = await this.prisma.rateWatch.findMany({
      where: {
        enabled: true,
        key: { in: keys },
        threshold: { not: null },
      },
    });

    this.activeKeys.clear();

    for (const watch of watches) {
      if (!this.isWatchKey(watch.key) || watch.threshold == null) {
        continue;
      }
      const value = this.readWatchValue(watch.key, rates);
      if (value == null || value < watch.threshold) {
        continue;
      }
      this.activeKeys.add(watch.key);
      await this.sendWatchAlert(
        {
          userId: Number(watch.userId),
          key: watch.key,
          threshold: watch.threshold,
          value,
        },
        rates,
      );
    }
  }

  private async sendWatchAlert(
    item: {
      userId: number;
      key: RateWatchKey;
      threshold: number;
      value: number;
    },
    rates: CardRates,
  ) {
    const today = formatYmd(new Date(), TIME_ZONE);
    const watch = await this.prisma.rateWatch.findUnique({
      where: {
        userId_key: {
          userId: BigInt(item.userId),
          key: item.key,
        },
      },
    });
    if (!watch || !watch.enabled || watch.mutedOn === today) {
      return;
    }

    const dedupeKey = `${item.userId}:${item.key}`;
    const now = Date.now();
    const last = this.lastAlertSentAt.get(dedupeKey) ?? 0;
    if (now - last < 50_000) {
      return;
    }

    const meta = WATCH_META[item.key];
    const quote = meta.currency === 'USD' ? rates.usd : rates.eur;
    const text = [
      `Приорбанк — ${meta.title} выше планки`,
      '',
      `Сейчас: ${this.formatRate(item.value)} BYN`,
      `Планка: ${this.formatRate(item.threshold)} BYN`,
      quote
        ? `Покупка: ${this.formatRate(quote.buy)} / Продажа: ${this.formatRate(quote.sell)}`
        : null,
      quote?.date
        ? `Обновлено: ${quote.date}${quote.time ? ` ${quote.time}` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const extra = Markup.inlineKeyboard([
      Markup.button.callback(
        'Увидел, хватит на сегодня',
        `${RATES_SEEN_PREFIX}${item.key}`,
      ),
    ]);

    this.lastAlertSentAt.set(dedupeKey, now);

    try {
      await this.botService.sendMessage(item.userId, text, extra);
    } catch {
      //
    }
  }

  private async ensureWatches(userId: number) {
    const uid = BigInt(userId);
    const existing = await this.prisma.rateWatch.findMany({
      where: { userId: uid },
    });
    const have = new Set(existing.map((item) => item.key));

    for (const key of RATE_WATCH_KEYS) {
      if (have.has(key)) {
        continue;
      }
      await this.prisma.rateWatch.create({
        data: {
          userId: uid,
          key,
          enabled: false,
          threshold: null,
        },
      });
    }

    return this.prisma.rateWatch.findMany({
      where: { userId: uid },
      orderBy: { key: 'asc' },
    });
  }

  private async getCardRates(force = false): Promise<CardRates | null> {
    if (!force && this.cachedRates && Date.now() - this.cachedAt < 60_000) {
      return this.cachedRates;
    }

    const rates = await fetchPriorbankCardRates();
    if (rates) {
      this.cachedRates = rates;
      this.cachedAt = Date.now();
    }
    return rates ?? this.cachedRates;
  }

  private buildDigestMessage(rates: CardRates): string {
    const lines = ['Приорбанк — курсы по карте'];

    if (rates.usd) {
      lines.push(
        '',
        'USD:',
        `Покупка: ${this.formatRate(rates.usd.buy)} BYN`,
        `Продажа: ${this.formatRate(rates.usd.sell)} BYN`,
      );
    }
    if (rates.eur) {
      lines.push(
        '',
        'EUR:',
        `Покупка: ${this.formatRate(rates.eur.buy)} BYN`,
        `Продажа: ${this.formatRate(rates.eur.sell)} BYN`,
      );
    }

    const stamp = rates.usd ?? rates.eur;
    if (stamp?.date) {
      lines.push(
        '',
        `Обновлено: ${stamp.date}${stamp.time ? ` ${stamp.time}` : ''}`,
      );
    }

    return lines.join('\n');
  }

  private serializeRates(rates: CardRates | null) {
    return {
      usd: rates?.usd ? this.serializeQuote(rates.usd) : null,
      eur: rates?.eur ? this.serializeQuote(rates.eur) : null,
    };
  }

  private serializeQuote(quote: CardQuote) {
    return {
      buy: quote.buy,
      sell: quote.sell,
      date: quote.date ?? null,
      time: quote.time ?? null,
    };
  }

  private serializeWatch(
    watch: {
      id: string;
      key: string;
      enabled: boolean;
      threshold: number | null;
      mutedOn: string | null;
    },
    rates: CardRates | null,
  ) {
    const key = this.isWatchKey(watch.key) ? watch.key : null;
    const meta = key ? WATCH_META[key] : null;
    const value =
      key && rates ? this.readWatchValue(key, rates) : null;
    const today = formatYmd(new Date(), TIME_ZONE);

    return {
      id: watch.id,
      key: watch.key,
      title: meta?.title ?? watch.key,
      currency: meta?.currency ?? null,
      side: meta?.side ?? null,
      enabled: watch.enabled,
      threshold: watch.threshold,
      value,
      mutedToday: watch.mutedOn === today,
    };
  }

  private readWatchValue(key: RateWatchKey, rates: CardRates): number | null {
    const meta = WATCH_META[key];
    const quote = meta.currency === 'USD' ? rates.usd : rates.eur;
    if (!quote) {
      return null;
    }
    return meta.side === 'buy' ? quote.buy : quote.sell;
  }

  private isWatchKey(value: string): value is RateWatchKey {
    return (RATE_WATCH_KEYS as readonly string[]).includes(value);
  }

  private formatRate(value: number): string {
    return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
}
