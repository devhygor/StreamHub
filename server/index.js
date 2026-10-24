const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const cfg = require('./config');
const auth = require('./auth');
const demo = require('./demo');
const startViewers = require('./viewers');

const platforms = {
  twitch: require('./platforms/twitch'),
  kick: require('./platforms/kick'),
  youtube: require('./platforms/youtube'),
};

const crypto = require('crypto');
const login = require('./login');

const app = express();
app.set('trust proxy', true);

// webhook da Kick: público (a assinatura é verificada), corpo cru
app.post('/webhooks/kick', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => platforms.kick.webhook(req, res));

// ---- proteção por chave (só quando STREAMHUB_KEY está definida, ex.: na VPS) ----
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const KEY_HASH = cfg.accessKey ? sha(cfg.accessKey) : null;
function cookieOf(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const PROTECTED = !!KEY_HASH || login.enabled;
// entra com sessão (e-mail + senha) ou com o cookie da chave (usado pelo overlay do OBS)
const authed = (req) =>
  !PROTECTED ||
  login.validSession(cookieOf(req, 'sh_session')) ||
  (!!KEY_HASH && same(cookieOf(req, 'sh_key'), KEY_HASH));

app.get('/login', (req, res) => (login.enabled ? res.type('html').send(login.page()) : res.redirect('/')));

app.post('/login', express.json(), (req, res) => {
  if (!login.enabled) return res.sendStatus(404);
  if (login.blocked(req.ip)) return res.sendStatus(429);
  if (!login.checkLogin(req.body?.email, req.body?.password)) {
    login.fail(req.ip);
    return res.sendStatus(401);
  }
  login.ok(req.ip);
  res.setHeader('Set-Cookie', `sh_session=${login.makeSession()}; Max-Age=${login.DAYS * 86400}; ${login.cookieAttrs(req.secure)}`);
  res.json({ ok: true });
});

app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `sh_session=; Max-Age=0; ${login.cookieAttrs(req.secure)}`);
  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (authed(req)) return next();
  const k = req.query.key;
  if (typeof k === 'string' && KEY_HASH && same(sha(k), KEY_HASH)) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sh_key=${KEY_HASH}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`);
    const u = new URL(req.originalUrl, 'http://x');
    u.searchParams.delete('key');
    return res.redirect(u.pathname + u.search);
  }
  if (login.enabled && req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api/')) return res.redirect('/login');
  res.sendStatus(401);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ req }) => authed(req) });

const history = [];
const statuses = {};

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

function pushMessage(m) {
  history.push(m);
  if (history.length > 150) history.shift();
  broadcast('message', m);
}

for (const [name, p] of Object.entries(platforms)) {
  statuses[name] = { platform: name, state: 'off', detail: '' };
  p.on('message', pushMessage);
  p.on('delete', (d) => {
    const i = history.findIndex((m) => m.id === d.id);
    if (i >= 0) history.splice(i, 1);
    broadcast('delete', d);
  });
  p.on('clear', (d) => broadcast('clear', d));
  p.on('status', (s) => {
    statuses[name] = s;
    broadcast('status', s);
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', payload: { history, statuses, viewers: viewers.state, state: cfg.publicView() } }));
});

let viewers = { state: {}, refresh() {} };

function pushState() {
  broadcast('state', cfg.publicView());
}

app.use(auth.router((p) => {
  pushState();
  viewers.refresh(p);
  if (cfg.data.tokens[p]) platforms[p].connect();
  else platforms[p].disconnect();
}));

app.get('/api/obs', (req, res) => res.json({ base: cfg.publicUrl(), key: cfg.accessKey }));

app.get('/api/state', (req, res) => res.json({ ...cfg.publicView(), statuses }));

// salva credenciais dos apps, canais e preferências
app.post('/api/config', (req, res) => {
  const { apps, channels, settings, presets } = req.body;
  for (const [k, v] of Object.entries(apps || {})) {
    if (!cfg.data.apps[k]) continue;
    if (typeof v.clientId === 'string') cfg.data.apps[k].clientId = v.clientId.trim();
    if (v.clientSecret) cfg.data.apps[k].clientSecret = v.clientSecret.trim();
  }
  if (channels) {
    for (const [k, v] of Object.entries(channels)) Object.assign(cfg.data.channels[k] || {}, v);
  }
  if (settings) Object.assign(cfg.data.settings, settings);
  if (presets) cfg.data.presets = presets;
  cfg.save();
  pushState();
  res.json({ ok: true });
});

app.post('/api/connect/:p', async (req, res) => {
  const p = platforms[req.params.p];
  if (!p) return res.sendStatus(404);
  p.connect();
  res.json({ ok: true });
});

app.post('/api/disconnect/:p', (req, res) => {
  const p = platforms[req.params.p];
  if (!p) return res.sendStatus(404);
  p.disconnect();
  res.json({ ok: true });
});

// roda a mesma ação em várias plataformas e devolve o resultado de cada uma
async function fanout(names, fn) {
  const out = {};
  await Promise.all(
    names.filter((n) => platforms[n]).map(async (n) => {
      try { out[n] = { ok: true, data: await fn(platforms[n], n) }; }
      catch (e) { out[n] = { ok: false, error: e.message }; }
    })
  );
  return out;
}

app.post('/api/send', async (req, res) => {
  const { text, platforms: names } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'vazio' });
  const r = await fanout(names, async (p) => {
    const m = await p.send(text.trim());
    if (m) pushMessage(m);
  });
  res.json(r);
});

app.get('/api/stream', async (req, res) => {
  const names = Object.keys(cfg.data.tokens).filter((n) => platforms[n]);
  res.json(await fanout(names, (p) => p.getInfo()));
});

app.post('/api/stream', async (req, res) => {
  const { title, game, platforms: names } = req.body;
  res.json(await fanout(names, (p, n) => p.setInfo({ title, gameId: game?.[n] })));
});

// busca de jogo: usa a Twitch como base e casa o mesmo nome na Kick
app.get('/api/games', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const [tw, ki] = await Promise.all([
    cfg.data.tokens.twitch ? platforms.twitch.categories(q).catch(() => []) : [],
    cfg.data.tokens.kick ? platforms.kick.categories(q).catch(() => []) : [],
  ]);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const list = tw.map((t) => ({
    name: t.name, img: t.img, twitch: t.id,
    kick: ki.find((k) => norm(k.name) === norm(t.name))?.id ?? null,
  }));
  for (const k of ki) {
    if (!list.some((l) => l.kick === k.id)) list.push({ name: k.name, img: k.img, twitch: null, kick: k.id });
  }
  res.json(list);
});

app.post('/api/demo', (req, res) => {
  if (req.body.on) demo.start(pushMessage, (s) => { Object.assign(viewers.state, s); broadcast('viewers', viewers.state); });
  else { demo.stop(); for (const k of Object.keys(viewers.state)) delete viewers.state[k]; broadcast('viewers', viewers.state); }
  res.json({ ok: true });
});

app.post('/api/clear', (req, res) => {
  history.length = 0;
  broadcast('clear', {});
  res.json({ ok: true });
});

server.listen(cfg.data.port, () => {
  viewers = startViewers(platforms, (s) => broadcast('viewers', s));
  console.log(`\n  StreamHub rodando em http://localhost:${cfg.data.port}\n`);
  if (cfg.data.channels.twitch.login || cfg.data.tokens.twitch) platforms.twitch.connect();
  if (cfg.data.tokens.kick) platforms.kick.connect();
  if (cfg.data.tokens.youtube) platforms.youtube.connect();
});
