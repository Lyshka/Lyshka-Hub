import { useEffect, useState } from 'react';
import type { PlatformApp } from './api/client';
import {
  AppBackground,
  type AppBackgroundVariant,
} from './components/AppBackground';
import { AdminScreen } from './screens/AdminScreen';
import { BuyApp } from './screens/BuyApp';
import { CatsApp } from './screens/CatsApp';
import { GamesApp } from './screens/GamesApp';
import { LauncherScreen } from './screens/LauncherScreen';
import { MedsApp } from './screens/MedsApp';
import { LinksApp } from './screens/LinksApp';
import { RatesApp } from './screens/RatesApp';
import { StatsApp } from './screens/StatsApp';
import { TelegramProvider, useTelegram } from './telegram/TelegramProvider';

function backgroundVariant(app: PlatformApp | null): AppBackgroundVariant {
  if (!app) {
    return 'launcher';
  }
  if (app.slug === 'meds') {
    return 'meds';
  }
  if (app.slug === 'cats') {
    return 'cats';
  }
  if (app.slug === 'games') {
    return 'games';
  }
  if (app.slug === 'stats') {
    return 'stats';
  }
  if (app.slug === 'links') {
    return 'links';
  }
  if (app.slug === 'buy') {
    return 'buy';
  }
  if (app.slug === 'rates') {
    return 'rates';
  }
  if (app.slug === 'admin') {
    return 'admin';
  }
  return 'launcher';
}

function AppContent() {
  const { ready, error, user, apps, startAppSlug } = useTelegram();
  const [activeApp, setActiveApp] = useState<PlatformApp | null>(null);
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  const variant = backgroundVariant(activeApp);

  useEffect(() => {
    if (!ready || !user || deepLinkHandled || !startAppSlug) {
      return;
    }
    const target = apps.find((app) => app.slug === startAppSlug) ?? null;
    if (target) {
      setActiveApp(target);
    }
    setDeepLinkHandled(true);
  }, [ready, user, apps, startAppSlug, deepLinkHandled]);

  if (!ready) {
    return (
      <>
        <AppBackground variant="launcher" />
        <div
          className="relative z-[1] flex min-h-[100dvh] items-center justify-center px-6 text-sm"
          style={{ color: 'var(--tg-hint)' }}
        >
          Загрузка...
        </div>
      </>
    );
  }

  if (error || !user) {
    return (
      <>
        <AppBackground variant="launcher" />
        <div className="relative z-[1] mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-3 px-6">
          <h1 className="font-display text-2xl font-semibold">Нет доступа</h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--tg-hint)' }}>
            Открой Lyshka Hub через кнопку бота в Telegram.
          </p>
          <p
            className="rounded-2xl px-4 py-3 text-sm"
            style={{ background: 'var(--app-surface)' }}
          >
            {error ?? 'Нет данных пользователя'}
          </p>
        </div>
      </>
    );
  }

  let screen = <LauncherScreen onOpen={setActiveApp} />;

  if (activeApp?.slug === 'admin') {
    screen = <AdminScreen onBack={() => setActiveApp(null)} />;
  } else if (activeApp?.slug === 'meds') {
    screen = <MedsApp onBack={() => setActiveApp(null)} />;
  } else if (activeApp?.slug === 'cats') {
    screen = <CatsApp onBack={() => setActiveApp(null)} />;
  } else if (activeApp?.slug === 'games') {
    screen = <GamesApp onBack={() => setActiveApp(null)} />;
  } else if (activeApp?.slug === 'stats') {
    screen = <StatsApp onBack={() => setActiveApp(null)} />;
  } else if (activeApp?.slug === 'links') {
    screen = <LinksApp onBack={() => setActiveApp(null)} />;
  } else if (activeApp?.slug === 'buy') {
    screen = <BuyApp onBack={() => setActiveApp(null)} />;
  } else if (activeApp?.slug === 'rates') {
    screen = <RatesApp onBack={() => setActiveApp(null)} />;
  }

  return (
    <>
      <AppBackground variant={variant} />
      <div className="relative z-[1]">{screen}</div>
    </>
  );
}

export default function App() {
  return (
    <TelegramProvider>
      <AppContent />
    </TelegramProvider>
  );
}
