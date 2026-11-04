import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BotService } from '../bot/bot.service';

const PRIORBANK_RATES_URL =
  'https://www.priorbank.by/offers/services/currency-branch?p_p_id=ExchangeRates_INSTANCE_Cz33CKs1AIC4&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_resource_id=ajaxMainPageRatesConverterGetRates&p_p_cacheability=cacheLevelPage';

const USD = 840;
const BYN = 933;

type PriorRate = {
  channelName?: string;
  validFromDate?: string;
  validFromTime?: string;
  baseCurrency: number;
  baseCurrencyNominal?: number;
  ratedCurrency: number;
  quantityFrom?: number;
  quantityTo?: number;
  sellRate: number;
  buyRate: number;
};

type PriorBundle = {
  code?: number;
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
  constructor(private readonly botService: BotService) {}

  @Cron('0 * * * *', { timeZone: 'Europe/Minsk' })
  async sendHourlyUsdRate() {
    const text = await this.buildUsdMessage();
    if (!text) {
      return;
    }

    for (const chatId of this.botService.getAdminIds()) {
      try {
        await this.botService.sendMessage(chatId, text);
      } catch {
        //
      }
    }
  }

  async buildUsdMessage(): Promise<string | null> {
    const rates = await this.fetchPriorbankRates();
    if (!rates) {
      return null;
    }

    const cash = this.pickUsd(rates.resultBranch);
    const card = this.pickUsd(rates.resultCard);
    const ebank = this.pickUsd(rates.resultEBank);

    if (!cash && !card && !ebank) {
      return null;
    }

    const lines = ['Приорбанк — курс USD'];

    if (cash) {
      lines.push('', 'Наличные:', this.formatQuote(cash));
    }
    if (card) {
      lines.push('', 'По карте:', this.formatQuote(card));
    }
    if (ebank) {
      lines.push('', 'Цифровой банк:', this.formatQuote(ebank));
    }

    const updated =
      cash?.date || card?.date || ebank?.date
        ? `${cash?.date || card?.date || ebank?.date}${
            cash?.time || card?.time || ebank?.time
              ? ` ${cash?.time || card?.time || ebank?.time}`
              : ''
          }`
        : null;

    if (updated) {
      lines.push('', `Обновлено: ${updated}`);
    }

    return lines.join('\n');
  }

  private formatQuote(quote: UsdQuote): string {
    return `Покупка: ${this.formatRate(quote.buy)} BYN\nПродажа: ${this.formatRate(quote.sell)} BYN`;
  }

  private formatRate(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
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

    const list = bundle.simpleCurrencyList ?? [];
    const matches = list.filter(
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
