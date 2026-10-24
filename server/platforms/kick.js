const crypto = require('crypto');
const EventEmitter = require('events');
const cfg = require('../config');
const { getToken } = require('../auth');
const { makeEvent } = require('../events');

const EVENTS = [
  'chat.message.sent',
  'channel.followed',
  'channel.subscription.new',
  'channel.subscription.renewal',
  'channel.subscription.gifts',
  'channel.reward.redemption.updated',
  'kicks.gifted',
];

const API = 'https://api.kick.com/public/v1';
const BADGES = { broadcaster: 'broadcaster', moderator: 'mod', vip: 'vip', subscriber: 'sub', founder: 'sub', og: 'vip', sub_gifter: 'sub' };

// O chat da Kick chega por webhook oficial (POST /webhooks/kick), então o servidor
// precisa estar acessível por uma URL pública https.
class Kick extends EventEmitter {
  constructor() {
    super();
    this.name = 'kick';
    this.want = false;
    this.seen = new Set();
    this.key = null;
    this.keyAt = 0;
  }

  status(state, detail = '') {
    this.state = state;
    this.emit('status', { platform: 'kick', state, detail });
  }

  webhookUrl() {
    return `${cfg.publicUrl()}/webhooks/kick`;
  }

  async connect() {
    this.want = true;
    if (!cfg.data.tokens.kick) return this.status('off', 'Faça login na Kick');
    if (!cfg.publicUrl().startsWith('https://')) {
      return this.status('error', 'Chat da Kick exige o servidor com URL pública https (VPS)');
    }
    this.status('connecting');
    try {
      const list = await this.api('/events/subscriptions');
      const have = new Set((list.data || []).map((s) => s.event));
      const missing = EVENTS.filter((e) => !have.has(e));
      let detail = 'Webhook ativo';
      if (missing.length) {
        const r = await this.api('/events/subscriptions', {
          method: 'POST',
          body: JSON.stringify({ events: missing.map((name) => ({ name, version: 1 })), method: 'webhook' }),
        });
        const errs = (r.data || []).filter((d) => d.error);
        if (errs.some((d) => d.name === 'chat.message.sent')) throw new Error(errs[0].error);
        if (errs.length) detail += ' · alguns eventos sem permissão (refaça o login)';
      }
      this.status('on', detail);
    } catch (e) {
      this.status('error', e.message);
    }
  }

  disconnect() {
    this.want = false;
    this.status('off');
  }

  async publicKey(force) {
    if (!force && this.key && Date.now() - this.keyAt < 3600e3) return this.key;
    const r = await fetch(`${API}/public-key`);
    const t = await r.text();
    let pem = t;
    try { pem = JSON.parse(t).data.public_key; } catch {}
    this.key = pem;
    this.keyAt = Date.now();
    return pem;
  }

  async verify(req) {
    const id = req.get('Kick-Event-Message-Id');
    const ts = req.get('Kick-Event-Message-Timestamp');
    const sig = req.get('Kick-Event-Signature');
    if (!id || !ts || !sig) return false;
    const data = Buffer.from(`${id}.${ts}.${req.body.toString('utf8')}`);
    const sigBuf = Buffer.from(sig, 'base64');
    for (const force of [false, true]) {
      try {
        if (crypto.verify('RSA-SHA256', data, await this.publicKey(force), sigBuf)) return true;
      } catch {}
    }
    return false;
  }

  // handler do express (corpo cru, para a assinatura bater)
  async webhook(req, res) {
    if (!(await this.verify(req))) return res.sendStatus(403);
    res.sendStatus(200);
    if (!this.want) return;
    const id = req.get('Kick-Event-Message-Id');
    if (this.seen.has(id)) return;
    this.seen.add(id);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
    const type = req.get('Kick-Event-Type');
    try {
      const d = JSON.parse(req.body.toString('utf8'));
      if (type === 'chat.message.sent') this.message(d);
      else this.event(type, d, id);
    } catch {}
  }

