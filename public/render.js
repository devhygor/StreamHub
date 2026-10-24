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
    if (m.kind === 'event') return st.showEvents !== false && !(m.ev === 'follow' && st.hideFollows);
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
    if (m.kind === 'event') return renderEvent(m);
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

  const ICONS = {
    redeem: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
    gift: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
    follow: '<path d="M20.8 4.600a5.5 5.5 0 0 0-7.8 0L12 5.700l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.600 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    sub: '<path d="M12 2l3.1 6.300 6.900 1-5 4.900 1.2 6.8L12 17.700 5.8 21l1.2-6.8-5-4.900 6.900-1z"/>',
    member: '<path d="M12 2l3.1 6.300 6.900 1-5 4.900 1.2 6.8L12 17.700 5.8 21l1.2-6.8-5-4.900 6.900-1z"/>',
    cheer: '<path d="M6 3h12l4 6-10 12L2 9z M2 9h20"/>',
    kicks: '<path d="M13 2L3 14h8l-1 8 10-12h-8z"/>',
    raid: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  };

  function renderEvent(m) {
    const row = el('div', `msg event ev-${m.ev} plat-${m.platform}`);
    row.dataset.id = m.id;
    const ico = document.createElementNS(NS, 'svg');
    ico.setAttribute('viewBox', '0 0 24 24');
    ico.setAttribute('class', 'evico');
    ico.innerHTML = ICONS[m.ev] || ICONS.sub;
    row.appendChild(ico);
    const body = el('div', 'body');
    const line = el('div', 'evline');
    line.append(logo(m.platform), el('span', 'name', m.user), el('span', 'evlabel', ' ' + m.label));
    if (m.title) line.appendChild(el('span', 'evtitle', m.title));
    if (m.amount) line.appendChild(el('span', 'evamount', m.amount));
    body.appendChild(line);
    if (m.detail) body.appendChild(el('div', 'evdetail', m.detail));
    row.appendChild(body);
    return row;
  }

  return { render, shouldShow, logo, el };
})();
