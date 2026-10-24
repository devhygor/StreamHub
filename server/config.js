const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'config.json');

const DEFAULTS = {
  port: 3737,
  apps: {
    twitch: { clientId: '', clientSecret: '' },
    kick: { clientId: '', clientSecret: '' },
    youtube: { clientId: '', clientSecret: '' },
  },
  tokens: {},
  channels: {
    twitch: { login: '' },
    kick: { slug: '', chatroomId: '' },
    youtube: { videoId: '' },
  },
  settings: {
    fontSize: 15,
    showTimestamps: false,
    showBadges: true,
    hideCommands: true,
    showEvents: true,
    hideFollows: false,
    hiddenUsers: ['nightbot', 'streamelements', 'moobot', 'streamlabs'],
    highlightWords: [],
    maxMessages: 300,
    overlayFadeSeconds: 0,
    youtubeMinPollSeconds: 8,
  },
  presets: [],
};

function merge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    out[k] = k in base ? merge(base[k], extra[k]) : extra[k];
  }
  return out;
}

let data = structuredClone(DEFAULTS);
try {
  data = merge(DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch {}

if (process.env.PORT) data.port = Number(process.env.PORT);

// URL pública (VPS) ou localhost; é a base dos redirecionamentos OAuth e do webhook da Kick
const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${data.port}`).replace(/\/$/, '');
const accessKey = process.env.STREAMHUB_KEY || '';

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  }, 100);
}

// versão sem segredos para mandar à interface
function publicView() {
  const apps = {};
  for (const [k, v] of Object.entries(data.apps)) {
    apps[k] = { clientId: v.clientId, hasSecret: !!v.clientSecret };
  }
  const accounts = {};
  for (const [k, v] of Object.entries(data.tokens)) {
    if (v && v.access) accounts[k] = { name: v.name || '', id: v.userId || '' };
  }
  return { port: data.port, publicUrl: publicUrl(), needsKey: !!accessKey, apps, accounts, channels: data.channels, settings: data.settings, presets: data.presets };
}

module.exports = { data, save, publicView, publicUrl, accessKey };
