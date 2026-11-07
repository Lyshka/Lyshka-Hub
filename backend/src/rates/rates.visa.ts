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

function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/\s/g, '').replace(/,/g, '');
    const value = Number(cleaned);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function extractUsdToEurRate(data: Record<string, unknown>): number | null {
  if (
    data.conversionFromCurrency === 'USD' &&
    data.conversionToCurrency === 'EUR'
  ) {
    const reverse = parseAmount(data.reverseAmount);
    if (reverse) {
      return reverse;
    }
  }

  const original = data.originalValues as Record<string, unknown> | undefined;
  if (
    original &&
    original.fromCurrency === 'EUR' &&
    original.toCurrency === 'USD'
  ) {
    const fx = parseAmount(original.fxRateVisa);
    if (fx) {
      return 1 / fx;
    }
    const toAmount = parseAmount(original.toAmountWithVisaRate);
    const fromAmount = parseAmount(original.fromAmount) ?? 1;
    if (toAmount && fromAmount > 0) {
      return fromAmount / toAmount;
    }
  }

  if (
    data.conversionFromCurrency === 'EUR' &&
    data.conversionToCurrency === 'USD'
  ) {
    const converted = parseAmount(data.convertedAmount);
    const amount = parseAmount(data.conversionAmountValue) ?? 1;
    if (converted && amount > 0) {
      return amount / converted;
    }
  }

  return null;
}

function buildVisaUrl(amount: number, date: string): string {
  const params = new URLSearchParams({
    amount: String(amount),
    fee: '0',
    utcConvertedDate: date,
    exchangedate: date,
    fromCurr: 'USD',
    toCurr: 'EUR',
  });
  return `https://by.visa.com/cmsapi/fx/rates?${params.toString()}`;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      //
    }
  }

  const marker = text.indexOf('{"originalValues"');
  if (marker >= 0) {
    let depth = 0;
    for (let i = marker; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(marker, i + 1)) as Record<
              string,
              unknown
            >;
          } catch {
            return null;
          }
        }
      }
    }
  }

  return null;
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0',
        Referer:
          'https://by.visa.com/support/consumer/travel-support/exchange-rate-calculator.html',
      },
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    return extractJsonObject(text);
  } catch {
    return null;
  }
}

async function fetchViaJina(
  visaUrl: string,
): Promise<Record<string, unknown> | null> {
  const variants = [
    `https://r.jina.ai/${visaUrl}`,
    `https://r.jina.ai/http://${visaUrl.replace(/^https?:\/\//, '')}`,
  ];

  for (const proxyUrl of variants) {
    try {
      const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      });
      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      const parsed = extractJsonObject(text);
      if (parsed?.data && typeof parsed.data === 'object') {
        const content = (parsed.data as { content?: unknown }).content;
        if (typeof content === 'string') {
          const nested = extractJsonObject(content);
          if (nested?.status === 'success') {
            return nested;
          }
        }
      }

      if (parsed?.status === 'success') {
        return parsed;
      }
    } catch {
      //
    }
  }

  return null;
}

async function fetchVisaCms(amount: number): Promise<VisaUsdEur | null> {
  const date = formatVisaDate();
  const visaUrl = buildVisaUrl(Math.max(amount, 1), date);

  let data = await fetchJson(visaUrl);
  if (!data) {
    data = await fetchViaJina(visaUrl);
  }
  if (!data || data.status !== 'success') {
    return null;
  }

  const rate = extractUsdToEurRate(data);
  if (!rate) {
    return null;
  }

  return {
    rate,
    source: 'visa',
    asOf:
      typeof data.conversionInputDate === 'string'
        ? data.conversionInputDate
        : date,
  };
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
  try {
    const visa = await fetchVisaCms(amount);
    if (visa) {
      return visa;
    }
  } catch {
    //
  }

  return fetchFallbackUsdEur();
}
