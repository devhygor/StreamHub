const EventEmitter = require('events');
const cfg = require('../config');
const { getToken } = require('../auth');
const { makeEvent } = require('../events');

const API = 'https://www.googleapis.com/youtube/v3';

class YouTube extends EventEmitter {
  constructor() {
    super();
    this.name = 'youtube';
    this.want = false;
    this.run = 0; // id da execução atual (invalida loops antigos)
    this.liveChatId = null;
    this.broadcast = null;
  }

  status(state, detail = '') {
    this.state = state;
    this.emit('status', { platform: 'youtube', state, detail });
  }

  async api(path, opts = {}) {
    const token = await getToken('youtube');
    if (!token) throw new Error('YouTube: faça login primeiro');
    const r = await fetch(API + path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `YouTube HTTP ${r.status}`);
    return j;
  }

  // procura a live ativa (ou a próxima agendada) da conta
  async findBroadcast() {
    for (const s of ['active', 'upcoming']) {
      const j = await this.api(`/liveBroadcasts?part=snippet,status&broadcastStatus=${s}&maxResults=5`);
      const b = j.items?.find((i) => i.snippet.liveChatId);
      if (b) return b;
    }
    return null;
  }

  isLive(b) {
    return ['live', 'liveStarting'].includes(b?.status?.lifeCycleStatus);
  }

  async connect() {
    this.want = true;
    const run = ++this.run;
    if (!cfg.data.tokens.youtube) return this.status('off', 'Faça login no YouTube');
    this.status('connecting');
    let pageToken = '';
    let first = true;
    while (this.want && run === this.run) {
      try {
        if (!this.liveChatId) {
          this.broadcast = await this.findBroadcast();
          if (!this.broadcast) {
            this.status('connecting', 'Nenhuma live ativa ou agendada. Nova tentativa em 30s...');
            await sleep(30000);
            continue;
          }
          // live agendada ainda não começou: só confere de novo a cada 60s (não gasta cota com chat vazio)
          if (!this.isLive(this.broadcast)) {
            this.status('connecting', `Aguardando a live começar no YouTube · ${this.broadcast.snippet.title}`);
            await sleep(60000);
            continue;
          }
          this.liveChatId = this.broadcast.snippet.liveChatId;
          pageToken = '';
          first = true;
        }
        const q = new URLSearchParams({ liveChatId: this.liveChatId, part: 'snippet,authorDetails', maxResults: '200' });
        if (pageToken) q.set('pageToken', pageToken);
        const j = await this.api('/liveChat/messages?' + q);
        pageToken = j.nextPageToken;
        this.status('on', `Ao vivo · ${this.broadcast?.snippet.title || ''}`);
        // na primeira leitura só mostramos as últimas mensagens para não despejar histórico
        const items = first ? j.items.slice(-20) : j.items;
        first = false;
        items.forEach((i) => this.item(i));
        const wait = Math.max(j.pollingIntervalMillis || 5000, cfg.data.settings.youtubeMinPollSeconds * 1000);
        await sleep(wait);
      } catch (e) {
        const msg = String(e.message);
        if (/ended|not found|liveChatId|disabled/i.test(msg)) this.liveChatId = null;
        this.status('error', msg);
        await sleep(/quota/i.test(msg) ? 600000 : 15000);
      }
    }
  }

  item(i) {
    const s = i.snippet;
    const a = i.authorDetails;
    let text = s.displayMessage || s.textMessageDetails?.messageText || '';
    const ev = (o) => this.emit('message', makeEvent('youtube', { id: i.id, user: a.displayName, ...o }));
    if (s.type === 'newSponsorEvent') return ev({ ev: 'member', label: 'virou membro', title: s.newSponsorDetails?.memberLevelName });
    if (s.type === 'memberMilestoneChatEvent') {
      const d = s.memberMilestoneChatDetails || {};
      return ev({ ev: 'member', label: `completou ${d.memberMonth} meses de membro`, title: d.memberLevelName, detail: d.userComment });
    }
    if (s.type === 'membershipGiftingEvent') {
      const n = s.membershipGiftingDetails?.giftMembershipsCount || 1;
      return ev({ ev: 'gift', label: `presenteou ${n} assinatura${n > 1 ? 's' : ''}` });
    }
    if (s.type !== 'textMessageEvent' && s.type !== 'superChatEvent' && s.type !== 'superStickerEvent') return;
    const badges = [];
    if (a.isChatOwner) badges.push('broadcaster');
    if (a.isChatModerator) badges.push('mod');
    if (a.isChatSponsor) badges.push('sub');
    this.emit('message', {
      id: i.id,
      platform: 'youtube',
      user: a.displayName,
      login: a.channelId,
      color: null,
      avatar: a.profileImageUrl,
      badges,
      parts: [{ t: 'text', v: text }],
      text,
      superchat: s.superChatDetails?.amountDisplayString || s.superStickerDetails?.amountDisplayString || null,
      ts: Date.parse(s.publishedAt) || Date.now(),
    });
  }

  disconnect() {
    this.want = false;
    this.run++;
    this.liveChatId = null;
    this.status('off');
  }

  async send(text) {
    if (!this.liveChatId) throw new Error('YouTube: sem live ativa');
    await this.api('/liveChat/messages?part=snippet', {
      method: 'POST',
      body: JSON.stringify({ snippet: { liveChatId: this.liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text } } }),
    });
    return null;
  }

  async getInfo() {
    const b = this.broadcast || (await this.findBroadcast());
    if (!b) throw new Error('YouTube: nenhuma live ativa ou agendada');
    this.broadcast = b;
    return { title: b.snippet.title, game: null, gameId: null };
  }

  async getViewers() {
    if (!this.broadcast) return null;
    const j = await this.api(`/videos?part=liveStreamingDetails&id=${this.broadcast.id}`);
    const d = j.items?.[0]?.liveStreamingDetails;
    const live = !!d?.actualStartTime && !d?.actualEndTime;
    return { live, count: live ? Number(d.concurrentViewers || 0) : 0 };
  }

  // A API do YouTube não permite definir "jogo" — só título
  async setInfo({ title }) {
    if (!title) return;
    const b = this.broadcast || (await this.findBroadcast());
    if (!b) throw new Error('YouTube: nenhuma live ativa ou agendada');
    const sn = b.snippet;
    await this.api('/liveBroadcasts?part=snippet', {
      method: 'PUT',
      body: JSON.stringify({
        id: b.id,
        snippet: { title, description: sn.description, scheduledStartTime: sn.scheduledStartTime },
      }),
    });
    b.snippet.title = title;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = new YouTube();
