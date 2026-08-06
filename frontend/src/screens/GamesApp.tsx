import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type GamesOverview,
  type InventoryItem,
  type InventoryOverview,
  type SteamGame,
  type SteamProfile,
} from '../api/client';
import { Shell } from '../components/Shell';
import { useTelegram } from '../telegram/TelegramProvider';

type GamesAppProps = {
  onBack: () => void;
};

type Tab = 'accounts' | 'games' | 'skins';
type GamesSubTab = 'owned' | 'missing';

const gamesTabs = [
  { id: 'accounts' as const, label: 'Аккаунты' },
  { id: 'games' as const, label: 'Игры' },
  { id: 'skins' as const, label: 'Скины' },
];

function formatSync(value: string | null | undefined) {
  if (!value) {
    return 'ещё не синхронизировали';
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatUsd(value: number | null | undefined) {
  if (value == null) {
    return '—';
  }
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function AccountFields({
  email,
  login,
  onEmailChange,
  onLoginChange,
}: {
  email: string;
  login: string;
  onEmailChange: (value: string) => void;
  onLoginChange: (value: string) => void;
}) {
  return (
    <>
      <input
        value={login}
        onChange={(e) => onLoginChange(e.target.value)}
        placeholder="Логин Steam (необязательно)"
        className="w-full rounded-xl border-0 px-3 py-2.5 outline-none"
        style={{ background: 'var(--app-surface)', color: 'var(--tg-text)' }}
      />
      <input
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        placeholder="Почта аккаунта (необязательно)"
        type="email"
        autoComplete="email"
        className="w-full rounded-xl border-0 px-3 py-2.5 outline-none"
        style={{ background: 'var(--app-surface)', color: 'var(--tg-text)' }}
      />
      <p className="text-xs leading-relaxed" style={{ color: 'var(--tg-hint)' }}>
        Необязательно — для своих заметок.
      </p>
    </>
  );
}

export function GamesApp({ onBack }: GamesAppProps) {
  const { initData, haptic, isAdmin } = useTelegram();
  const [data, setData] = useState<GamesOverview | null>(null);
  const [inventory, setInventory] = useState<InventoryOverview | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('accounts');
  const [gamesSubTab, setGamesSubTab] = useState<GamesSubTab>('owned');
  const [steamInput, setSteamInput] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountLogin, setAccountLogin] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const overview = await api.gamesOverview(initData);
    setData(overview);
    setAdding(overview.profiles.length === 0);
    return overview;
  }, [initData]);

  const loadInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const next = await api.gamesInventory(initData);
      setInventory(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка инвентаря');
    } finally {
      setInventoryLoading(false);
    }
  }, [initData]);

  useEffect(() => {
    let alive = true;
    load().catch((err: Error) => {
      if (alive) {
        setError(err.message);
      }
    });
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(() => {
    if (tab !== 'skins') {
      return;
    }
    void loadInventory();
  }, [tab, loadInventory, data?.profile?.id]);

  async function linkSteam() {
    if (!steamInput.trim()) {
      setStatus('Вставь ссылку или ник Steam');
      return;
    }
    setBusy(true);
    setStatus('Добавляем аккаунт и синхронизируем…');
    haptic('medium');
    try {
      const overview = await api.gamesLink(initData, steamInput.trim(), {
        accountEmail: accountEmail.trim() || undefined,
        accountLogin: accountLogin.trim() || undefined,
      });
      setData(overview);
      setInventory(null);
      setSteamInput('');
      setAccountEmail('');
      setAccountLogin('');
      setAdding(false);
      setStatus(
        `Синхронизировано: есть ${overview.stats.owned}, нет ${overview.stats.missing}`,
      );
    } catch (err) {
      try {
        const overview = await api.gamesOverview(initData);
        setData(overview);
        setAdding(overview.profiles.length === 0);
        if (overview.profiles.length > 0) {
          setSteamInput('');
        }
      } catch {
        //
      }
      setStatus(err instanceof Error ? err.message : 'Ошибка привязки');
    } finally {
      setBusy(false);
    }
  }

  async function updateAccount(
    profileId: string,
    meta: { accountEmail?: string; accountLogin?: string },
  ) {
    setBusy(true);
    setStatus(null);
    haptic('light');
    try {
      const overview = await api.gamesUpdateProfile(initData, {
        profileId,
        ...meta,
      });
      setData(overview);
      setStatus('Данные аккаунта сохранены');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  }

  async function selectAccount(profileId: string) {
    setBusy(true);
    setStatus(null);
    haptic('light');
    try {
      const overview = await api.gamesSelect(initData, profileId);
      setData(overview);
      setInventory(null);
      if (tab === 'skins') {
        void loadInventory();
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Ошибка выбора');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(profileId: string) {
    setBusy(true);
    setStatus(null);
    haptic('heavy');
    try {
      const overview = await api.gamesDelete(initData, profileId);
      setData(overview);
      setInventory(null);
      setAdding(overview.profiles.length === 0);
      setStatus('Аккаунт удалён');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setBusy(false);
    }
  }

  async function syncAll() {
    setBusy(true);
    setStatus('Синхронизируем аккаунты, игры и скины…');
    haptic('medium');
    try {
      const overview = await api.gamesSync(initData);
      setData(overview);
      setInventory(null);
      if (tab === 'skins') {
        await loadInventory();
      }
      setStatus(
        `Готово: игр ${overview.stats.owned}/${overview.stats.total}, скинов ${overview.stats.inventoryCount}`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Ошибка синхронизации');
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-md px-4 pt-5">
        <button type="button" onClick={onBack} className="mb-4 text-sm">
          ← Назад
        </button>
        <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>
          {error}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className="flex min-h-[50dvh] items-center justify-center text-sm"
        style={{ color: 'var(--tg-hint)' }}
      >
        Загрузка...
      </div>
    );
  }

  const list = gamesSubTab === 'owned' ? data.owned : data.missing;
  const hasAccounts = data.profiles.length > 0;

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="px-4 pt-5">
        <button
          type="button"
          onClick={() => {
            haptic('light');
            onBack();
          }}
          className="rounded-2xl px-3 py-2 text-sm font-medium"
          style={{
            background: 'color-mix(in srgb, var(--app-surface-muted) 50%, #66c0f4)',
          }}
        >
          ← Назад
        </button>

        <div className="mt-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Игры
          </h1>
          <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>
            Steam аккаунты, библиотека и скины CS2
          </p>
        </div>
      </div>

      <Shell tab={tab} onTabChange={setTab} tabs={gamesTabs}>
        {tab === 'accounts' ? (
          <div className="space-y-4">
            {!data.steamConfigured ? (
              <section
                className="rounded-3xl px-5 py-4 text-sm"
                style={{
                  background:
                    'color-mix(in srgb, var(--app-danger) 12%, var(--tg-secondary))',
                  color: 'var(--app-danger)',
                }}
              >
                На сервере не задан STEAM_API_KEY. Админ должен добавить ключ в
                .env и перезапустить backend.
              </section>
            ) : null}

            {hasAccounts ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label="Всего" value={data.stats.total} />
                  <StatCard
                    label="Есть"
                    value={data.stats.owned}
                    accent="#16a34a"
                  />
                  <StatCard
                    label="Нет"
                    value={data.stats.missing}
                    accent="#dc2626"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <StatCard
                    label="Скины"
                    value={data.stats.inventoryCount}
                    accent="#2a475e"
                  />
                  <StatCard
                    label="Инвентарь"
                    value={formatUsd(data.stats.inventoryValueUsd)}
                    accent="#1b2838"
                  />
                </div>

                {isAdmin ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void syncAll()}
                    className="w-full rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-50"
                    style={{
                      background: 'linear-gradient(145deg, #1b2838, #2a475e)',
                      color: '#c7d5e0',
                    }}
                  >
                    Синхронизировать всё
                  </button>
                ) : null}

                <section className="space-y-2">
                  <p className="px-1 text-sm font-medium">Аккаунты Steam</p>
                  {data.profiles.map((profile) => (
                    <AccountCard
                      key={profile.id}
                      profile={profile}
                      busy={busy}
                      onSelect={() => void selectAccount(profile.id)}
                      onDelete={() => void deleteAccount(profile.id)}
                      onUpdate={(meta) => void updateAccount(profile.id, meta)}
                    />
                  ))}
                </section>

                {!adding ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAdding(true);
                      setStatus(null);
                    }}
                    className="w-full rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-50"
                    style={{
                      background:
                        'color-mix(in srgb, var(--tg-hint) 14%, transparent)',
                    }}
                  >
                    Добавить аккаунт
                  </button>
                ) : null}
              </>
            ) : null}

            {adding || !hasAccounts ? (
              <section
                className="space-y-3 rounded-3xl px-5 py-4"
                style={{
                  background: 'color-mix(in srgb, var(--app-surface-muted) 70%, #1b2838)',
                }}
              >
                <p className="text-sm font-medium">
                  {hasAccounts ? 'Новый Steam аккаунт' : 'Привязка Steam'}
                </p>
                <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>
                  Вставь ссылку на профиль, Steam ID или ник.
                </p>
                <input
                  value={steamInput}
                  onChange={(e) => setSteamInput(e.target.value)}
                  placeholder="https://steamcommunity.com/id/ник"
                  className="w-full rounded-xl border-0 px-3 py-2.5 outline-none"
                  style={{ background: 'var(--app-surface)', color: 'var(--tg-text)' }}
                />
                <AccountFields
                  email={accountEmail}
                  login={accountLogin}
                  onEmailChange={setAccountEmail}
                  onLoginChange={setAccountLogin}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void linkSteam()}
                    className="flex-1 rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-50"
                    style={{
                      background: 'linear-gradient(145deg, #1b2838, #2a475e)',
                      color: '#c7d5e0',
                    }}
                  >
                    Добавить
                  </button>
                  {hasAccounts ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setAdding(false);
                        setSteamInput('');
                        setAccountEmail('');
                        setAccountLogin('');
                      }}
                      className="rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-50"
                      style={{
                        background:
                          'color-mix(in srgb, var(--tg-hint) 14%, transparent)',
                      }}
                    >
                      Отмена
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}

            {data.profile ? (
              <p
                className="text-center text-xs"
                style={{ color: 'var(--tg-hint)' }}
              >
                Автообновление раз в день · {formatSync(data.profile.lastSyncAt)}
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === 'games' ? (
          <div className="space-y-3">
            {data.profile ? (
              <div
                className="flex items-center gap-3 rounded-2xl px-3 py-2"
                style={{
                  background: 'color-mix(in srgb, var(--app-surface-muted) 70%, #1b2838)',
                }}
              >
                <AccountAvatar profile={data.profile} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {data.profile.personaName}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>
                    {data.owned.length} в библиотеке · {data.missing.length} в
                    вишлисте
                  </p>
                </div>
                <ProfileLinkButton href={data.profile.profileUrl} />
              </div>
            ) : null}

            <div
              className="grid grid-cols-2 gap-1 rounded-2xl p-1"
              style={{
                background: 'color-mix(in srgb, #1b2838 12%, transparent)',
              }}
            >
              <SubTabButton
                active={gamesSubTab === 'owned'}
                label={`Библиотека · ${data.owned.length}`}
                accent="#16a34a"
                onClick={() => {
                  haptic('light');
                  setGamesSubTab('owned');
                }}
              />
              <SubTabButton
                active={gamesSubTab === 'missing'}
                label={`Вишлист · ${data.missing.length}`}
                accent="#dc2626"
                onClick={() => {
                  haptic('light');
                  setGamesSubTab('missing');
                }}
              />
            </div>

            {!data.profile ? (
              <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>
                Сначала добавь Steam аккаунт на вкладке «Аккаунты»
              </p>
            ) : list.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>
                {gamesSubTab === 'owned'
                  ? 'В библиотеке пока пусто или список игр скрыт в Steam'
                  : 'Вишлист пуст'}
              </p>
            ) : (
              list.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  variant={gamesSubTab === 'owned' ? 'owned' : 'missing'}
                />
              ))
            )}
          </div>
        ) : null}

        {tab === 'skins' ? (
          <div className="space-y-3">
            {data.profile ? (
              <div
                className="flex items-center gap-3 rounded-2xl px-3 py-2"
                style={{
                  background: 'color-mix(in srgb, var(--app-surface-muted) 70%, #1b2838)',
                }}
              >
                <AccountAvatar profile={data.profile} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {data.profile.personaName}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>
                    CS2 · {formatSync(inventory?.profile?.lastInventorySyncAt)}
                  </p>
                </div>
                <ProfileLinkButton href={data.profile.profileUrl} />
              </div>
            ) : null}

            {!data.profile ? (
              <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>
                Сначала добавь Steam аккаунт на вкладке «Аккаунты»
              </p>
            ) : inventoryLoading && !inventory ? (
              <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>
                Загружаем инвентарь и цены…
              </p>
            ) : inventory?.hidden ? (
              <section
                className="rounded-3xl px-5 py-4 text-sm"
                style={{
                  background:
                    'color-mix(in srgb, var(--app-danger) 12%, var(--tg-secondary))',
                  color: 'var(--app-danger)',
                }}
              >
                Инвентарь скрыт в настройках Steam. Сделай профиль и инвентарь
                CS2 публичными, затем открой вкладку снова.
              </section>
            ) : (
              <InventoryPanel items={inventory?.items ?? []} />
            )}
          </div>
        ) : null}

        {status ? (
          <p
            className="rounded-2xl px-4 py-3 text-sm"
            style={{
              background:
                'color-mix(in srgb, var(--tg-button) 14%, transparent)',
            }}
          >
            {status}
          </p>
        ) : null}
      </Shell>
    </div>
  );
}

