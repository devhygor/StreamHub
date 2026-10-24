// Leitura do chat ao vivo do YouTube pelo mesmo endpoint que o site usa (youtubei).
// Não gasta cota da API oficial e não precisa de login: basta o ID do vídeo da live.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// aceita ID puro, youtu.be/ID, youtube.com/watch?v=ID, /live/ID
function parseVideoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})|\/(?:live|embed|shorts)\/([\w-]{11})/);
  return m ? m[1] || m[2] || m[3] : '';
}

function nextContinuation(list) {
  for (const c of list || []) {
    const d = c.invalidationContinuationData || c.timedContinuationData || c.reloadContinuationData;
    if (d?.continuation) return { token: d.continuation, wait: d.timeoutMs || 5000 };
  }
  return null;
}

async function init(videoId) {
  const r = await fetch(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' },
  });
  const html = await r.text();
  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const version = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1] || '2.20240101.00.00';
  const m = html.match(/(?:window\["ytInitialData"\]|var ytInitialData)\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!key || !m) throw new Error('Chat do YouTube indisponível para este vídeo');
  const data = JSON.parse(m[1]);
  const lc = data.contents?.liveChatRenderer;
  if (!lc) throw new Error('Esse vídeo não tem chat ao vivo (ou ele já terminou)');
  return { key, version, actions: lc.actions || [], cont: nextContinuation(lc.continuations) };
}

const runsToParts = (runs = []) =>
  runs.map((r) => {
    if (r.emoji) {
      const e = r.emoji;
      const thumbs = e.image?.thumbnails || [];
      if (e.isCustomEmoji && thumbs.length) {
        return { t: 'emote', name: e.shortcuts?.[0] || e.emojiId || 'emoji', url: thumbs[thumbs.length - 1].url };
      }
      return { t: 'text', v: e.emojiId || '' };
    }
    return { t: 'text', v: r.text || '' };
  });

const plain = (runs = []) => runs.map((r) => r.text || r.emoji?.shortcuts?.[0] || r.emoji?.emojiId || '').join('');

function badgesOf(rd) {
  const out = [];
  for (const b of rd.authorBadges || []) {
    const x = b.liveChatAuthorBadgeRenderer;
    const t = x?.icon?.iconType;
    if (t === 'OWNER') out.push('broadcaster');
    else if (t === 'MODERATOR') out.push('mod');
    else if (x?.customThumbnail) out.push('sub'); // membro do canal
  }
  return out;
}

// transforma uma ação do chat em { message } | { event } | { delete }
function parseAction(a) {
  const del = a.removeChatItemAction?.targetItemId || a.markChatItemAsDeletedAction?.targetItemId;
  if (del) return { delete: del };
  const item = a.addChatItemAction?.item;
  if (!item) return null;

  const tx = item.liveChatTextMessageRenderer || item.liveChatPaidMessageRenderer || item.liveChatPaidStickerRenderer;
  if (tx) {
    const parts = runsToParts(tx.message?.runs);
    const paid = tx.purchaseAmountText?.simpleText || null;
    return {
      message: {
        id: tx.id,
        platform: 'youtube',
        user: tx.authorName?.simpleText || 'Anônimo',
        login: tx.authorExternalChannelId,
        color: null,
        avatar: tx.authorPhoto?.thumbnails?.[0]?.url,
        badges: badgesOf(tx),
        parts: parts.length ? parts : [{ t: 'text', v: paid ? '' : '' }],
        text: plain(tx.message?.runs),
        superchat: paid,
        ts: Math.floor(Number(tx.timestampUsec) / 1000) || Date.now(),
      },
    };
  }
  const mem = item.liveChatMembershipItemRenderer;
  if (mem) {
    const sub = plain(mem.headerSubtext?.runs);
    const prim = plain(mem.headerPrimaryText?.runs);
    return {
      event: {
        id: mem.id,
        ev: 'member',
        user: mem.authorName?.simpleText,
        label: prim ? `completou: ${prim}` : 'virou membro',
        title: prim ? '' : sub,
        detail: plain(mem.message?.runs),
      },
    };
  }
  const gift = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
  if (gift) {
    const h = gift.header?.liveChatSponsorshipsHeaderRenderer;
    return {
      event: { id: gift.id, ev: 'gift', user: h?.authorName?.simpleText, label: plain(h?.primaryText?.runs).replace(/^Sent /i, 'enviou ') || 'presenteou assinaturas' },
    };
  }
  return null;
}

// Quantos assistem agora (mesmo endpoint que o site usa; sem cota). Devolve { live, count }.
let meta = null;
async function viewers(videoId) {
  if (!meta || meta.videoId !== videoId) {
    const st = await init(videoId).catch(() => null);
    if (!st) throw new Error('sem acesso ao vídeo');
    meta = { videoId, key: st.key, version: st.version };
  }
  const r = await fetch(`https://www.youtube.com/youtubei/v1/updated_metadata?key=${meta.key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: meta.version, hl: 'pt-BR' } }, videoId }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const v = j.actions?.find((a) => a.updateViewershipAction)?.updateViewershipAction?.viewCount?.videoViewCountRenderer;
  if (!v) return { live: false, count: 0 };
  return { live: !!v.isLive, count: Number(v.originalViewCount || 0) };
}

// Lê o chat até `shouldStop()` ou até dar erro. Chama onMessage / onEvent / onDelete.
async function run(videoId, { onMessage, onEvent, onDelete, onOpen, shouldStop }) {
  const st = await init(videoId);
  let cont = st.cont;
  let first = true;
  onOpen?.();
  const handle = (actions, skipOld) => {
    const list = skipOld ? actions.slice(-20) : actions;
    for (const a of list) {
      const p = parseAction(a);
      if (!p) continue;
      if (p.message) onMessage(p.message);
      else if (p.event) onEvent(p.event);
      else if (p.delete) onDelete(p.delete);
    }
  };
  handle(st.actions, true);
  first = false;
  while (cont && !shouldStop()) {
    await sleep(Math.min(Math.max(cont.wait, 1500), 8000));
    if (shouldStop()) return;
    const r = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${st.key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: st.version, hl: 'pt-BR' } }, continuation: cont.token }),
    });
    if (!r.ok) throw new Error(`Chat do YouTube respondeu HTTP ${r.status}`);
    const j = await r.json();
    const lc = j.continuationContents?.liveChatContinuation;
    if (!lc) throw new Error('O chat da live terminou');
    handle(lc.actions || [], false);
    cont = nextContinuation(lc.continuations);
  }
  if (!cont) throw new Error('O chat da live terminou');
}

module.exports = { run, parseVideoId, viewers };
