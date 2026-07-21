import crypto from 'crypto';

// ---- Config ----
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours
const COOKIE_NAME = 'gc_admin_session';

// ADMIN_USERS_JSON is a Vercel environment variable, e.g.:
//   {"kike":"c1f5f7...<sha256 of the password>"}
// Add as many "username": "hash" pairs as you need later.
function getUsers() {
  try {
    return JSON.parse(process.env.ADMIN_USERS_JSON || '{}');
  } catch {
    return {};
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function verifyCredentials(username, password) {
  const users = getUsers();
  const expectedHash = users[username];
  if (!expectedHash) return false;
  // Constant-time-ish comparison to avoid trivial timing leaks.
  const a = Buffer.from(sha256(password));
  const b = Buffer.from(String(expectedHash));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sign(payload) {
  const secret = process.env.ADMIN_SESSION_SECRET || '';
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function createSessionCookie(username) {
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = Buffer.from(JSON.stringify({ username, exp })).toString('base64url');
  const signature = sign(payload);
  const token = `${payload}.${signature}`;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

export function getSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (sign(payload) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data; // { username, exp }
  } catch {
    return null;
  }
}

// Call at the top of any endpoint that should require login.
// Sends the 401 itself when there's no valid session, so callers
// just need to `return` when this returns null.
export function requireAuth(request, response) {
  const session = getSession(request);
  if (!session) {
    response.status(401).json({ error: 'No autenticado' });
    return null;
  }
  return session;
}
