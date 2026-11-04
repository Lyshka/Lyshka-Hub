const PRIORBANK_RATES_URL =
  'https://www.priorbank.by/offers/services/currency-branch?p_p_id=ExchangeRates_INSTANCE_Cz33CKs1AIC4&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_resource_id=ajaxMainPageRatesConverterGetRates&p_p_cacheability=cacheLevelPage';

const USD = 840;
const EUR = 978;
const BYN = 933;

type PriorRate = {
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

export type CardQuote = {
  buy: number;
  sell: number;
  date?: string;
  time?: string;
};

export type CardRates = {
  usd: CardQuote | null;
  eur: CardQuote | null;
};

function pickQuote(
  raw: string | undefined,
  baseCurrency: number,
): CardQuote | null {
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
    (item) => item.baseCurrency === baseCurrency && item.ratedCurrency === BYN,
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

export async function fetchPriorbankCardRates(): Promise<CardRates | null> {
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

    const data = (await response.json()) as Record<string, string>;
    return {
      usd: pickQuote(data.resultCard, USD),
      eur: pickQuote(data.resultCard, EUR),
    };
  } catch {
    return null;
  }
}
