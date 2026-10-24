// Renderização de mensagens compartilhada entre o painel e o overlay do OBS
window.Chat = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  const LOGOS = {
    twitch: '<path fill-rule="evenodd" d="M4 2h17v12l-5 5h-4l-3 3H7v-3H3V6z M11 6h2v6h-2z M16 6h2v6h-2z"/>',
    kick: '<path d="M5 3h5v6l5-6h5l-6 8 6 10h-5.5L10 14v7H5z"/>',
    youtube: '<path fill-rule="evenodd" d="M3 7.5C3 6 4 5 5.5 5h13C20 5 21 6 21 7.5v9c0 1.5-1 2.5-2.5 2.5h-13C4 19 3 18 3 16.5z M10 9.5v5l4.5-2.5z"/>',
  };

  function logo(platform) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'plogo p-' + platform);
    s.innerHTML = LOGOS[platform] || '';
    return s;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function shouldShow(m, st, filters) {
    if (filters && filters.hidden && filters.hidden.has(m.platform)) return false;
    if (st.hideCommands && m.text.startsWith('!')) return false;
    const u = (m.login || m.user || '').toLowerCase();
    if ((st.hiddenUsers || []).some((h) => h.toLowerCase() === u || h.toLowerCase() === (m.user || '').toLowerCase())) return false;
    return true;
  }

  function isHighlight(m, st) {
    const t = m.text.toLowerCase();
    return (st.highlightWords || []).some((w) => w && t.includes(w.toLowerCase()));
  }

  const BADGE_LABEL = { broadcaster: 'LIVE', mod: 'MOD', vip: 'VIP', sub: 'SUB' };

  function render(m, st) {
    const row = el('div', 'msg plat-' + m.platform);
    row.dataset.id = m.id;
    row.dataset.user = (m.login || m.user || '').toLowerCase();
    if (m.superchat) row.classList.add('super');
    if (m.action) row.classList.add('action');
    if (m.self) row.classList.add('self');
    if (isHighlight(m, st)) row.classList.add('hl');

    row.appendChild(logo(m.platform));
    const body = el('div', 'body');

    if (st.showTimestamps) {
      body.appendChild(el('span', 'time', new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    }
    if (st.showBadges !== false) {
      for (const b of m.badges || []) body.appendChild(el('span', 'badge b-' + b, BADGE_LABEL[b]));
    }
    const name = el('span', 'name', m.user);
    if (m.color) name.style.color = m.color;
    body.appendChild(name);
    if (m.superchat) body.appendChild(el('span', 'amount', m.superchat));
    body.appendChild(el('span', 'sep', m.action ? '' : ':'));

    const text = el('span', 'text');
    for (const p of m.parts) {
      if (p.t === 'emote') {
        const img = el('img', 'emote');
        img.src = p.url;
        img.alt = p.name;
        img.title = p.name;
        img.loading = 'lazy';
        text.appendChild(img);
      } else text.appendChild(document.createTextNode(p.v));
    }
    body.appendChild(text);
    row.appendChild(body);
    return row;
  }

  return { render, shouldShow, logo, el };
})();
