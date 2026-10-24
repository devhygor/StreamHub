// Consulta periodicamente quantas pessoas assistem em cada plataforma
const cfg = require('./config');

const EVERY = { twitch: 30e3, kick: 30e3, youtube: 60e3 }; // YouTube gasta cota: menos vezes

module.exports = function startViewers(platforms, onChange) {
  const state = {}; // plataforma -> { live, count } | null
  const timers = {};

  async function poll(name) {
    if (!cfg.data.tokens[name]) {
      if (state[name] !== null && name in state) { state[name] = null; onChange(state); }
      return;
    }
    let v = null;
    try { v = await platforms[name].getViewers(); } catch {}
    const prev = state[name];
    state[name] = v;
    if (JSON.stringify(prev) !== JSON.stringify(v)) onChange(state);
  }

  for (const name of Object.keys(EVERY)) {
    poll(name);
    timers[name] = setInterval(() => poll(name), EVERY[name]);
  }

  return { state, refresh: (name) => setTimeout(() => poll(name), 3000) };
};
