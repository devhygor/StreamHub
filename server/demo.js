// Gera mensagens falsas para testar o visual sem estar ao vivo
const USERS = [
  ['twitch', 'NeoPixel', '#ff6b6b', ['sub']], ['twitch', 'GabiPlays', '#4dd0e1', ['mod']],
  ['twitch', 'ze_do_pao', '#ffd166', []], ['twitch', 'LunaVoid', '#c792ea', ['vip', 'sub']],
  ['kick', 'KickDaMassa', '#53fc18', []], ['kick', 'Bruxo_BR', '#ff9f43', ['sub']],
  ['kick', 'tiaDoCafe', '#7bed9f', ['mod']], ['youtube', 'Marcos Silva', null, []],
  ['youtube', 'Ana Beatriz', null, ['sub']], ['youtube', 'CanalDoTeco', null, []],
];
const TEXTS = [
  'boa noite chat!', 'que jogada foi essa kkkkk', 'primeira vez aqui, curti a live', 'GG GG GG',
  'alguém sabe qual a build?', 'esse boss é injusto demais', 'salve salve', 'manda o setup!',
  'eita, quase', 'clipa isso agora', 'hoje vai ter vitória?', 'LUL', 'F no chat pelo run',
  'qual o nome dessa música?', 'tá voando hoje 🔥', 'amei o overlay novo',
];
let timer = null;
let n = 0;

const EVENTS = [
  ['twitch', 'redeem', 'LunaVoid', 'resgatou', 'Hidratar!', '500 pts', ''],
  ['twitch', 'follow', 'NeoPixel', 'seguiu o canal', '', '', ''],
  ['twitch', 'sub', 'GabiPlays', 'renovou (7 meses)', '', 'Tier 1', 'melhor live!'],
  ['twitch', 'cheer', 'ze_do_pao', 'enviou', '', '100 bits', 'toma'],
  ['twitch', 'raid', 'CanalAmigo', 'fez raid com 42 pessoas', '', '', ''],
  ['kick', 'redeem', 'Bruxo_BR', 'resgatou', 'Escolher a música', '1000 pts', 'Linkin Park'],
  ['kick', 'gift', 'tiaDoCafe', 'presenteou 5 subs', '', '', ''],
  ['kick', 'kicks', 'KickDaMassa', 'enviou Rage', '', '50 Kicks', ''],
  ['youtube', 'member', 'Ana Beatriz', 'virou membro', 'Nível 1', '', ''],
];
let vt = null;

function start(push, setViewers) {
  stop();
  if (setViewers) {
    let a = 120, b = 45, c = 80;
    const upd = () => { a += Math.round(Math.random() * 10 - 5); b += Math.round(Math.random() * 6 - 3); c += Math.round(Math.random() * 8 - 4); setViewers({ twitch: { live: true, count: a }, kick: { live: true, count: b }, youtube: { live: true, count: c } }); };
    upd();
    vt = setInterval(upd, 4000);
  }
  const tick = () => {
    const [platform, user, color, badges] = USERS[Math.floor(Math.random() * USERS.length)];
    const text = TEXTS[Math.floor(Math.random() * TEXTS.length)];
    push({
      id: 'demo-' + Date.now() + '-' + n++, platform, user, login: user.toLowerCase(), color, badges,
      parts: [{ t: 'text', v: text }], text, ts: Date.now(), demo: true,
      superchat: platform === 'youtube' && Math.random() < 0.06 ? 'R$ 10,00' : null,
    });
    if (Math.random() < 0.12) {
      const [pl, ev, user, label, title, amount, detail] = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      push({ id: 'demo-ev-' + Date.now() + '-' + n++, kind: 'event', platform: pl, ev, user, label, title, amount, detail, text: user + ' ' + label, badges: [], parts: [], ts: Date.now() });
    }
    timer = setTimeout(tick, 500 + Math.random() * 2200);
  };
  tick();
}

function stop() {
  clearInterval(vt);
  vt = null;
  clearTimeout(timer);
  timer = null;
}

module.exports = { start, stop };
