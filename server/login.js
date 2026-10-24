// Login por e-mail + senha. Só o hash (scrypt) da senha existe no servidor, via variável de ambiente.
const crypto = require('crypto');

const EMAIL = (process.env.STREAMHUB_EMAIL || '').trim().toLowerCase();
const HASH = process.env.STREAMHUB_PASS_HASH || '';
const enabled = !!(EMAIL && HASH);
const secret = crypto.createHash('sha256').update('sess:' + HASH + (process.env.STREAMHUB_KEY || '')).digest();
const DAYS = 30;

function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${crypto.scryptSync(pass, salt, 64).toString('hex')}`;
}

function checkPassword(pass) {
  const [, salt, h] = HASH.split(":");
  if (!salt || !h) return false;
  const want = Buffer.from(h, 'hex');
  const got = crypto.scryptSync(pass, salt, 64);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function checkLogin(email, pass) {
  const okEmail = String(email || '').trim().toLowerCase() === EMAIL;
  const okPass = checkPassword(String(pass || '')); // roda sempre, para não vazar qual campo errou
  return okEmail && okPass;
}

const sign = (body) => crypto.createHmac('sha256', secret).update(body).digest('base64url');

function makeSession() {
  const body = String(Date.now() + DAYS * 864e5);
  return `${body}.${sign(body)}`;
}

function validSession(tok) {
  if (!tok) return false;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return false;
  const want = sign(body);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return false;
  return Number(body) > Date.now();
}

// limite simples de tentativas por IP
const fails = new Map();
function blocked(ip) {
  const f = fails.get(ip);
  return !!f && f.n >= 5 && Date.now() < f.until;
}
function fail(ip) {
  const f = fails.get(ip);
  const n = f && Date.now() < f.until ? f.n + 1 : 1;
  fails.set(ip, { n, until: Date.now() + 15 * 60e3 });
}
function ok(ip) {
  fails.delete(ip);
}

const cookieAttrs = (secure) => `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

function page() {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StreamHub · Entrar</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<style>
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{font-family:Inter,'Segoe UI',system-ui,sans-serif;color:#ececf4;display:grid;place-items:center;
background:radial-gradient(900px 500px at 85% -10%,rgba(139,92,246,.2),transparent 60%),radial-gradient(700px 500px at -10% 110%,rgba(34,211,238,.12),transparent 60%),#0a0a10}
form{width:min(380px,92vw);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:30px;backdrop-filter:blur(12px);display:grid;gap:16px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.brand{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#8b5cf6,#22d3ee);display:grid;place-items:center;font-weight:800;color:#fff;box-shadow:0 8px 24px rgba(139,92,246,.45)}
h1{margin:0;font-size:22px;letter-spacing:-.4px}p{margin:0;color:#8b8ba3;font-size:14px}
label{display:grid;gap:6px;color:#8b8ba3;font-size:12px;font-weight:500}
input{width:100%;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:12px;color:#ececf4;font:inherit;outline:none}
input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.22)}
button{border:0;border-radius:10px;padding:12px;font:inherit;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,#8b5cf6,#6d4de8);box-shadow:0 8px 20px rgba(109,77,232,.4)}
button:disabled{opacity:.6}
#err{color:#f87171;font-size:13px;min-height:18px}
</style></head><body>
<form id="f">
  <div class="brand">SH</div>
  <div><h1>StreamHub</h1><p>Entre para ver seus chats e controlar a live.</p></div>
  <label>E-mail<input name="email" type="email" autocomplete="username" required autofocus></label>
  <label>Senha<input name="password" type="password" autocomplete="current-password" required></label>
  <div id="err"></div>
  <button id="b">Entrar</button>
</form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = document.getElementById('b'), err = document.getElementById('err');
  b.disabled = true; err.textContent = '';
  const d = Object.fromEntries(new FormData(e.target));
  const r = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
  if (r.ok) return (location.href = '/');
  err.textContent = r.status === 429 ? 'Muitas tentativas. Tente de novo em alguns minutos.' : 'E-mail ou senha incorretos.';
  b.disabled = false;
});
</script></body></html>`;
}

module.exports = { enabled, hashPassword, checkLogin, makeSession, validSession, blocked, fail, ok, cookieAttrs, page, DAYS };
