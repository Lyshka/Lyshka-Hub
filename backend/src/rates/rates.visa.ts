export type VisaUsdEur = {
  rate: number;
  source: 'visa' | 'fallback';
  asOf?: string;
};

function formatVisaDate(date = new Date()): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${month}/${day}/${year}`;
}

function parseConvertedAmount(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^\d.,]/g, '').replace(',', '.');
    const value = Number(cleaned);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

async function fetchVisaCms(amount: number): Promise<number | null> {
  const date = formatVisaDate();
  const params = new URLSearchParams({
    amount: String(amount),
    fee: '0',
    utcConvertedDate: date,
    exchangedate: date,
    fromCurr: 'USD',
    toCurr: 'EUR',
  });

  const response = await fetch(
    `https://usa.visa.com/cmsapi/fx/rates?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer:
          'https://usa.visa.com/support/consumer/travel-support/exchange-rate-calculator.html',
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    return null;
  }

  const data = (await response.json()) as Record<string, unknown>;
  const converted = parseConvertedAmount(data.convertedAmount);
  if (!converted) {
    return null;
  }

  return converted / amount;
}

async function fetchFallbackUsdEur(): Promise<VisaUsdEur | null> {
  try {
    const response = await fetch(
      'https://api.frankfurter.app/latest?from=USD&to=EUR',
    );
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as {
      date?: string;
      rates?: { EUR?: number };
    };
    const rate = data.rates?.EUR;
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      return null;
    }
    return {
      rate,
      source: 'fallback',
      asOf: data.date,
    };
  } catch {
    return null;
  }
}

export async function fetchVisaUsdToEur(
  amount = 1,
): Promise<VisaUsdEur | null> {
  const safeAmount = amount > 0 ? amount : 1;
  try {
    const visaRate = await fetchVisaCms(safeAmount);
    if (visaRate) {
      return {
        rate: visaRate,
        source: 'visa',
        asOf: formatVisaDate(),
      };
    }
  } catch {
    //
  }

  return fetchFallbackUsdEur();
}
