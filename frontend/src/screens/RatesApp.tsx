import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type RatesCalcResult,
  type RatesOverview,
  type RatesWatch,
} from '../api/client';
import { Shell } from '../components/Shell';
import { useTelegram } from '../telegram/TelegramProvider';

type RatesAppProps = {
  onBack: () => void;
};

type Tab = 'rates' | 'calc' | 'alerts';

function formatRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function formatMoney(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(digits);
}

function sideLabel(side: string | null) {
  if (side === 'buy') {
    return 'Покупка';
  }
  if (side === 'sell') {
    return 'Продажа';
  }
  return side ?? '';
}

export function RatesApp({ onBack }: RatesAppProps) {
  const { initData, haptic } = useTelegram();
  const [tab, setTab] = useState<Tab>('rates');
  const [data, setData] = useState<RatesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draftThresholds, setDraftThresholds] = useState<Record<string, string>>(
    {},
  );
  const [amountUsd, setAmountUsd] = useState('1400');
  const [calc, setCalc] = useState<RatesCalcResult | null>(null);
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  const tabs = useMemo(
    () => [
      { id: 'rates' as const, label: 'Курсы' },
      { id: 'calc' as const, label: 'Калькулятор' },
      { id: 'alerts' as const, label: 'Планки' },
    ],
    [],
  );

  const load = useCallback(async () => {
    const overview = await api.ratesOverview(initData);
    setData(overview);
    setDraftThresholds((prev) => {
      const next = { ...prev };
      for (const watch of overview.watches) {
        if (next[watch.key] === undefined) {
          next[watch.key] =
            watch.threshold == null ? '' : String(watch.threshold);
        }
      }
      return next;
    });
    setError(null);
    return overview;
  }, [initData]);

  useEffect(() => {
    void load().catch((err: Error) => {
      setError(err.message);
    });
  }, [load]);

  async function toggleWatch(watch: RatesWatch) {
    setBusyKey(watch.key);
    haptic('light');
    try {
      const result = await api.ratesWatch(initData, {
        key: watch.key,
        enabled: !watch.enabled,
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              rates: result.rates,
              watches: prev.watches.map((item) =>
                item.key === result.watch.key ? result.watch : item,
              ),
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyKey(null);
    }
  }

  async function saveThreshold(watch: RatesWatch) {
    const raw = (draftThresholds[watch.key] ?? '').trim().replace(',', '.');
    const threshold = raw === '' ? null : Number(raw);
    if (raw !== '' && (!Number.isFinite(threshold) || (threshold ?? 0) < 0)) {
      setError('Некорректная планка');
      return;
    }

    setBusyKey(watch.key);
    haptic('medium');
    try {
      const result = await api.ratesWatch(initData, {
        key: watch.key,
        threshold,
        enabled: threshold == null ? false : true,
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              rates: result.rates,
              watches: prev.watches.map((item) =>
                item.key === result.watch.key ? result.watch : item,
              ),
            }
          : prev,
      );
      setDraftThresholds((prev) => ({
        ...prev,
        [watch.key]:
          result.watch.threshold == null
            ? ''
            : String(result.watch.threshold),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyKey(null);
    }
  }

  async function runCalc() {
    const amount = Number(amountUsd.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      setCalcError('Введи сумму в USD');
      return;
    }

    setCalcBusy(true);
    setCalcError(null);
    haptic('medium');
    try {
      const result = await api.ratesCalc(initData, amount);
      if (!result.ok) {
        setCalc(null);
        setCalcError(result.error);
        return;
      }
      setCalc(result);
    } catch (err) {
      setCalc(null);
      setCalcError(err instanceof Error ? err.message : 'Ошибка расчёта');
    } finally {
      setCalcBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      <header className="flex items-center gap-3 px-4 pt-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl px-3 py-2 text-sm font-medium"
          style={{ background: 'var(--app-surface)', color: 'var(--tg-text)' }}
        >
          Назад
        </button>
        <div>
          <h1 className="font-display text-xl font-semibold">Курсы</h1>
          <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>
            Приорбанк · по карте
          </p>
        </div>
      </header>

      <Shell tab={tab} onTabChange={setTab} tabs={tabs}>
        {error ? (
          <div
            className="mb-4 rounded-2xl px-4 py-3 text-sm"
            style={{ background: 'var(--app-surface)' }}
          >
            {error}
          </div>
        ) : null}

        {tab === 'rates' ? (
          <div className="flex flex-col gap-3">
            {(['usd', 'eur'] as const).map((currency) => {
              const quote = data?.rates[currency];
              return (
                <section
                  key={currency}
                  className="rounded-3xl px-4 py-4"
                  style={{ background: 'var(--app-surface)' }}
                >
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-lg font-semibold uppercase">
                      {currency}
                    </h2>
                    <span className="text-xs" style={{ color: 'var(--tg-hint)' }}>
                      {quote?.date
                        ? `${quote.date}${quote.time ? ` ${quote.time}` : ''}`
                        : 'нет данных'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div
                        className="text-xs uppercase tracking-wide"
                        style={{ color: 'var(--tg-hint)' }}
                      >
                        Покупка
                      </div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">
                        {formatRate(quote?.buy)}
                      </div>
                    </div>
                    <div>
                      <div
                        className="text-xs uppercase tracking-wide"
                        style={{ color: 'var(--tg-hint)' }}
                      >
                        Продажа
                      </div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">
                        {formatRate(quote?.sell)}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {tab === 'calc' ? (
          <div className="flex flex-col gap-3">
            <section
              className="rounded-3xl px-4 py-4"
              style={{ background: 'var(--app-surface)' }}
            >
              <label className="text-sm font-medium">Сумма вывода, USD</label>
              <input
                value={amountUsd}
                onChange={(event) => setAmountUsd(event.target.value)}
                inputMode="decimal"
                className="mt-2 w-full rounded-2xl border-0 px-4 py-3 text-lg outline-none"
                style={{
                  background: 'var(--app-bg)',
                  color: 'var(--tg-text)',
                }}
                placeholder="1400"
              />
              <button
                type="button"
                disabled={calcBusy}
                onClick={() => void runCalc()}
                className="mt-3 w-full rounded-2xl px-4 py-3 text-sm font-semibold"
                style={{
                  background: 'var(--tg-button)',
                  color: 'var(--tg-button-text)',
                  opacity: calcBusy ? 0.7 : 1,
                }}
              >
                {calcBusy ? 'Считаю…' : 'Рассчитать'}
              </button>
              <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--tg-hint)' }}>
                USD → EUR по курсу Visa, затем EUR → BYN по курсу Приорбанка по
                карте. Комиссия — {(data?.commissionRate ?? 0.01) * 100}% от
                суммы в BYN.
              </p>
            </section>

            {calcError ? (
              <div
                className="rounded-2xl px-4 py-3 text-sm"
                style={{ background: 'var(--app-surface)' }}
              >
                {calcError}
              </div>
            ) : null}

            {calc?.ok ? (
              <section
                className="rounded-3xl px-4 py-4"
                style={{ background: 'var(--app-surface)' }}
              >
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span style={{ color: 'var(--tg-hint)' }}>Visa USD→EUR</span>
                    <span className="tabular-nums">
                      {formatRate(calc.visa.rate)}
                      {calc.visa.source === 'fallback' ? ' · запасной' : ''}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span style={{ color: 'var(--tg-hint)' }}>Сумма EUR</span>
                    <span className="tabular-nums">
                      {formatMoney(calc.eurAmount, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span style={{ color: 'var(--tg-hint)' }}>
                      Приорбанк EUR продажа
                    </span>
                    <span className="tabular-nums">
                      {formatRate(calc.priorbank.eurSell)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span style={{ color: 'var(--tg-hint)' }}>Сумма BYN</span>
                    <span className="tabular-nums">
                      {formatMoney(calc.bynAmount, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span style={{ color: 'var(--tg-hint)' }}>
                      Комиссия ({(calc.commissionRate * 100).toFixed(1)}%)
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(calc.commission, 2)} BYN
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between gap-3 border-t pt-3 text-base font-semibold">
                    <span>Итого</span>
                    <span className="tabular-nums">
                      {formatMoney(calc.total, 2)} BYN
                    </span>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === 'alerts' ? (
          <div className="flex flex-col gap-3">
            <p className="px-1 text-sm" style={{ color: 'var(--tg-hint)' }}>
              Включи нужные курсы и задай планку. Когда значение станет равно
              или выше — бот начнёт писать каждую минуту.
            </p>
            {(data?.watches ?? []).map((watch) => (
              <section
                key={watch.key}
                className="rounded-3xl px-4 py-4"
                style={{ background: 'var(--app-surface)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {watch.currency} · {sideLabel(watch.side)}
                    </div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--tg-hint)' }}>
                      Сейчас: {formatRate(watch.value)} BYN
                      {watch.mutedToday ? ' · пауза до завтра' : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyKey === watch.key}
                    onClick={() => void toggleWatch(watch)}
                    className="rounded-xl px-3 py-2 text-xs font-semibold"
                    style={{
                      background: watch.enabled
                        ? 'var(--tg-button)'
                        : 'var(--app-bg)',
                      color: watch.enabled
                        ? 'var(--tg-button-text)'
                        : 'var(--tg-hint)',
                    }}
                  >
                    {watch.enabled ? 'Вкл' : 'Выкл'}
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={draftThresholds[watch.key] ?? ''}
                    onChange={(event) =>
                      setDraftThresholds((prev) => ({
                        ...prev,
                        [watch.key]: event.target.value,
                      }))
                    }
                    inputMode="decimal"
                    placeholder="Планка, например 3.4"
                    className="min-w-0 flex-1 rounded-2xl border-0 px-4 py-3 text-sm outline-none"
                    style={{
                      background: 'var(--app-bg)',
                      color: 'var(--tg-text)',
                    }}
                  />
                  <button
                    type="button"
                    disabled={busyKey === watch.key}
                    onClick={() => void saveThreshold(watch)}
                    className="rounded-2xl px-4 py-3 text-sm font-semibold"
                    style={{
                      background: 'var(--tg-button)',
                      color: 'var(--tg-button-text)',
                    }}
                  >
                    OK
                  </button>
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </Shell>
    </div>
  );
}
