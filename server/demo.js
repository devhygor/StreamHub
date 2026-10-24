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

function start(push) {
  stop();
  const tick = () => {
    const [platform, user, color, badges] = USERS[Math.floor(Math.random() * USERS.length)];
    const text = TEXTS[Math.floor(Math.random() * TEXTS.length)];
    push({
      id: 'demo-' + Date.now() + '-' + n++, platform, user, login: user.toLowerCase(), color, badges,
      parts: [{ t: 'text', v: text }], text, ts: Date.now(), demo: true,
      superchat: platform === 'youtube' && Math.random() < 0.06 ? 'R$ 10,00' : null,
    });
    timer = setTimeout(tick, 500 + Math.random() * 2200);
  };
  tick();
}

function stop() {
  clearTimeout(timer);
  timer = null;
}

module.exports = { start, stop };
