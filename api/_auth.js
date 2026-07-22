import crypto from 'crypto';
import { fetchPublicJson, publicUrl, putObject } from './_blog-utils.js';

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

// ===================== LOGIN LOCKOUT =====================
// Tracks failed login attempts per username in a small object in R2. After
// too many wrong passwords in a row, that username is locked out for a
// cooldown period — this is what actually stops someone from just
// script-guessing passwords forever. A correct login clears the count.
const LOGIN_ATTEMPTS_KEY = '_system/login-attempts.json';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

async function getAttemptsData() {
  const data = await fetchPublicJson(publicUrl(LOGIN_ATTEMPTS_KEY));
  return data || {};
}

async function saveAttemptsData(data) {
  try {
    await putObject(LOGIN_ATTEMPTS_KEY, JSON.stringify(data), 'application/json');
  } catch {
    // Best-effort — don't let a bookkeeping failure block the login flow.
  }
}

// Call before checking the password. If locked, refuse immediately without
// even looking at the password attempt.
export async function checkLoginLockout(username) {
  const data = await getAttemptsData();
  const entry = data[username];
  if (entry && entry.lockedUntil && Date.now() < entry.lockedUntil) {
    return { locked: true, minutesLeft: Math.ceil((entry.lockedUntil - Date.now()) / 60000) };
  }
  return { locked: false };
}

export async function recordFailedLogin(username) {
  const data = await getAttemptsData();
  const entry = data[username] || { count: 0 };
  entry.count = (entry.count || 0) + 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  data[username] = entry;
  await saveAttemptsData(data);
}

export async function recordSuccessfulLogin(username) {
  const data = await getAttemptsData();
  if (data[username]) {
    delete data[username];
    await saveAttemptsData(data);
  }
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
