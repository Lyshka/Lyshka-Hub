import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { execFile } from 'child_process';
import NodeCS2 from 'node-cs2';
import QRCode from 'qrcode';
import { EAuthTokenPlatformType, LoginSession } from 'steam-session';
import SteamUser from 'steam-user';

const PORT = 18734;
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

type ConnectorState = {
  status: 'idle' | 'creating' | 'waiting' | 'scanned' | 'connecting' | 'completed' | 'failed';
  message: string;
  qrDataUrl: string | null;
};

let state: ConnectorState = {
  status: 'idle',
  message: 'Вставь адрес сервера и код из Lyshka Hub',
  qrDataUrl: null,
};
let activeSession: LoginSession | null = null;

function setState(next: ConnectorState) {
  state = next;
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

function stopActiveSession() {
  if (!activeSession) {
    return;
  }
  activeSession.cancelLoginAttempt();
  activeSession = null;
}

async function beginLogin(baseUrl: string, code: string) {
  stopActiveSession();
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient, {
    machineId: true,
    machineFriendlyName: 'Lyshka Hub Connector',
  });
  activeSession = session;
  session.loginTimeout = 180000;
  setState({
    status: 'creating',
    message: 'Создаём QR-код Steam',
    qrDataUrl: null,
  });

  session.on('remoteInteraction', () => {
    setState({
      status: 'scanned',
      message: 'Подтверди вход в Steam Guard',
      qrDataUrl: state.qrDataUrl,
    });
  });
  session.on('timeout', () => {
    if (activeSession !== session) {
      return;
    }
    activeSession = null;
    setState({
      status: 'failed',
      message: 'Время QR-кода истекло',
      qrDataUrl: null,
    });
  });
  session.on('error', () => {
    if (activeSession !== session) {
      return;
    }
    activeSession = null;
    setState({
      status: 'failed',
      message: 'Steam не подтвердил вход',
      qrDataUrl: null,
    });
  });
  session.on('authenticated', () => {
    void (async () => {
      try {
        const steamId = session.steamID.getSteamID64();
        const refreshToken = session.refreshToken;
        if (!steamId || !refreshToken) {
          throw new Error();
        }
        setState({
          status: 'connecting',
          message: 'Получаем актуальные данные CS2',
          qrDataUrl: null,
        });
        const profile = await requestProfile(refreshToken, steamId);
        const stats = parseStats(profile);
        if (!stats) {
          throw new Error();
        }
        await submitStats(baseUrl, code, steamId, stats);
        if (activeSession === session) {
          activeSession = null;
        }
        setState({
          status: 'completed',
          message: 'Данные CS2 отправлены в Lyshka Hub',
          qrDataUrl: null,
        });
      } catch {
        if (activeSession === session) {
          activeSession = null;
        }
        setState({
          status: 'failed',
          message: 'Не удалось получить или отправить данные CS2',
          qrDataUrl: null,
        });
      }
    })();
  });

  try {
    const started = await session.startWithQR();
    if (!started.qrChallengeUrl || activeSession !== session) {
      throw new Error();
    }
    const qrDataUrl = await QRCode.toDataURL(started.qrChallengeUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    });
    if (activeSession !== session) {
      return;
    }
    setState({
      status: 'waiting',
      message: 'Открой Steam Guard и отсканируй QR-код',
      qrDataUrl,
    });
  } catch {
    if (activeSession === session) {
      activeSession = null;
    }
    setState({
      status: 'failed',
      message: 'Не удалось создать QR-код Steam',
      qrDataUrl: null,
    });
  }
}

async function readJson(request: IncomingMessage) {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 4096) {
      throw new Error();
    }
  }
  return JSON.parse(body) as { serverUrl?: unknown; code?: unknown };
}

function sendJson(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function page() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lyshka Hub CS2</title>
<style>
body{margin:0;background:#101820;color:#e8f1f5;font:16px system-ui,sans-serif}
main{max-width:420px;margin:0 auto;padding:28px 18px}
h1{font-size:24px;margin:0 0 8px}
p{color:#9fb1bd;line-height:1.45}
label{display:block;margin:18px 0 7px;font-size:14px;color:#b9c8d1}
input,button{box-sizing:border-box;width:100%;border-radius:12px;font:inherit}
input{border:1px solid #38505e;background:#18252e;color:#e8f1f5;padding:12px}
button{border:0;background:#5fa8d3;color:#071218;font-weight:700;padding:13px;margin-top:16px;cursor:pointer}
#card{margin-top:22px;padding:18px;border-radius:16px;background:#18252e;text-align:center}
#qr{display:none;width:260px;height:260px;margin:16px auto 0;background:#fff;padding:10px;border-radius:12px;box-sizing:border-box}
#state{margin:0;color:#d6e4ea}
</style>
</head>
<body>
<main>
<h1>Обновление CS2</h1>
<p>Вставь адрес и одноразовый код из Lyshka Hub. Steam откроется только с этого компьютера.</p>
<form id="form">
<label for="url">Адрес Lyshka Hub</label>
<input id="url" type="url" required placeholder="https://example.duckdns.org">
<label for="code">Одноразовый код</label>
<input id="code" required autocomplete="off">
<button type="submit">Показать QR-код Steam</button>
</form>
<section id="card">
<p id="state">Вставь данные для подключения</p>
<img id="qr" alt="QR-код Steam">
</section>
</main>
<script>
const form=document.getElementById('form');
const url=document.getElementById('url');
const code=document.getElementById('code');
const state=document.getElementById('state');
const qr=document.getElementById('qr');
url.value=localStorage.getItem('lyshka-server-url')||'';
async function refresh(){
  const response=await fetch('/status',{cache:'no-store'});
  const data=await response.json();
  state.textContent=data.message;
  if(data.qrDataUrl){
    qr.src=data.qrDataUrl;
    qr.style.display='block';
  }else{
    qr.removeAttribute('src');
    qr.style.display='none';
  }
}
form.addEventListener('submit',async(event)=>{
  event.preventDefault();
  localStorage.setItem('lyshka-server-url',url.value.trim());
  await fetch('/start',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({serverUrl:url.value.trim(),code:code.value.trim()})
  });
  code.value='';
  await refresh();
});
setInterval(()=>void refresh(),1000);
void refresh();
</script>
</body>
</html>`;
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(page());
    return;
  }
  if (request.method === 'GET' && request.url === '/status') {
    sendJson(response, state);
    return;
  }
  if (request.method === 'POST' && request.url === '/start') {
    void readJson(request)
      .then((body) => {
        const serverUrl =
          typeof body.serverUrl === 'string' ? body.serverUrl.trim() : '';
        const code = typeof body.code === 'string' ? body.code.trim() : '';
        if (!/^https:\/\//i.test(serverUrl) || code.length < 40) {
          sendJson(response, { ok: false }, 400);
          return;
        }
        void beginLogin(serverUrl, code);
        sendJson(response, { ok: true });
      })
      .catch(() => sendJson(response, { ok: false }, 400));
    return;
  }
  sendJson(response, { ok: false }, 404);
});

server.listen(PORT, '127.0.0.1', () => {
  execFile(
    'cmd.exe',
    ['/c', 'start', '', `http://127.0.0.1:${PORT}`],
    () => undefined,
  );
});