function SubTabButton({
  active,
  label,
  accent,
  onClick,
}: {
  active: boolean;
  label: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-3 py-2.5 text-xs font-semibold transition"
      style={{
        background: active
          ? `color-mix(in srgb, ${accent} 18%, var(--app-surface))`
          : 'transparent',
        color: active ? accent : 'var(--tg-hint)',
        boxShadow: active ? `inset 0 0 0 1px ${accent}` : 'none',
      }}
    >
      {label}
    </button>
  );
}

function AccountAvatar({ profile }: { profile: SteamProfile }) {
  const [broken, setBroken] = useState(!profile.avatarUrl);
  return broken ? (
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{ background: '#1b2838', color: '#66c0f4' }}
    >
      {(profile.personaName || 'S').slice(0, 1).toUpperCase()}
    </div>
  ) : (
    <img
      src={profile.avatarUrl}
      alt=""
      className="h-11 w-11 shrink-0 rounded-full object-cover"
      onError={() => setBroken(true)}
    />
  );
}

function ProfileLinkButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Открыть профиль Steam"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
      style={{
        background: 'color-mix(in srgb, #1b2838 88%, #66c0f4)',
        color: '#c7d5e0',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="currentColor"
        aria-hidden
      >
        <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z" />
      </svg>
    </a>
  );
}

