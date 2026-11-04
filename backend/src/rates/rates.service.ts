import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Markup } from 'telegraf';
import { BotService } from '../bot/bot.service';
import { formatYmd } from '../common/calendar';

const PRIORBANK_RATES_URL =
  'https://www.priorbank.by/offers/services/currency-branch?p_p_id=ExchangeRates_INSTANCE_Cz33CKs1AIC4&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_resource_id=ajaxMainPageRatesConverterGetRates&p_p_cacheability=cacheLevelPage';

const USD = 840;
const BYN = 933;
const SELL_ALERT_THRESHOLD = 3.1;
const TIME_ZONE = 'Europe/Minsk';

export const RATES_USD_SEEN_CALLBACK = 'rates:usd:seen';

type PriorRate = {
  channelName?: string;
  validFromDate?: string;
  validFromTime?: string;
  baseCurrency: number;
  ratedCurrency: number;
  quantityFrom?: number;
  sellRate: number;
  buyRate: number;
};

type PriorBundle = {
  simpleCurrencyList?: PriorRate[];
};

type UsdQuote = {
  buy: number;
  sell: number;
  date?: string;
  time?: string;
};

@Injectable()
export class RatesService {
  private highSellActive = false;
  private lastAlertSentAt = 0;
  private readonly mutedUntilDay = new Map<number, string>();

  constructor(private readonly botService: BotService) {}

  @Cron('0 * * * *', { timeZone: TIME_ZONE })
  async sendHourlyUsdRate() {
    const quote = await this.fetchCardUsd();
    if (!quote) {
      return;
    }

    const text = this.buildCardMessage(quote);
    await this.broadcast(text);
  }

  @Cron('*/5 * * * *', { timeZone: TIME_ZONE })
  async checkSellThreshold() {
    const quote = await this.fetchCardUsd();
    if (!quote) {
      return;
    }

    const wasActive = this.highSellActive;
    this.highSellActive = quote.sell >= SELL_ALERT_THRESHOLD;
    if (!this.highSellActive) {
      return;
    }

    if (!wasActive) {
      await this.sendHighSellAlerts(quote);
    }
  }

  @Cron('* * * * *', { timeZone: TIME_ZONE })
  async sendMinuteHighSellAlerts() {
    if (!this.highSellActive) {
      return;
    }

    const quote = await this.fetchCardUsd();
    if (!quote) {
      return;
    }

    if (quote.sell < SELL_ALERT_THRESHOLD) {
      this.highSellActive = false;
      return;
    }

    await this.sendHighSellAlerts(quote);
  }

  muteAlertsForToday(userId: number) {
    this.mutedUntilDay.set(userId, formatYmd(new Date(), TIME_ZONE));
  }

  private isMutedToday(userId: number): boolean {
    return this.mutedUntilDay.get(userId) === formatYmd(new Date(), TIME_ZONE);
  }

  private async sendHighSellAlerts(quote: UsdQuote) {
    const now = Date.now();
    if (now - this.lastAlertSentAt < 50_000) {
      return;
    }

    const recipients = this.botService
      .getAdminIds()
      .filter((chatId) => !this.isMutedToday(chatId));
    if (recipients.length === 0) {
      return;
    }

    const text = [
      'Приорбанк — USD по карте выше порога',
      '',
      this.formatQuote(quote),
      '',
      `Порог: ${SELL_ALERT_THRESHOLD}`,
      quote.date
        ? `Обновлено: ${quote.date}${quote.time ? ` ${quote.time}` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const extra = Markup.inlineKeyboard([
      Markup.button.callback('Увидел, хватит на сегодня', RATES_USD_SEEN_CALLBACK),
    ]);

    this.lastAlertSentAt = now;

    for (const chatId of recipients) {
      try {
        await this.botService.sendMessage(chatId, text, extra);
      } catch {
        //
      }
    }
  }

  private async broadcast(text: string) {
    for (const chatId of this.botService.getAdminIds()) {
      try {
        await this.botService.sendMessage(chatId, text);
      } catch {
        //
      }
    }
  }

  private buildCardMessage(quote: UsdQuote): string {
    const lines = [
      'Приорбанк — курс USD по карте',
      '',
      this.formatQuote(quote),
    ];

    if (quote.date) {
      lines.push(
        '',
        `Обновлено: ${quote.date}${quote.time ? ` ${quote.time}` : ''}`,
      );
    }

    return lines.join('\n');
  }

  private formatQuote(quote: UsdQuote): string {
    return `Покупка: ${this.formatRate(quote.buy)} BYN\nПродажа: ${this.formatRate(quote.sell)} BYN`;
  }

  private formatRate(value: number): string {
    return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }

  private async fetchCardUsd(): Promise<UsdQuote | null> {
    const rates = await this.fetchPriorbankRates();
    if (!rates) {
      return null;
    }
    return this.pickUsd(rates.resultCard);
  }

  private pickUsd(raw: string | undefined): UsdQuote | null {
    if (!raw) {
      return null;
    }

    let bundle: PriorBundle;
    try {
      bundle = JSON.parse(raw) as PriorBundle;
    } catch {
      return null;
    }

    const matches = (bundle.simpleCurrencyList ?? []).filter(
      (item) => item.baseCurrency === USD && item.ratedCurrency === BYN,
    );
    if (matches.length === 0) {
      return null;
    }

    const preferred =
      matches.find((item) => (item.quantityFrom ?? 0) === 0) ?? matches[0];

    return {
      buy: preferred.buyRate,
      sell: preferred.sellRate,
      date: preferred.validFromDate,
      time: preferred.validFromTime,
    };
  }

  private async fetchPriorbankRates(): Promise<Record<string, string> | null> {
    try {
      const response = await fetch(PRIORBANK_RATES_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: 'https://www.priorbank.by/offers/services/currency-branch',
        },
      });

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as Record<string, string>;
    } catch {
      return null;
    }
  }
}
