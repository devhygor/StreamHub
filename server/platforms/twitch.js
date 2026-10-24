const WebSocket = require('ws');
const EventEmitter = require('events');
const cfg = require('../config');
const { getToken } = require('../auth');
const { makeEvent, tier } = require('../events');

const BADGES = { broadcaster: 'broadcaster', moderator: 'mod', vip: 'vip', subscriber: 'sub', founder: 'sub' };

class Twitch extends EventEmitter {
  constructor() {
    super();
    this.name = 'twitch';
    this.ws = null;
    this.want = false;
    this.retry = 0;
    this.emotes = new Map(); // 7TV: nome -> url
    this.channel = '';
  }

  status(state, detail = '') {
    this.state = state;
    this.emit('status', { platform: 'twitch', state, detail });
  }

  async connect() {
    this.want = true;
    clearTimeout(this.rt);
    this.close();
    this.closeEvents();
    const login = (cfg.data.channels.twitch.login || cfg.data.tokens.twitch?.name || '').toLowerCase().replace(/^#/, '');
    if (!login) return this.status('off', 'Informe o canal da Twitch');
    this.channel = login;
    this.status('connecting');
    let token = null;
    try { token = await getToken('twitch'); } catch {}
    const nick = token ? cfg.data.tokens.twitch.name : `justinfan${Math.floor(Math.random() * 90000 + 10000)}`;
    this.authed = !!token;
    const ws = (this.ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'));
    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send(`PASS ${token ? 'oauth:' + token : 'SCHMOOZE'}`);
      ws.send(`NICK ${nick}`);
      ws.send(`JOIN #${login}`);
    });
    ws.on('message', (buf) => buf.toString().split('\r\n').filter(Boolean).forEach((l) => this.line(l)));
    ws.on('close', () => {
      if (ws !== this.ws) return;
      this.status('error', 'Desconectado, tentando de novo...');
      this.reconnect();
    });
    ws.on('error', () => {});
  }

  reconnect() {
    if (!this.want) return;
    this.retry = Math.min(this.retry + 1, 6);
    this.rt = setTimeout(() => this.connect(), this.retry * 2000);
  }

  close() {
    if (this.ws) {
      const w = this.ws;
      this.ws = null;
      try { w.close(); } catch {}
    }
  }

  disconnect() {
    this.want = false;
    clearTimeout(this.rt);
    this.close();
    this.closeEvents();
    this.status('off');
  }

