import {
  verifyCredentials, createSessionCookie, clearSessionCookie, getSession,
  checkLoginLockout, recordFailedLogin, recordSuccessfulLogin,
} from './_auth.js';
import { peekWriteBudget } from './_blog-utils.js';

// Verifies the reCAPTCHA token with Google before we even look at the
// username/password. RECAPTCHA_SECRET_KEY is a Vercel environment variable —
// get it (and the public site key used in admin.html) from
// https://www.google.com/recaptcha/admin, registered for globalcrewtcp.com
async function verifyRecaptcha(token, remoteIp) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return true; // fail open if it hasn't been configured yet, so setup isn't blocked
  if (!token) return false;

  try {
    const params = new URLSearchParams({ secret, response: token });
    if (remoteIp) params.append('remoteip', remoteIp);

    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// One function handles all three admin-auth operations, picked by HTTP method,
// so this only counts as a single Serverless Function against Vercel's limit:
//   GET    /api/admin-auth  -> "am I logged in?"      (was admin-me.js)
//   POST   /api/admin-auth  -> log in                  (was admin-login.js)
//   DELETE /api/admin-auth  -> log out                 (was admin-logout.js)
export default async function handler(request, response) {
  if (request.method === 'GET') {
    const session = getSession(request);
    if (!session) return response.status(401).json({ authenticated: false });
    const budget = await peekWriteBudget();
    return response.status(200).json({ authenticated: true, username: session.username, budget });
  }

  if (request.method === 'POST') {
    const { username, password, recaptchaToken } = request.body || {};
    if (!username || !password) {
      return response.status(400).json({ error: 'Faltan usuario o contraseña' });
    }

    const remoteIp = request.headers['x-forwarded-for']?.split(',')[0]?.trim();
    const captchaOk = await verifyRecaptcha(recaptchaToken, remoteIp);
    if (!captchaOk) {
      return response.status(400).json({ error: 'No se ha podido verificar que no eres un robot. Inténtalo de nuevo.' });
    }

    const lockout = await checkLoginLockout(username);
    if (lockout.locked) {
      return response.status(429).json({
        error: `Demasiados intentos fallidos. Vuelve a intentarlo en ${lockout.minutesLeft} minuto${lockout.minutesLeft === 1 ? '' : 's'}.`,
      });
    }

    if (!verifyCredentials(username, password)) {
      await recordFailedLogin(username);
      // Same message whether the user doesn't exist or the password is wrong.
      return response.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    await recordSuccessfulLogin(username);
    response.setHeader('Set-Cookie', createSessionCookie(username));
    return response.status(200).json({ ok: true, username });
  }

  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', clearSessionCookie());
    return response.status(200).json({ ok: true });
  }

  return response.status(405).json({ error: 'Método no permitido' });
}