function AccountCard({
  profile,
  busy,
  onSelect,
  onDelete,
  onUpdate,
}: {
  profile: SteamProfile;
  busy: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdate: (meta: { accountEmail?: string; accountLogin?: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(profile.accountEmail);
  const [login, setLogin] = useState(profile.accountLogin);

  useEffect(() => {
    setEmail(profile.accountEmail);
    setLogin(profile.accountLogin);
  }, [profile.accountEmail, profile.accountLogin]);

  return (
    <article
      className="rounded-[24px] px-3 py-3"
      style={{
        background: profile.active
          ? 'color-mix(in srgb, #66c0f4 22%, var(--app-surface))'
          : 'color-mix(in srgb, var(--app-surface-muted) 70%, #1b2838)',
        outline: profile.active ? '2px solid #66c0f4' : 'none',
      }}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          disabled={busy || profile.active}
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-100"
        >
          <AccountAvatar profile={profile} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {profile.personaName}
            </p>
            <p className="truncate text-xs" style={{ color: 'var(--tg-hint)' }}>
              {profile.active ? 'Выбран' : 'Нажми, чтобы выбрать'} ·{' '}
              {formatSync(profile.lastSyncAt)}
            </p>
          </div>
        </button>
        <ProfileLinkButton href={profile.profileUrl} />
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <AccountFields
            email={email}
            login={login}
            onEmailChange={setEmail}
            onLoginChange={setLogin}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onUpdate({
                  accountEmail: email.trim(),
                  accountLogin: login.trim(),
                });
                setEditing(false);
              }}
              className="flex-1 rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-50"
              style={{
                background: 'linear-gradient(145deg, #1b2838, #2a475e)',
                color: '#c7d5e0',
              }}
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => {
                setEmail(profile.accountEmail);
                setLogin(profile.accountLogin);
                setEditing(false);
              }}
              className="rounded-xl px-3 py-2 text-sm"
              style={{
                background:
                  'color-mix(in srgb, var(--app-surface-muted) 55%, transparent)',
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div
          className="mt-3 rounded-xl px-3 py-2 text-xs"
          style={{
            background: 'color-mix(in srgb, var(--app-surface-muted) 55%, transparent)',
          }}
        >
          <p style={{ color: 'var(--tg-hint)' }}>
            Логин:{' '}
            <span style={{ color: 'var(--tg-text)' }}>
              {profile.accountLogin || '—'}
            </span>
          </p>
          <p className="mt-1" style={{ color: 'var(--tg-hint)' }}>
            Почта:{' '}
            <span style={{ color: 'var(--tg-text)' }}>
              {profile.accountEmail || '—'}
            </span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="mt-2 text-xs font-semibold disabled:opacity-50"
            style={{ color: 'var(--app-link)' }}
          >
            Изменить данные
          </button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniStat label="Всего" value={profile.stats.total} />
        <MiniStat label="Есть" value={profile.stats.owned} accent="#16a34a" />
        <MiniStat label="Нет" value={profile.stats.missing} accent="#dc2626" />
      </div>

      <div
        className="mt-2 rounded-xl px-3 py-2"
        style={{
          background: 'color-mix(in srgb, var(--app-surface-muted) 55%, transparent)',
        }}
      >
        {profile.inventoryHidden ? (
          <p className="text-xs font-medium" style={{ color: 'var(--app-danger)' }}>
            Инвентарь скрыт
          </p>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>
              CS2 · {profile.stats.inventoryCount} шт.
            </p>
            <p className="text-sm font-semibold">
              {formatUsd(profile.stats.inventoryValueUsd)}
            </p>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        className="mt-2 w-full rounded-xl px-3 py-2 text-sm font-medium disabled:opacity-50"
        style={{
          background: 'color-mix(in srgb, var(--app-danger) 14%, transparent)',
          color: 'var(--app-danger)',
        }}
      >
        Удалить аккаунт
      </button>
    </article>
  );
}

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div
      className="rounded-xl px-2 py-2 text-center"
      style={{
        background: 'color-mix(in srgb, var(--app-surface-muted) 55%, transparent)',
      }}
    >
      <p
        className="text-[10px] font-semibold uppercase"
        style={{ color: 'var(--tg-hint)' }}
      >
        {label}
      </p>
      <p
        className="mt-0.5 text-base font-semibold"
        style={{ color: accent ?? 'var(--tg-text)' }}
      >
        {value}
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-[24px] px-3 py-4 text-center"
      style={{
        background: 'color-mix(in srgb, var(--app-surface-muted) 72%, #66c0f4)',
      }}
    >
      <p
        className="text-[11px] font-semibold tracking-wide uppercase"
        style={{ color: 'var(--tg-hint)' }}
      >
        {label}
      </p>
      <p
        className="font-display mt-2 text-xl font-semibold leading-tight"
        style={{ color: accent ?? 'var(--tg-text)' }}
      >
        {value}
      </p>
    </div>
  );
}

function SteamCover({ src }: { src?: string }) {
  const [broken, setBroken] = useState(!src);

  return (
    <div
      className="relative h-[52px] w-[116px] shrink-0 overflow-hidden rounded-[14px]"
      style={{
        background: 'linear-gradient(145deg, #1b2838, #2a475e)',
      }}
    >
      {!broken && src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            className="h-8 w-8"
            aria-hidden
            fill="#c7d5e0"
          >
            <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.962 20.307 6.59 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714 1.001 1.28 1.28 1.274.629 2.816.004 3.447-1.271.306-.617.314-1.318.047-1.942-.267-.625-.748-1.122-1.36-1.403-.612-.282-1.308-.295-1.942-.047l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.01L7.54 18.21zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.289-.005c0-1.252 1.02-2.274 2.274-2.274 1.251 0 2.274 1.022 2.274 2.274 0 1.251-1.023 2.274-2.274 2.274-1.254 0-2.274-1.023-2.274-2.274z" />
          </svg>
        </div>
      )}
    </div>
  );
}

function GameCard({
  game,
  variant,
}: {
  game: SteamGame;
  variant: 'owned' | 'missing';
}) {
  return (
    <a
      href={game.storeUrl}
      target="_blank"
      rel="noreferrer"
      className="flex gap-3 overflow-hidden rounded-[24px] p-2 pr-3"
      style={{
        background: 'color-mix(in srgb, var(--app-surface-muted) 75%, #1b2838)',
      }}
    >
      <SteamCover src={game.imageUrl || undefined} />
      <div className="min-w-0 py-1">
        <p className="line-clamp-2 text-sm font-semibold leading-snug">
          {game.name}
        </p>
        <p
          className="mt-1 text-xs font-medium"
          style={{ color: variant === 'owned' ? '#16a34a' : '#dc2626' }}
        >
          {variant === 'owned' ? 'В библиотеке' : 'В вишлисте'}
        </p>
      </div>
    </a>
  );
}

function itemTotal(item: InventoryItem) {
  return (
    item.totalUsd ??
    (item.priceUsd != null ? item.priceUsd * item.amount : null)
  );
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );
}