  line(raw) {
    let tags = {};
    let rest = raw;
    if (rest[0] === '@') {
      const i = rest.indexOf(' ');
      for (const kv of rest.slice(1, i).split(';')) {
        const [k, ...v] = kv.split('=');
        tags[k] = v.join('=').replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
      }
      rest = rest.slice(i + 1);
    }
    if (rest.startsWith('PING')) return this.ws?.send('PONG :tmi.twitch.tv');
    const m = rest.match(/^:([^ ]+) (\S+) ?(#\S+)? ?:?(.*)$/);
    if (!m) return;
    const [, prefix, cmd, , text] = m;
    if (cmd === '001') { this.retry = 0; this.status('on', this.authed ? 'Logado' : 'Somente leitura'); if (this.authed) this.connectEvents(); }
    else if (cmd === 'NOTICE' && /login|authentication/i.test(text)) this.status('error', text);
    else if (cmd === 'ROOMSTATE' && tags['room-id'] && this.roomId !== tags['room-id']) {
      this.roomId = tags['room-id'];
      this.load7tv();
    } else if (cmd === 'PRIVMSG') this.privmsg(prefix, tags, text);
    else if (cmd === 'CLEARMSG') this.emit('delete', { platform: 'twitch', id: tags['target-msg-id'] });
    else if (cmd === 'CLEARCHAT') this.emit('clear', { platform: 'twitch', user: text || null });
  }

  privmsg(prefix, tags, text) {
    let action = false;
    const m = text.match(/^\u0001ACTION (.*)\u0001$/);
    if (m) { text = m[1]; action = true; }
    this.emit('message', {
      id: tags.id,
      platform: 'twitch',
      user: tags['display-name'] || prefix.split('!')[0],
      login: prefix.split('!')[0],
      color: tags.color || null,
      badges: (tags.badges || '').split(',').map((b) => BADGES[b.split('/')[0]]).filter(Boolean),
      parts: this.parse(text, tags.emotes),
      text,
      action,
      bits: tags.bits ? Number(tags.bits) : 0,
      ts: Number(tags['tmi-sent-ts']) || Date.now(),
    });
  }

  parse(text, emotesTag) {
    const chars = Array.from(text);
    const ranges = [];
    if (emotesTag) {
      for (const e of emotesTag.split('/')) {
        const [id, pos] = e.split(':');
        for (const r of (pos || '').split(',')) {
          const [a, b] = r.split('-').map(Number);
          ranges.push({ a, b, id });
        }
      }
    }
    ranges.sort((x, y) => x.a - y.a);
    const parts = [];
    let cur = 0;
    for (const r of ranges) {
      if (r.a > cur) parts.push(...this.words(chars.slice(cur, r.a).join('')));
      parts.push({ t: 'emote', name: chars.slice(r.a, r.b + 1).join(''), url: `https://static-cdn.jtvnw.net/emoticons/v2/${r.id}/default/dark/2.0` });
      cur = r.b + 1;
    }
    if (cur < chars.length) parts.push(...this.words(chars.slice(cur).join('')));
    return parts;
  }

  // troca palavras que são emotes do 7TV
  words(str) {
    if (!this.emotes.size) return [{ t: 'text', v: str }];
    const out = [];
    let buf = '';
    for (const w of str.split(/(\s+)/)) {
      const url = this.emotes.get(w);
      if (url) {
        if (buf) out.push({ t: 'text', v: buf });
        buf = '';
        out.push({ t: 'emote', name: w, url });
      } else buf += w;
    }
    if (buf) out.push({ t: 'text', v: buf });
    return out;
  }

  async load7tv() {
    const add = (set) => (set?.emotes || []).forEach((e) => this.emotes.set(e.name, `https://cdn.7tv.app/emote/${e.id}/2x.webp`));
    try {
      add(await (await fetch('https://7tv.io/v3/emote-sets/global')).json());
      const u = await (await fetch(`https://7tv.io/v3/users/twitch/${this.roomId}`)).json();
      add(u.emote_set);
    } catch {}
  }

  async send(text) {
    if (!this.authed || this.ws?.readyState !== 1) throw new Error('Twitch: faça login para enviar mensagens');
    this.ws.send(`PRIVMSG #${this.channel} :${text}`);
    return {
      id: 'self-' + Date.now(), platform: 'twitch', user: cfg.data.tokens.twitch.name, color: '#9146ff', badges: [],
      parts: this.parse(text), text, ts: Date.now(), self: true,
    };
  }

  // ---- EventSub (resgates, follows, subs, bits, raids) via websocket: não precisa de URL pública ----
  closeEvents() {
    clearTimeout(this.evRt);
    if (this.evws) {
      const w = this.evws;
      this.evws = null;
      try { w.close(); } catch {}
    }
  }

  connectEvents(url = 'wss://eventsub.wss.twitch.tv/ws', resub = true) {
    if (!this.want || !this.authed) return;
    const old = this.evws;
    const ws = (this.evws = new WebSocket(url));
    ws.on('message', (buf) => {
      let m;
      try { m = JSON.parse(buf.toString()); } catch { return; }
      const type = m.metadata?.message_type;
      if (type === 'session_welcome') {
        if (old && old !== ws) try { old.close(); } catch {}
        if (resub) this.subscribeEvents(m.payload.session.id);
      } else if (type === 'session_reconnect') this.connectEvents(m.payload.session.reconnect_url, false);
      else if (type === 'notification') this.notification(m.metadata.subscription_type, m.payload.event, m.metadata.message_id);
    });
    ws.on('close', () => {
      if (ws !== this.evws) return;
      this.evRt = setTimeout(() => this.connectEvents(), 5000);
    });
    ws.on('error', () => {});
  }

  async subscribeEvents(sessionId) {
    const id = cfg.data.tokens.twitch.userId;
    const subs = [
      ['channel.channel_points_custom_reward_redemption.add', 1, { broadcaster_user_id: id }],
      ['channel.follow', 2, { broadcaster_user_id: id, moderator_user_id: id }],
      ['channel.subscribe', 1, { broadcaster_user_id: id }],
      ['channel.subscription.message', 1, { broadcaster_user_id: id }],
      ['channel.subscription.gift', 1, { broadcaster_user_id: id }],
      ['channel.cheer', 1, { broadcaster_user_id: id }],
      ['channel.raid', 1, { to_broadcaster_user_id: id }],
    ];
    let failed = 0;
    for (const [type, version, condition] of subs) {
      try {
        await this.api('/eventsub/subscriptions', {
          method: 'POST',
          body: JSON.stringify({ type, version, condition, transport: { method: 'websocket', session_id: sessionId } }),
        });
      } catch { failed++; }
    }
    if (failed) this.status('on', 'Logado · alguns eventos sem permissão (refaça o login)');
  }

  notification(type, e, mid) {
    const out = (o) => this.emit('message', makeEvent('twitch', { id: mid, ...o }));
    if (type === 'channel.channel_points_custom_reward_redemption.add') {
      out({ ev: 'redeem', user: e.user_name, label: 'resgatou', title: e.reward.title, amount: e.reward.cost + ' pts', detail: e.user_input });
    } else if (type === 'channel.follow') out({ ev: 'follow', user: e.user_name, label: 'seguiu o canal' });
    else if (type === 'channel.subscribe') {
      out({ ev: 'sub', user: e.user_name, label: e.is_gift ? 'ganhou um sub de presente' : 'se inscreveu', amount: tier(e.tier) });
    } else if (type === 'channel.subscription.message') {
      out({ ev: 'sub', user: e.user_name, label: `renovou (${e.cumulative_months} meses)`, amount: tier(e.tier), detail: e.message?.text });
    } else if (type === 'channel.subscription.gift') {
      out({ ev: 'gift', user: e.is_anonymous ? 'Anônimo' : e.user_name, label: `presenteou ${e.total} sub${e.total > 1 ? 's' : ''}`, amount: tier(e.tier) });
    } else if (type === 'channel.cheer') {
      out({ ev: 'cheer', user: e.is_anonymous ? 'Anônimo' : e.user_name, label: 'enviou', amount: e.bits + ' bits', detail: e.message });
    } else if (type === 'channel.raid') {
      out({ ev: 'raid', user: e.from_broadcaster_user_name, label: `fez raid com ${e.viewers} pessoas` });
    }
  }

  async getViewers() {
    const id = cfg.data.tokens.twitch?.userId;
    if (!id) return null;
    const j = await this.api(`/streams?user_id=${id}`);
    const s = j.data?.[0];
    return { live: !!s, count: s ? s.viewer_count : 0 };
  }

  // ---- Helix ----
  async api(path, opts = {}) {
    const token = await getToken('twitch');
    if (!token) throw new Error('Twitch: faça login primeiro');
    const r = await fetch('https://api.twitch.tv/helix' + path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': cfg.data.apps.twitch.clientId, 'Content-Type': 'application/json' },
    });
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || `Twitch HTTP ${r.status}`);
    return j;
  }

  async getInfo() {
    const id = cfg.data.tokens.twitch?.userId;
    const c = (await this.api(`/channels?broadcaster_id=${id}`)).data?.[0];
    return { title: c.title, game: c.game_name, gameId: c.game_id };
  }

  async setInfo({ title, gameId }) {
    const body = {};
    if (title) body.title = title;
    if (gameId) body.game_id = String(gameId);
    await this.api(`/channels?broadcaster_id=${cfg.data.tokens.twitch.userId}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async categories(q) {
    const j = await this.api(`/search/categories?first=8&query=${encodeURIComponent(q)}`);
    return j.data.map((c) => ({ id: c.id, name: c.name, img: c.box_art_url.replace('{width}x{height}', '104x144') }));
  }
}

module.exports = new Twitch();
