import NodeCS2 = require('node-cs2');
import { generate } from 'qrcode-terminal';
import { EAuthTokenPlatformType, LoginSession } from 'steam-session';
import SteamUser = require('steam-user');

const CS2_XP_BASE = 327680000;
const CS2_XP_LEVEL_SIZE = 5000;

type GcRanking = {
  rank_id?: number | null;
  rank_type_id?: number | null;
};

type GcProfile = NodeCS2.PlayerProfile & {
  ranking?: GcRanking | null;
  rankings?: GcRanking[];
};

type Cs2Stats = {
  cs2ProfileRank: number;
  cs2ProfileXp: number;
  cs2PremierRating?: number;
  cs2WingmanRank?: number;
};

function argument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? null : process.argv[index + 1];
  return value?.trim() || null;
}

function asInteger(value: unknown, allowZero = false) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    return null;
  }
  if (allowZero ? number < 0 : number <= 0) {
    return null;
  }
  return number;
}

function getRanking(profile: GcProfile, type: number) {
  const rankings = [
    ...(Array.isArray(profile.rankings) ? profile.rankings : []),
    ...(profile.ranking ? [profile.ranking] : []),
  ];
  return asInteger(
    rankings.find((ranking) => ranking.rank_type_id === type)?.rank_id,
  );
}

function parseStats(profile: GcProfile): Cs2Stats | null {
  const cs2ProfileRank = asInteger(profile.player_level);
  const rawXp = asInteger(profile.player_cur_xp, true);
  if (
    cs2ProfileRank == null ||
    rawXp == null ||
    rawXp < CS2_XP_BASE
  ) {
    return null;
  }

  const cs2PremierRating = getRanking(profile, 11);
  const cs2WingmanRank = getRanking(profile, 7);
  return {
    cs2ProfileRank,
    cs2ProfileXp: (rawXp - CS2_XP_BASE) % CS2_XP_LEVEL_SIZE,
    ...(cs2PremierRating ? { cs2PremierRating } : {}),
    ...(cs2WingmanRank ? { cs2WingmanRank } : {}),
  };
}

function requestProfile(refreshToken: string, steamId: string) {
  return new Promise<GcProfile>((resolve, reject) => {
    const steam = new SteamUser({ dataDirectory: null });
    const cs2 = new NodeCS2(steam);
    let settled = false;

    const close = () => {
      clearTimeout(timeout);
      try {
        steam.gamesPlayed([]);
      } catch {
        return;
      } finally {
        steam.logOff();
      }
    };
    const resolveOnce = (profile: GcProfile) => {
      if (settled) {
        return;
      }
      settled = true;
      close();
      resolve(profile);
    };
    const rejectOnce = () => {
      if (settled) {
        return;
      }
      settled = true;
      close();
      reject(new Error());
    };
    const timeout = setTimeout(rejectOnce, 45000);

    steam.once('error', rejectOnce);
    cs2.once('error', rejectOnce);
    steam.once('loggedOn', () => {
      steam.gamesPlayed([730]);
    });
    cs2.once('connectedToGC', () => {
      void cs2
        .requestPlayersProfile(steamId)
        .then((profile) => resolveOnce(profile as GcProfile))
        .catch(rejectOnce);
    });

    try {
      steam.logOn({
        refreshToken,
        machineName: 'Lyshka Hub Connector',
      });
    } catch {
      rejectOnce();
    }
  });
}

async function submitStats(
  baseUrl: string,
  code: string,
  steamId: string,
  stats: Cs2Stats,
) {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/api/games/cs2-local/submit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, steamId, ...stats }),
    },
  );
  if (!response.ok) {
    throw new Error();
  }
}

async function run() {
  const baseUrl = argument('--url');
  const code = argument('--code');
  if (!baseUrl || !code || !/^https:\/\//i.test(baseUrl)) {
    process.exitCode = 1;
    return;
  }

  const session = new LoginSession(EAuthTokenPlatformType.SteamClient, {
    machineId: true,
    machineFriendlyName: 'Lyshka Hub Connector',
  });
  session.loginTimeout = 180000;

  let complete = false;
  const stop = (failed: boolean) => {
    if (complete) {
      return;
    }
    complete = true;
    session.cancelLoginAttempt();
    process.exitCode = failed ? 1 : 0;
  };

  session.on('timeout', () => stop(true));
  session.on('error', () => stop(true));
  session.on('authenticated', () => {
    void (async () => {
      try {
        const steamId = session.steamID.getSteamID64();
        const refreshToken = session.refreshToken;
        if (!steamId || !refreshToken) {
          stop(true);
          return;
        }
        const profile = await requestProfile(refreshToken, steamId);
        const stats = parseStats(profile);
        if (!stats) {
          stop(true);
          return;
        }
        await submitStats(baseUrl, code, steamId, stats);
        stop(false);
      } catch {
        stop(true);
      }
    })();
  });

  try {
    const started = await session.startWithQR();
    if (!started.qrChallengeUrl) {
      stop(true);
      return;
    }
    generate(started.qrChallengeUrl, { small: true });
  } catch {
    stop(true);
  }
}

void run();