  event(type, d, id) {
    const out = (o) => this.emit('message', makeEvent('kick', { id, ...o }));
    const months = (n) => (n ? ` (${n} ${n > 1 ? 'meses' : 'mês'})` : '');
    if (type === 'channel.followed') out({ ev: 'follow', user: d.follower?.username, label: 'seguiu o canal' });
    else if (type === 'channel.subscription.new') out({ ev: 'sub', user: d.subscriber?.username, label: 'se inscreveu' + months(d.duration) });
    else if (type === 'channel.subscription.renewal') out({ ev: 'sub', user: d.subscriber?.username, label: 'renovou' + months(d.duration) });
    else if (type === 'channel.subscription.gifts') {
      const n = d.giftees?.length || 1;
      out({ ev: 'gift', user: d.gifter?.username, label: `presenteou ${n} sub${n > 1 ? 's' : ''}` });
    } else if (type === 'channel.reward.redemption.updated') {
      if (d.status === 'rejected') return;
      out({ ev: 'redeem', user: d.redeemer?.username, label: 'resgatou', title: d.reward?.title, amount: d.reward?.cost != null ? d.reward.cost + ' pts' : '', detail: d.user_input });
    } else if (type === 'kicks.gifted') {
      out({ ev: 'kicks', user: d.sender?.username, label: 'enviou ' + (d.gift?.name || 'Kicks'), amount: d.gift?.amount != null ? d.gift.amount + ' Kicks' : '', detail: d.gift?.message });
    }
  }

  async getViewers() {
    const c = (await this.api('/channels')).data?.[0];
    return { live: !!c?.stream?.is_live, count: c?.stream?.viewer_count || 0 };
  }

  message(d) {
    const parts = [];
    const re = /\[emote:(\d+):([^\]]+)\]/g;
    let last = 0, m;
    const c = d.content || '';
    while ((m = re.exec(c))) {
      if (m.index > last) parts.push({ t: 'text', v: c.slice(last, m.index) });
      parts.push({ t: 'emote', name: m[2], url: `https://files.kick.com/emotes/${m[1]}/fullsize` });
      last = re.lastIndex;
    }
    if (last < c.length) parts.push({ t: 'text', v: c.slice(last) });
    const s = d.sender || {};
    const badges = (s.identity?.badges || []).map((b) => BADGES[b.type]).filter(Boolean);
    if (d.broadcaster?.user_id && d.broadcaster.user_id === s.user_id) badges.unshift('broadcaster');
    this.emit('message', {
      id: d.message_id,
      platform: 'kick',
      user: s.username,
      login: s.channel_slug,
      color: s.identity?.username_color || null,
      badges: [...new Set(badges)],
      parts,
      text: c.replace(/\[emote:\d+:([^\]]+)\]/g, '$1'),
      ts: d.created_at ? Date.parse(d.created_at) : Date.now(),
    });
  }

  async api(path, opts = {}) {
    const token = await getToken('kick');
    if (!token) throw new Error('Kick: faça login primeiro');
    const r = await fetch(API + path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || `Kick HTTP ${r.status}`);
    return j;
  }

  async send(text) {
    await this.api('/chat', {
      method: 'POST',
      body: JSON.stringify({ broadcaster_user_id: Number(cfg.data.tokens.kick.userId), content: text, type: 'user' }),
    });
    return null; // a mensagem volta pelo webhook
  }

  async getInfo() {
    const c = (await this.api('/channels')).data?.[0];
    return { title: c.stream_title, game: c.category?.name, gameId: c.category?.id };
  }

  async setInfo({ title, gameId }) {
    const body = {};
    if (title) body.stream_title = title;
    if (gameId) body.category_id = Number(gameId);
    await this.api('/channels', { method: 'PATCH', body: JSON.stringify(body) });
  }

  async categories(q) {
    const j = await this.api(`/categories?q=${encodeURIComponent(q)}`);
    return (j.data || []).slice(0, 8).map((c) => ({ id: c.id, name: c.name, img: c.thumbnail }));
  }
}

module.exports = new Kick();
