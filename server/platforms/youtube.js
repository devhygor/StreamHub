const EventEmitter = require('events');
const cfg = require('../config');
const { getToken } = require('../auth');
const { makeEvent } = require('../events');
const chat = require('./youtube-chat');

const API = 'https://www.googleapis.com/youtube/v3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clean = (m) => String(m).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const isQuota = (m) => /quota|exceeded/i.test(m);

// O chat é lido pelo endpoint público do site (sem gastar cota da API).
// A API oficial só serve para achar a live, mudar o título e enviar mensagens.
class YouTube extends EventEmitter {
  constructor() {
    super();
    this.name = 'youtube';
    this.want = false;
    this.run = 0; // id da execução atual (invalida loops antigos)
    this.broadcast = null;
    this.quotaUntil = 0;
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
    if (!r.ok) {
      const msg = clean(j.error?.message || `YouTube HTTP ${r.status}`);
      if (isQuota(msg)) this.quotaUntil = Date.now() + 30 * 60e3;
      throw new Error(msg);
    }
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

  manualVideoId() {
    return chat.parseVideoId(cfg.data.channels.youtube.videoId);
  }

  async connect() {
    this.want = true;
    const run = ++this.run;
    const alive = () => this.want && run === this.run;
    if (!cfg.data.tokens.youtube && !this.manualVideoId()) return this.status('off', 'Faça login no YouTube ou informe o link da live');
    this.status('connecting');

    while (alive()) {
      let videoId = '';
      let title = '';
      try {
        // 1) detecção automática pela API (quando há login e cota)
        if (cfg.data.tokens.youtube && Date.now() >= this.quotaUntil) {
          try {
            this.broadcast = await this.findBroadcast();
            if (!this.broadcast && !this.manualVideoId()) {
              this.status('connecting', 'Nenhuma live ativa ou agendada. Nova tentativa em 30s...');
              await sleep(30000);
              continue;
            }
            if (this.broadcast) {
              title = this.broadcast.snippet.title;
              if (!this.isLive(this.broadcast)) {
                this.status('connecting', `Aguardando a live começar no YouTube · ${title}`);
                await sleep(60000);
                continue;
              }
              videoId = this.broadcast.id;
            }
          } catch (e) {
            if (!isQuota(clean(e.message))) throw e;
          }
        }
        // 2) reserva: link/ID informado manualmente (não depende da API)
        if (!videoId) videoId = this.manualVideoId();
        if (!videoId) {
          this.status('error', 'Cota diária da API do YouTube esgotada (renova de madrugada, ~4h). Informe o link da live em Contas para ler o chat sem a API.');
          await sleep(5 * 60e3);
          continue;
        }
        await chat.run(videoId, {
          shouldStop: () => !alive(),
          onOpen: () => { this.videoId = videoId; this.status('on', title ? `Ao vivo · ${title}` : `Lendo o chat da live ${videoId}`); },
          onMessage: (m) => this.emit('message', m),
          onEvent: (e) => this.emit('message', makeEvent('youtube', e)),
          onDelete: (id) => this.emit('delete', { platform: 'youtube', id }),
        });
      } catch (e) {
        if (!alive()) return;
        this.status('error', clean(e.message));
        await sleep(15000);
      }
    }
  }

  disconnect() {
    this.want = false;
    this.run++;
    this.videoId = null;
    this.status('off');
  }

  async send(text) {
    const b = this.broadcast || (await this.findBroadcast());
    if (!b) throw new Error('YouTube: sem live ativa');
    this.broadcast = b;
    await this.api('/liveChat/messages?part=snippet', {
      method: 'POST',
      body: JSON.stringify({ snippet: { liveChatId: b.snippet.liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text } } }),
    });
    return null;
  }

  async getViewers() {
    // preferência: endpoint do site (sem cota); a API oficial fica de reserva
    if (this.videoId && this.state === 'on') {
      try { return await chat.viewers(this.videoId); } catch {}
    }
    if (!this.broadcast || Date.now() < this.quotaUntil) return null;
    const j = await this.api(`/videos?part=liveStreamingDetails&id=${this.broadcast.id}`);
    const d = j.items?.[0]?.liveStreamingDetails;
    const live = !!d?.actualStartTime && !d?.actualEndTime;
    return { live, count: live ? Number(d.concurrentViewers || 0) : 0 };
  }

  async getInfo() {
    const b = this.broadcast || (await this.findBroadcast());
    if (!b) throw new Error('YouTube: nenhuma live ativa ou agendada');
    this.broadcast = b;
    return { title: b.snippet.title, game: null, gameId: null };
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

module.exports = new YouTube();
