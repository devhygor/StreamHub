// Evento normalizado (resgate, follow, sub, bits, raid...) que aparece no chat unificado.
let n = 0;

function makeEvent(platform, { id, ev, user, label, title = '', amount = '', detail = '' }) {
  return {
    id: id || `ev-${platform}-${Date.now()}-${n++}`,
    kind: 'event',
    platform,
    ev, // redeem | follow | sub | gift | cheer | raid | member | kicks
    user: user || 'Anônimo',
    label,
    title,
    amount,
    detail,
    text: [user, label, title, amount, detail].filter(Boolean).join(' '),
    badges: [],
    parts: [],
    ts: Date.now(),
  };
}

const tier = (t) => ({ 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3' }[t] || '');

module.exports = { makeEvent, tier };