function rarityAccent(rarity: string) {
  const value = rarity.toLowerCase();
  if (value.includes('контрабанд') || value.includes('contraband')) {
    return '#e4ae39';
  }
  if (
    value.includes('тайное') ||
    value.includes('extraordin') ||
    value.includes('covert') ||
    value.includes('нож')
  ) {
    return '#eb4b4b';
  }
  if (value.includes('засекрет') || value.includes('classified')) {
    return '#d32ce6';
  }
  if (value.includes('запрещ') || value.includes('restricted')) {
    return '#8847ff';
  }
  if (value.includes('армейск') || value.includes('mil-spec')) {
    return '#4b69ff';
  }
  if (value.includes('промышл') || value.includes('industrial')) {
    return '#5e98d9';
  }
  return '#66c0f4';
}

type InvSort = 'price_desc' | 'price_asc' | 'name';
type InvGroup = 'none' | 'type' | 'rarity' | 'exterior';
type InvPriceFilter = 'all' | 'priced' | 'unpriced';

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block space-y-1">
      <span
        className="px-0.5 text-[11px] font-medium"
        style={{ color: 'var(--tg-hint)' }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border-0 px-3 py-2.5 text-sm outline-none"
        style={{
          background: 'var(--app-surface)',
          color: 'var(--tg-text)',
          boxShadow:
            'inset 0 0 0 1px color-mix(in srgb, #66c0f4 28%, transparent)',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function InventoryPanel({ items }: { items: InventoryItem[] }) {
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [exteriorFilter, setExteriorFilter] = useState('all');
  const [priceFilter, setPriceFilter] = useState<InvPriceFilter>('all');
  const [sort, setSort] = useState<InvSort>('price_desc');
  const [groupBy, setGroupBy] = useState<InvGroup>('type');

  const types = useMemo(
    () => uniqueSorted(items.map((item) => item.typeLabel || 'Другое')),
    [items],
  );
  const rarities = useMemo(
    () => uniqueSorted(items.map((item) => item.rarity)),
    [items],
  );
  const exteriors = useMemo(
    () => uniqueSorted(items.map((item) => item.exterior)),
    [items],
  );

  const activeFilterCount = [
    typeFilter !== 'all',
    rarityFilter !== 'all',
    exteriorFilter !== 'all',
    priceFilter !== 'all',
    sort !== 'price_desc',
    groupBy !== 'type',
  ].filter(Boolean).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const next = items.filter((item) => {
      if (q) {
        const hay = `${item.name} ${item.marketHashName}`.toLowerCase();
        if (!hay.includes(q)) {
          return false;
        }
      }
      if (typeFilter !== 'all' && (item.typeLabel || 'Другое') !== typeFilter) {
        return false;
      }
      if (rarityFilter !== 'all' && item.rarity !== rarityFilter) {
        return false;
      }
      if (exteriorFilter !== 'all' && item.exterior !== exteriorFilter) {
        return false;
      }
      const priced = itemTotal(item) != null;
      if (priceFilter === 'priced' && !priced) {
        return false;
      }
      if (priceFilter === 'unpriced' && priced) {
        return false;
      }
      return true;
    });

    next.sort((a, b) => {
      const aPrice = itemTotal(a);
      const bPrice = itemTotal(b);
      if (sort === 'name') {
        return a.name.localeCompare(b.name, 'ru');
      }
      if (sort === 'price_asc') {
        if (aPrice == null && bPrice == null) {
          return a.name.localeCompare(b.name, 'ru');
        }
        if (aPrice == null) {
          return 1;
        }
        if (bPrice == null) {
          return -1;
        }
        return aPrice - bPrice;
      }
      if (aPrice == null && bPrice == null) {
        return a.name.localeCompare(b.name, 'ru');
      }
      if (aPrice == null) {
        return 1;
      }
      if (bPrice == null) {
        return -1;
      }
      return bPrice - aPrice;
    });

    return next;
  }, [
    items,
    query,
    typeFilter,
    rarityFilter,
    exteriorFilter,
    priceFilter,
    sort,
  ]);

  const groups = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', title: '', items: filtered }];
    }
    const map = new Map<string, InventoryItem[]>();
    for (const item of filtered) {
      const key =
        groupBy === 'type'
          ? item.typeLabel || 'Другое'
          : groupBy === 'rarity'
            ? item.rarity || 'Без редкости'
            : item.exterior || 'Без износа';
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
      .map(([key, groupItems]) => ({
        key,
        title: key,
        items: groupItems,
      }));
  }, [filtered, groupBy]);

  const visibleTotal = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const item of filtered) {
      count += item.amount;
      const price = itemTotal(item);
      if (price != null) {
        sum += price;
      }
    }
    return {
      count,
      sum: Math.round(sum * 100) / 100,
    };
  }, [filtered]);

  function resetFilters() {
    setTypeFilter('all');
    setRarityFilter('all');
    setExteriorFilter('all');
    setPriceFilter('all');
    setSort('price_desc');
    setGroupBy('type');
  }

  if (items.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>
        Инвентарь CS2 пуст или ещё не загрузился
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="В фильтре" value={visibleTotal.count} />
        <StatCard
          label="Сумма"
          value={formatUsd(visibleTotal.sum)}
          accent="#1b2838"
        />
      </div>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти скин…"
          className="min-w-0 flex-1 rounded-2xl border-0 px-4 py-3 text-sm outline-none"
          style={{
            background: 'var(--app-surface)',
            color: 'var(--tg-text)',
            boxShadow:
              'inset 0 0 0 1px color-mix(in srgb, #66c0f4 28%, transparent)',
          }}
        />
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          className="relative shrink-0 rounded-2xl px-3.5 py-3 text-sm font-semibold"
          style={{
            background: filtersOpen
              ? 'linear-gradient(145deg, #1b2838, #2a475e)'
              : 'var(--app-surface)',
            color: filtersOpen ? '#c7d5e0' : 'var(--tg-text)',
            boxShadow:
              'inset 0 0 0 1px color-mix(in srgb, #66c0f4 28%, transparent)',
          }}
        >
          Фильтры
          {activeFilterCount > 0 ? (
            <span
              className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
              style={{ background: '#66c0f4', color: '#1b2838' }}
            >
              {activeFilterCount}
            </span>
          ) : null}
        </button>
      </div>

      {filtersOpen ? (
        <div className="space-y-3 rounded-2xl p-3" style={{ background: 'var(--app-surface)' }}>
          <div className="grid grid-cols-2 gap-2.5">
            <FilterSelect
              label="Сортировка"
              value={sort}
              onChange={(value) => setSort(value as InvSort)}
              options={[
                { value: 'price_desc', label: 'Сначала дороже' },
                { value: 'price_asc', label: 'Сначала дешевле' },
                { value: 'name', label: 'По названию' },
              ]}
            />
            <FilterSelect
              label="Группировка"
              value={groupBy}
              onChange={(value) => setGroupBy(value as InvGroup)}
              options={[
                { value: 'type', label: 'По типу' },
                { value: 'rarity', label: 'По редкости' },
                { value: 'exterior', label: 'По износу' },
                { value: 'none', label: 'Без групп' },
              ]}
            />
            <FilterSelect
              label="Цена"
              value={priceFilter}
              onChange={(value) => setPriceFilter(value as InvPriceFilter)}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'priced', label: 'С ценой' },
                { value: 'unpriced', label: 'Без цены' },
              ]}
            />
            <FilterSelect
              label="Тип"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: 'all', label: 'Все' },
                ...types.map((value) => ({ value, label: value })),
              ]}
            />
            <FilterSelect
              label="Редкость"
              value={rarityFilter}
              onChange={setRarityFilter}
              options={[
                { value: 'all', label: 'Все' },
                ...rarities.map((value) => ({ value, label: value })),
              ]}
            />
            <FilterSelect
              label="Износ"
              value={exteriorFilter}
              onChange={setExteriorFilter}
              options={[
                { value: 'all', label: 'Все' },
                ...exteriors.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={resetFilters}
              className="w-full rounded-xl px-3 py-2 text-sm font-medium"
              style={{
                background: 'color-mix(in srgb, #66c0f4 14%, transparent)',
                color: '#1b2838',
              }}
            >
              Сбросить фильтры
            </button>
          ) : null}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>
          Ничего не найдено по фильтрам
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="space-y-2">
            {group.title ? (
              <div className="flex items-center justify-between px-1 pt-1">
                <p className="text-sm font-semibold">{group.title}</p>
                <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>
                  {group.items.reduce((sum, item) => sum + item.amount, 0)} шт.
                </p>
              </div>
            ) : null}
            <div
              className="grid gap-2.5"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
              }}
            >
              {group.items.map((item) => (
                <InventoryCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function InventoryCard({ item }: { item: InventoryItem }) {
  const [broken, setBroken] = useState(!item.iconUrl);
  const price = item.totalUsd ?? item.priceUsd;
  const accent = rarityAccent(item.rarity);

  return (
    <article
      className="relative overflow-hidden rounded-[22px]"
      style={{
        background: `linear-gradient(165deg, color-mix(in srgb, ${accent} 28%, #1b2838), #0e1620 70%)`,
        boxShadow: `0 8px 20px color-mix(in srgb, ${accent} 18%, transparent)`,
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: accent }}
      />
      <div className="relative px-2 pt-3 pb-2">
        <div className="mx-auto flex aspect-square w-full max-w-[96px] items-center justify-center">
          {!broken && item.iconUrl ? (
            <img
              src={item.iconUrl}
              alt=""
              className="h-full w-full object-contain drop-shadow-[0_6px_12px_rgba(0,0,0,0.35)]"
              onError={() => setBroken(true)}
            />
          ) : (
            <span className="text-xs font-bold" style={{ color: accent }}>
              CS
            </span>
          )}
        </div>
        {item.amount > 1 ? (
          <span
            className="absolute top-2 right-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
            style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}
          >
            ×{item.amount}
          </span>
        ) : null}
      </div>
      <div className="space-y-1 px-2.5 pb-3">
        <p
          className="line-clamp-2 min-h-[2.4rem] text-center text-[11px] font-semibold leading-snug"
          style={{ color: '#e8f1f8' }}
        >
          {item.name}
        </p>
        {item.exterior ? (
          <p className="text-center text-[10px]" style={{ color: '#9fb3c4' }}>
            {item.exterior}
          </p>
        ) : null}
        <p
          className="rounded-xl py-1 text-center text-xs font-bold"
          style={{
            background: 'rgba(255,255,255,0.08)',
            color: price != null ? '#fff' : '#8aa0b3',
          }}
        >
          {formatUsd(price)}
        </p>
      </div>
    </article>
  );
}
