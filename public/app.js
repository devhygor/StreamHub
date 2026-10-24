(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = Chat.el;
  const PLATFORMS = ['twitch', 'kick', 'youtube'];
  const LABEL = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube' };

  let S = null;            // estado vindo do servidor (config pública)
  let statuses = {};
  let msgs = [];           // mensagens em memória
  const hiddenPlat = new Set();
  let query = '';
  let stickBottom = true;
  let unread = 0;
  let sendTo = new Set(PLATFORMS);
  let liveTo = new Set();
  let game = null;         // jogo escolhido { name, img, twitch, kick }
  let viewers = {};        // plataforma -> { live, count }

  const feed = $('#feed');

  // ---------- util ----------
  async function api(path, body, method) {
    const r = await fetch(path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  }

  function toast(text, kind = '') {
    const t = el('div', 'toast ' + kind, text);
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  let saveTimer;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api('/api/config', { settings: S.settings }), 400);
  }

  const connected = (p) => !!S.accounts[p];

  // ---------- navegação ----------
  document.querySelectorAll('.nav').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.nav').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + b.dataset.view));
      if (b.dataset.view === 'live') renderLive();
      if (b.dataset.view === 'accounts') renderAccounts(true);
      if (b.dataset.view === 'obs') renderObs();
    })
  );

  // ---------- WebSocket ----------
  function connectWS() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (e) => {
      const { type, payload } = JSON.parse(e.data);
      if (type === 'init') {
        S = payload.state;
        statuses = payload.statuses;
        viewers = payload.viewers || {};
        msgs = payload.history;
        initUI();
      } else if (type === 'message') addMessage(payload);
      else if (type === 'viewers') {
        viewers = payload;
        renderViewers();
      } else if (type === 'status') {
        statuses[payload.platform] = payload;
        renderStatus();
      } else if (type === 'state') {
        S = payload;
        applySettings();
        renderAccounts();
        renderViewers();
        renderChips();
        renderLiveTargets();
      } else if (type === 'delete') {
        msgs = msgs.filter((m) => m.id !== payload.id);
        feed.querySelectorAll('.msg').forEach((n) => n.dataset.id === String(payload.id) && n.remove());
      } else if (type === 'clear') {
        if (payload.user) {
          msgs = msgs.filter((m) => (m.login || '').toLowerCase() !== payload.user.toLowerCase());
          rerender();
        } else { msgs = []; rerender(); }
      }
    };
    ws.onclose = () => setTimeout(connectWS, 2000);
  }

  // ---------- chat ----------
  function visible(m) {
    if (!Chat.shouldShow(m, S.settings, { hidden: hiddenPlat })) return false;
    if (query && !(m.text + ' ' + m.user).toLowerCase().includes(query)) return false;
    return true;
  }

  function node(m) {
    const n = Chat.render(m, S.settings);
    const a = el('div', 'actions');
    const mk = (title, svg, fn) => {
      const b = el('button');
      b.title = title;
      b.innerHTML = `<svg viewBox="0 0 24 24">${svg}</svg>`;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      a.appendChild(b);
    };
    mk('Fixar', '<path d="M12 17v5M9 3h6l-1 7 4 4H6l4-4z"/>', () => pin(m));
    mk('Copiar', '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>', () => navigator.clipboard.writeText(`${m.user}: ${m.text}`));
    mk('Ocultar este usuário', '<circle cx="12" cy="12" r="9"/><path d="M5.600 5.600l12.800 12.800"/>', () => {
      const u = m.login || m.user;
      S.settings.hiddenUsers = [...new Set([...(S.settings.hiddenUsers || []), u])];
      saveSettings(); fillSettings(); rerender(); toast(`${m.user} oculto`);
    });
    n.appendChild(a);
    return n;
  }

  function addMessage(m) {
    msgs.push(m);
    const max = S.settings.maxMessages || 300;
    if (msgs.length > max) {
      msgs.shift();
      if (feed.firstChild && feed.firstChild.classList?.contains('msg')) feed.firstChild.remove();
    }
    if (!visible(m)) return;
    $('.empty', feed)?.remove();
    feed.appendChild(node(m));
    if (stickBottom) feed.scrollTop = feed.scrollHeight;
    else { unread++; showNew(); }
  }

  function rerender() {
    feed.innerHTML = '';
    const list = msgs.filter(visible);
    if (!list.length) {
      const e = el('div', 'empty');
      e.innerHTML = '<div class="big">💬</div><div><b>Nenhuma mensagem ainda</b><br>Configure as plataformas em <b>Contas</b> ou ligue o modo demonstração em <b>Ajustes</b>.</div>';
      feed.appendChild(e);
      return;
    }
    const frag = document.createDocumentFragment();
    list.forEach((m) => frag.appendChild(node(m)));
    feed.appendChild(frag);
    feed.scrollTop = feed.scrollHeight;
    stickBottom = true;
    unread = 0;
    showNew();
  }

  function showNew() {
    const b = $('#newmsgs');
    b.classList.toggle('show', !stickBottom && unread > 0);
    b.textContent = `↓ ${unread} nova${unread > 1 ? 's' : ''} mensagen${unread > 1 ? 's' : 'm'}`;
  }

  feed.addEventListener('scroll', () => {
    stickBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    if (stickBottom) { unread = 0; showNew(); }
  });
  $('#newmsgs').onclick = () => { feed.scrollTop = feed.scrollHeight; };

  function pin(m) {
    const box = $('#pinned');
    box.innerHTML = '';
    const x = el('button', 'x', '×');
    x.onclick = () => box.classList.remove('show');
    box.append(x, Chat.render(m, S.settings));
    box.classList.add('show');
  }

  $('#search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); rerender(); });
  $('#btn-clear').onclick = () => api('/api/clear', {});

  function renderChips() {
    const f = $('#filters');
    f.innerHTML = '';
    for (const p of PLATFORMS) {
      const c = el('button', `chip t-${p}` + (hiddenPlat.has(p) ? ' off' : ''));
      c.append(Chat.logo(p), el('span', '', LABEL[p]));
      c.title = 'Mostrar/ocultar ' + LABEL[p];
      c.onclick = () => { hiddenPlat.has(p) ? hiddenPlat.delete(p) : hiddenPlat.add(p); renderChips(); rerender(); };
      f.appendChild(c);
    }
    const ev = el('button', 'chip' + (S.settings.showEvents !== false ? ' sel' : ' off'));
    ev.textContent = '★ Eventos';
    ev.title = 'Mostrar/ocultar resgates, subs, bits, raids...';
    ev.onclick = () => { S.settings.showEvents = S.settings.showEvents === false; saveSettings(); fillSettings(); renderChips(); rerender(); };
    f.appendChild(ev);
    const t = $('#targets');
    t.innerHTML = '';
    for (const p of PLATFORMS) {
      const c = el('button', `chip t-${p}` + (sendTo.has(p) ? ' sel' : ' off'));
      c.append(Chat.logo(p));
      c.title = `Enviar para ${LABEL[p]}${connected(p) ? '' : ' (faça login em Contas)'}`;
      c.onclick = () => { sendTo.has(p) ? sendTo.delete(p) : sendTo.add(p); renderChips(); };
      t.appendChild(c);
    }
  }

  async function send() {
    const input = $('#input');
    const text = input.value.trim();
    if (!text) return;
    const targets = [...sendTo].filter(connected);
    if (!targets.length) return toast('Marque uma plataforma com login feito', 'bad');
    input.value = '';
    const res = await api('/api/send', { text, platforms: targets });
    for (const [p, r] of Object.entries(res)) if (!r.ok) toast(`${LABEL[p]}: ${r.error}`, 'bad');
  }
  $('#send').onclick = send;
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // ---------- espectadores ----------
  function renderViewers() {
    const box = $('#vbar');
    box.innerHTML = '';
    let total = 0, anyLive = false;
    for (const p of PLATFORMS) {
      const v = viewers[p];
      if (!connected(p) && !v) continue;
      const live = !!v?.live;
      if (live) { total += v.count; anyLive = true; }
      const c = el('div', 'vcell' + (live ? ' live' : ' off'));
      c.append(Chat.logo(p), el('span', 'num', live ? v.count.toLocaleString('pt-BR') : '—'), el('span', 'tag', live ? 'AO VIVO' : 'OFFLINE'));
      c.title = LABEL[p];
      box.appendChild(c);
    }
    if (box.children.length > 1) {
      const t = el('div', 'vcell total' + (anyLive ? ' live' : ' off'));
      t.append(el('span', 'tag', 'TOTAL'), el('span', 'num', total.toLocaleString('pt-BR')));
      box.appendChild(t);
    }
    box.style.display = box.children.length ? '' : 'none';
  }

  // ---------- campos sensíveis (mascarados; olho para ver, botão para copiar) ----------
  const ICON_EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_COPY = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

  function secret(input, copyable = true) {
    if (input.closest('.secretwrap')) return input;
    const wrap = el('div', 'secretwrap');
    input.before(wrap);
    wrap.appendChild(input);
    input.classList.add('mask');
    input.autocomplete = 'off';
    input.spellcheck = false;
    const btns = el('div', 'sbtns');
    let timer;
    const eye = el('button', 'reveal-only');
    eye.type = 'button';
    eye.title = 'Mostrar / ocultar';
    eye.innerHTML = ICON_EYE;
    eye.onclick = () => {
      clearTimeout(timer);
      const hidden = input.classList.toggle('mask');
      if (!hidden) timer = setTimeout(() => input.classList.add('mask'), 8000); // volta a esconder sozinho
    };
    btns.appendChild(eye);
    if (copyable) {
      const cp = el('button');
      cp.type = 'button';
      cp.title = 'Copiar sem mostrar';
      cp.innerHTML = ICON_COPY;
      cp.onclick = () => { if (input.value) { navigator.clipboard.writeText(input.value); toast('Copiado', 'ok'); } };
      btns.appendChild(cp);
    }
    wrap.appendChild(btns);
    return input;
  }

  // dentro do OBS (dock/fonte de navegador) nada de links com chave na tela
  const inOBS = !!window.obsstudio || /OBS/i.test(navigator.userAgent);
  if (inOBS) { document.documentElement.classList.add('inobs'); $('#nav-obs').remove(); }

  // ---------- status ----------
  function renderStatus() {
    const d = $('#dots');
    d.innerHTML = '';
    for (const p of PLATFORMS) {
      const s = statuses[p] || { state: 'off' };
      const dot = el('div', 'dot ' + s.state);
      dot.title = `${LABEL[p]}: ${s.state === 'on' ? 'conectado' : s.state === 'connecting' ? 'conectando...' : s.state === 'error' ? 'erro' : 'desligado'}${s.detail ? ' — ' + s.detail : ''}`;
      d.appendChild(dot);
    }
    renderAccounts();
  }

  // ---------- contas ----------
  const HELP = {
    twitch: {
      link: 'https://dev.twitch.tv/console/apps', linkText: 'dev.twitch.tv/console/apps',
      steps: ['Abra o console e clique em <b>Register Your Application</b>.', 'Em <b>OAuth Redirect URLs</b> cole a URL abaixo.', 'Categoria: <b>Application Integration</b>, tipo de cliente <b>Confidential</b>.', 'Copie o <b>Client ID</b> e gere um <b>Client Secret</b>.'],
    },
    kick: {
      link: 'https://kick.com/settings/developer', linkText: 'kick.com/settings/developer',
      steps: ['Ative a verificação em 2 fatores na Kick (obrigatório para criar apps).', 'Em Configurações → <b>Developer</b>, crie um app.', 'Em <b>Redirect URL</b> cole a URL abaixo.', 'Em <b>Webhook URL</b> cole a URL mostrada no campo acima e ative <b>Enable Webhooks</b>. Sem isso o chat da Kick não chega.', 'Copie o Client ID e o Client Secret.'],
    },
    youtube: {
      link: 'https://console.cloud.google.com/apis/credentials', linkText: 'console.cloud.google.com',
      steps: ['Crie um projeto e ative a <b>YouTube Data API v3</b>.', 'Configure a tela de consentimento (externo) e adicione seu e-mail como usuário de teste.', 'Em Credenciais → <b>ID do cliente OAuth</b>, tipo <b>Aplicativo da Web</b>.', 'Em <b>URIs de redirecionamento</b> cole a URL abaixo e copie ID + Secret.'],
    },
  };

  function renderAccounts(force) {
    const box = $('#accounts');
    if (!S) return;
    if (!force && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') {
      // não recria enquanto o usuário digita; só atualiza status
      for (const p of PLATFORMS) {
        const pill = $(`#pill-${p}`);
        if (pill) setPill(pill, p);
      }
      return;
    }
    box.innerHTML = '';
    for (const p of PLATFORMS) {
      const app = S.apps[p];
      const ch = S.channels[p];
      const acc = S.accounts[p];
      const h = HELP[p];
      const card = el('div', 'card');
      const head = el('div', 'acct-head');
      const pill = el('span', 'pill'); pill.id = 'pill-' + p; setPill(pill, p);
      head.append(Chat.logo(p), el('b', '', LABEL[p]), el('div', 'grow'), pill);
      card.appendChild(head);

      const g = el('div', 'grid2'); g.style.marginTop = '14px';
      g.innerHTML = `
        <label class="f">Client ID<input type="text" data-k="clientId" value="${esc(app.clientId)}" autocomplete="off"></label>
        <label class="f">Client Secret<input type="password" data-k="clientSecret" placeholder="${app.hasSecret ? '•••••••• (salvo)' : ''}" autocomplete="off"></label>`;
      if (p === 'twitch') g.innerHTML += `<label class="f">Canal para ler o chat<input type="text" data-c="login" value="${esc(ch.login)}" placeholder="seu_canal"></label>`;
      if (p === 'kick') g.innerHTML += `<label class="f" style="grid-column:1/-1">Webhook URL (cole no app da Kick)<input type="text" readonly value="${esc(S.publicUrl)}/webhooks/kick" onclick="this.select()"></label>`;
      g.querySelectorAll('[data-k]').forEach((i) => secret(i, i.dataset.k === 'clientId'));
      if (p === 'youtube') g.innerHTML += `<label class="f" style="grid-column:1/-1">Link ou ID da live (opcional — lê o chat sem gastar a cota da API)<input type="text" data-c="videoId" value="${esc(ch.videoId)}" placeholder="https://youtube.com/live/..."></label>`;
      card.appendChild(g);

      const r = el('div', 'row'); r.style.marginTop = '14px';
      const save = el('button', 'btn', 'Salvar');
      save.onclick = async () => {
        const apps = { [p]: {} }, channels = { [p]: {} };
        card.querySelectorAll('[data-k]').forEach((i) => (apps[p][i.dataset.k] = i.value));
        card.querySelectorAll('[data-c]').forEach((i) => (channels[p][i.dataset.c] = i.value.trim()));
        await api('/api/config', { apps, channels });
        toast('Salvo', 'ok');
      };
      const login = el('button', 'btn primary', acc ? 'Trocar conta' : 'Entrar com ' + LABEL[p]);
      login.onclick = async () => { await save.onclick(); window.open(`/auth/${p}/login`, '_blank', 'width=560,height=760'); };
      r.append(save, login);
      if (p === 'kick') {
        const basic = el('button', 'btn', 'Entrar (básico)');
        basic.title = 'Sem resgates e Kicks. Use se o login normal der "invalid authorization request".';
        basic.onclick = async () => { await save.onclick(); window.open('/auth/kick/login?basic=1', '_blank', 'width=560,height=760'); };
        r.appendChild(basic);
      }
      if (acc) {
        const out = el('button', 'btn danger', 'Sair');
        out.onclick = () => api('/api/logout/' + p, {});
        r.appendChild(out);
      }
      const st = statuses[p]?.state;
      const tog = el('button', 'btn', st === 'on' || st === 'connecting' ? 'Desconectar chat' : 'Conectar chat');
      tog.onclick = async () => {
        if (tog.textContent.startsWith('Desc')) await api('/api/disconnect/' + p, {});
        else { await save.onclick(); await api('/api/connect/' + p, {}); }
      };
      r.appendChild(tog);
      card.appendChild(r);

      if (acc) card.appendChild(Object.assign(el('div', 'note'), { textContent: `Logado como ${acc.name}`, style: 'margin-top:10px' }));

      const d = document.createElement('details');
      d.innerHTML = `<summary>Como obter o Client ID e Secret</summary><ol>${h.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
        <div class="note">Abra: <a href="${h.link}" target="_blank" style="color:var(--accent2)">${h.linkText}</a></div>
        <div class="note" style="margin-top:6px">URL de redirecionamento: <span class="code">${S.publicUrl}/auth/${p}/callback</span></div>`;
      card.appendChild(d);
      box.appendChild(card);
    }
  }

  function setPill(pill, p) {
    const s = statuses[p] || { state: 'off' };
    const txt = { on: 'Conectado', connecting: 'Conectando...', error: 'Erro', off: 'Desligado' }[s.state];
    pill.className = 'pill ' + s.state;
    pill.textContent = txt + (s.state === 'on' && s.detail ? ' · ' + s.detail : '');
    pill.title = s.detail || '';
    if (s.state === 'error' && s.detail) pill.textContent = 'Erro: ' + s.detail.slice(0, 70);
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- live (título e jogo) ----------
  function renderLiveTargets() {
    const box = $('#live-targets');
    box.innerHTML = '';
    for (const p of PLATFORMS) {
      if (!connected(p)) liveTo.delete(p);
      const c = el('button', `chip t-${p}` + (liveTo.has(p) ? ' sel' : ' off'));
      c.append(Chat.logo(p), el('span', '', LABEL[p] + (connected(p) ? '' : ' (sem login)')));
      c.onclick = () => {
        if (!connected(p)) return toast(`Faça login na ${LABEL[p]} em Contas`, 'bad');
        liveTo.has(p) ? liveTo.delete(p) : liveTo.add(p);
        renderLiveTargets();
      };
      box.appendChild(c);
    }
  }

  function renderGame() {
    const b = $('#game-sel');
    b.innerHTML = '';
    if (!game) return;
    const c = el('div', 'gamechip');
    if (game.img) { const i = el('img'); i.src = game.img; c.appendChild(i); }
    c.appendChild(el('b', '', game.name));
    const x = el('button', 'x', '×');
    x.onclick = () => { game = null; renderGame(); };
    c.appendChild(x);
    b.appendChild(c);
  }

  let gameTimer;
  $('#game-q').addEventListener('input', (e) => {
    clearTimeout(gameTimer);
    const q = e.target.value.trim();
    const dd = $('#game-dd');
    if (q.length < 2) return (dd.hidden = true);
    gameTimer = setTimeout(async () => {
      const list = await api('/api/games?q=' + encodeURIComponent(q));
      dd.innerHTML = '';
      if (!list.length) dd.appendChild(Object.assign(el('div', 'opt muted'), { textContent: 'Nada encontrado (precisa de login Twitch ou Kick)' }));
      for (const g of list) {
        const o = el('div', 'opt');
        if (g.img) { const i = el('img'); i.src = g.img; o.appendChild(i); }
        o.appendChild(el('span', '', g.name));
        const tags = el('div', 'tags');
        if (g.twitch) tags.appendChild(Chat.logo('twitch'));
        if (g.kick) tags.appendChild(Chat.logo('kick'));
        o.appendChild(tags);
        o.onclick = () => { game = g; dd.hidden = true; $('#game-q').value = ''; renderGame(); };
        dd.appendChild(o);
      }
      dd.hidden = false;
    }, 300);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.games')) $('#game-dd').hidden = true; });

  function showResults(res, label) {
    $('#cur-card').hidden = false;
    const box = $('#cur');
    box.innerHTML = '';
    for (const [p, r] of Object.entries(res)) {
      const row = el('div', 'result ' + (r.ok ? 'ok' : 'bad'));
      row.appendChild(Chat.logo(p));
      const t = el('div');
      if (!r.ok) t.innerHTML = `<b>${LABEL[p]}</b> <span class="muted">— ${esc(r.error)}</span>`;
      else if (r.data && r.data.title !== undefined) t.innerHTML = `<b>${esc(r.data.title)}</b> <span class="muted">${r.data.game ? '· ' + esc(r.data.game) : ''}</span>`;
      else t.innerHTML = `<b>${LABEL[p]}</b> <span class="muted">— ${label}</span>`;
      row.appendChild(t);
      box.appendChild(row);
    }
  }

  async function applyLive(title, g, targets) {
    if (!targets.length) return toast('Marque ao menos uma plataforma', 'bad');
    if (!title && !g) return toast('Informe título ou jogo', 'bad');
    const btn = $('#apply'); btn.disabled = true;
    const res = await api('/api/stream', { title, game: g ? { twitch: g.twitch, kick: g.kick } : null, platforms: targets });
    btn.disabled = false;
    showResults(res, 'atualizado ✓');
    const bad = Object.values(res).filter((r) => !r.ok).length;
    toast(bad ? `${bad} plataforma(s) com erro` : 'Live atualizada em todas!', bad ? 'bad' : 'ok');
  }

  $('#apply').onclick = () => applyLive($('#title').value.trim(), game, [...liveTo]);
  $('#load-cur').onclick = async () => {
    const res = await api('/api/stream');
    showResults(res);
    const first = Object.values(res).find((r) => r.ok);
    if (first) $('#title').value = first.data.title;
  };

  function renderPresets() {
    const box = $('#presets');
    box.innerHTML = '';
    if (!S.presets.length) { box.appendChild(Object.assign(el('div', 'muted'), { textContent: 'Nenhum preset ainda. Preencha título e jogo e clique em “Salvar como preset”.' })); return; }
    S.presets.forEach((p, i) => {
      const row = el('div', 'preset');
      const t = el('div', 't');
      t.append(el('div', '', p.title || '(sem título)'), Object.assign(el('div', 'muted'), { textContent: p.game?.name || 'sem jogo' }));
      const use = el('button', 'btn sm', 'Carregar');
      use.onclick = () => { $('#title').value = p.title; game = p.game; renderGame(); };
      const go = el('button', 'btn sm primary', 'Aplicar já');
      go.onclick = () => applyLive(p.title, p.game, [...liveTo]);
      const del = el('button', 'btn sm danger', '×');
      del.onclick = async () => { S.presets.splice(i, 1); await api('/api/config', { presets: S.presets }); renderPresets(); };
      row.append(t, use, go, del);
      box.appendChild(row);
    });
  }

  $('#save-preset').onclick = async () => {
    const title = $('#title').value.trim();
    if (!title && !game) return toast('Preencha título ou jogo', 'bad');
    S.presets.push({ title, game });
    await api('/api/config', { presets: S.presets });
    renderPresets();
    toast('Preset salvo', 'ok');
  };

  function renderLive() {
    if (!liveTo.size) PLATFORMS.filter(connected).forEach((p) => liveTo.add(p));
    renderLiveTargets();
    renderGame();
    renderPresets();
  }

  // ---------- ajustes ----------
  const CHECKS = ['showTimestamps', 'showBadges', 'hideCommands', 'showEvents', 'hideFollows'];
  const NUMS = ['maxMessages', 'youtubeMinPollSeconds'];
  const LINES = ['hiddenUsers', 'highlightWords'];

  function fillSettings() {
    const s = S.settings;
    $('#s-fontSize').value = s.fontSize;
    $('#fs-val').textContent = s.fontSize + 'px';
    CHECKS.forEach((k) => ($('#s-' + k).checked = !!s[k]));
    NUMS.forEach((k) => ($('#s-' + k).value = s[k]));
    LINES.forEach((k) => { if (document.activeElement !== $('#s-' + k)) $('#s-' + k).value = (s[k] || []).join('\n'); });
  }

  function applySettings() {
    document.documentElement.style.setProperty('--fs', S.settings.fontSize + 'px');
    fillSettings();
  }

  function bindSettings() {
    $('#s-fontSize').oninput = (e) => { S.settings.fontSize = +e.target.value; applySettings(); saveSettings(); };
    CHECKS.forEach((k) => ($('#s-' + k).onchange = (e) => { S.settings[k] = e.target.checked; saveSettings(); rerender(); }));
    NUMS.forEach((k) => ($('#s-' + k).onchange = (e) => { S.settings[k] = Math.max(0, +e.target.value || 0); saveSettings(); }));
    LINES.forEach((k) => ($('#s-' + k).oninput = (e) => {
      S.settings[k] = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean);
      saveSettings();
    }));
    LINES.forEach((k) => ($('#s-' + k).onchange = () => rerender()));
    $('#demo').onchange = (e) => api('/api/demo', { on: e.target.checked });
  }

  // ---------- OBS ----------
  const obsPlats = new Set(PLATFORMS);
  let obsInfo = null;

  async function renderObs() {
    if (!obsInfo) obsInfo = await api('/api/obs');
    if (!$('#obs-size').dataset.init) {
      $('#obs-size').value = (S.settings.fontSize || 15) + 4;
      $('#obs-size').dataset.init = '1';
    }
    const box = $('#obs-plats');
    box.innerHTML = '';
    for (const p of PLATFORMS) {
      const c = el('button', `chip t-${p}` + (obsPlats.has(p) ? ' sel' : ' off'));
      c.append(Chat.logo(p), el('span', '', LABEL[p]));
      c.onclick = () => {
        obsPlats.has(p) ? obsPlats.delete(p) : obsPlats.add(p);
        if (!obsPlats.size) obsPlats.add(p);
        renderObs();
      };
      box.appendChild(c);
    }
    const k = obsInfo.key ? 'key=' + encodeURIComponent(obsInfo.key) : '';
    const q = new URLSearchParams();
    if (obsPlats.size < PLATFORMS.length) q.set('platforms', [...obsPlats].join(','));
    const size = +$('#obs-size').value, fade = +$('#obs-fade').value;
    if (size) q.set('size', size);
    if (fade > 0) q.set('fade', fade);
    const join = (s) => [k, s].filter(Boolean).join('&');
    const url = `${obsInfo.base}/overlay.html?${join(q.toString())}`.replace(/\?$/, '');
    $('#obs-overlay').value = url;
    $('#obs-dock').value = `${obsInfo.base}/${k ? '?' + k : ''}`;
    // prévia usa o próprio cookie de login (sem a chave na URL)
    const frame = $('#obs-frame');
    const prev = `/overlay.html?${q}`;
    if (frame.dataset.src !== prev) { frame.dataset.src = prev; frame.src = prev; }
  }

  secret($('#obs-overlay'));
  secret($('#obs-dock'));
  ['#obs-size', '#obs-fade'].forEach((s) => $(s).addEventListener('input', () => renderObs()));
  const copy = (id) => () => { navigator.clipboard.writeText($(id).value); toast('Link copiado!', 'ok'); };
  $('#copy-obs-overlay').onclick = copy('#obs-overlay');
  $('#copy-obs-dock').onclick = copy('#obs-dock');

  // ---------- init ----------
  function initUI() {
    applySettings();
    bindSettings();
    renderChips();
    renderStatus();
    renderViewers();
    renderAccounts(true);
    rerender();
  }

  connectWS();
})();
