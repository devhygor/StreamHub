const crypto = require('crypto');
const express = require('express');
const cfg = require('./config');

const PROVIDERS = {
  twitch: {
    authUrl: 'https://id.twitch.tv/oauth2/authorize',
    tokenUrl: 'https://id.twitch.tv/oauth2/token',
    scope: 'chat:read chat:edit channel:manage:broadcast channel:read:redemptions moderator:read:followers channel:read:subscriptions bits:read',
    async identify(access) {
      const r = await fetch('https://api.twitch.tv/helix/users', {
        headers: { Authorization: `Bearer ${access}`, 'Client-Id': cfg.data.apps.twitch.clientId },
      });
      const u = (await r.json()).data?.[0];
      return { userId: u.id, name: u.login };
    },
  },
  kick: {
    authUrl: 'https://id.kick.com/oauth/authorize',
    tokenUrl: 'https://id.kick.com/oauth/token',
    scope: 'user:read channel:read channel:write chat:write events:subscribe channel:rewards:read kicks:read',
    scopeBasic: 'user:read channel:read channel:write chat:write events:subscribe',
    pkce: true,
    async identify(access) {
      const h = { Authorization: `Bearer ${access}` };
      const u = (await (await fetch('https://api.kick.com/public/v1/users', { headers: h })).json()).data?.[0];
      const c = (await (await fetch('https://api.kick.com/public/v1/channels', { headers: h })).json()).data?.[0];
      return { userId: String(u?.user_id ?? c?.broadcaster_user_id), name: c?.slug || u?.name || '' };
    },
  },
  youtube: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube',
    extra: { access_type: 'offline', prompt: 'consent' },
    async identify(access) {
      const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${access}` },
      });
      const c = (await r.json()).items?.[0];
      return { userId: c?.id || '', name: c?.snippet?.title || '' };
    },
  },
};

const pending = new Map(); // state -> { platform, verifier }

function redirectUri(p) {
  return `${cfg.publicUrl()}/auth/${p}/callback`;
}

async function tokenRequest(p, params) {
  const app = cfg.data.apps[p];
  const body = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, ...params });
  const r = await fetch(PROVIDERS[p].tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.message || j.error || `HTTP ${r.status}`);
  return j;
}

function store(p, j, extra = {}) {
  const old = cfg.data.tokens[p] || {};
  cfg.data.tokens[p] = {
    ...old,
    ...extra,
    access: j.access_token,
    refresh: j.refresh_token || old.refresh,
    expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
  };
  cfg.save();
}

async function getToken(p) {
  const t = cfg.data.tokens[p];
  if (!t || !t.access) return null;
  if (Date.now() < t.expiresAt - 60000) return t.access;
  if (!t.refresh) return null;
  const j = await tokenRequest(p, { grant_type: 'refresh_token', refresh_token: t.refresh });
  store(p, j);
  return cfg.data.tokens[p].access;
}

function router(onLogin) {
  const r = express.Router();

  r.get('/auth/:p/login', (req, res) => {
    const p = req.params.p;
    const prov = PROVIDERS[p];
    const app = cfg.data.apps[p];
    if (!prov) return res.status(404).send('Plataforma inválida');
    if (!app.clientId || !app.clientSecret) return res.status(400).send('Preencha Client ID e Secret em Configurações primeiro.');
    const state = crypto.randomBytes(16).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    pending.set(state, { p, verifier });
    const q = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri(p),
      response_type: 'code',
      scope: (req.query.basic && prov.scopeBasic) || prov.scope,
      state,
      ...(prov.extra || {}),
    });
    if (prov.pkce) {
      q.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
      q.set('code_challenge_method', 'S256');
    }
    res.redirect(`${prov.authUrl}?${q}`);
  });

  r.get('/auth/:p/callback', async (req, res) => {
    const p = req.params.p;
    const st = pending.get(req.query.state);
    pending.delete(req.query.state);
    if (!st || st.p !== p || !req.query.code) {
      return res.status(400).send(page('Falha no login', req.query.error_description || 'Resposta inválida da plataforma.'));
    }
    try {
      const params = { grant_type: 'authorization_code', code: req.query.code, redirect_uri: redirectUri(p) };
      if (PROVIDERS[p].pkce) params.code_verifier = st.verifier;
      const j = await tokenRequest(p, params);
      const who = await PROVIDERS[p].identify(j.access_token);
      store(p, j, who);
      onLogin(p);
      res.send(page('Conectado!', `Conta <b>${who.name}</b> vinculada. Pode fechar esta aba.`, true));
    } catch (e) {
      res.status(500).send(page('Erro', String(e.message)));
    }
  });

  r.post('/api/logout/:p', (req, res) => {
    delete cfg.data.tokens[req.params.p];
    cfg.save();
    onLogin(req.params.p);
    res.json({ ok: true });
  });

  return r;
}

function page(title, msg, close) {
  return `<!doctype html><meta charset=utf-8><body style="font-family:system-ui;background:#0b0b12;color:#eee;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>${title}</h2><p>${msg}</p></div>${close ? '<script>setTimeout(()=>window.close(),1800)</script>' : ''}`;
}

module.exports = { router, getToken, redirectUri };
