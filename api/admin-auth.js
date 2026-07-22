import {
  verifyCredentials, createSessionCookie, clearSessionCookie, getSession,
  checkLoginLockout, recordFailedLogin, recordSuccessfulLogin,
} from './_auth.js';
import { peekWriteBudget } from './_blog-utils.js';

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
    const { username, password } = request.body || {};
    if (!username || !password) {
      return response.status(400).json({ error: 'Faltan usuario o contraseña' });
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
