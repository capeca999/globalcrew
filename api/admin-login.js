import { verifyCredentials, createSessionCookie } from './_auth.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Método no permitido' });
  }

  const { username, password } = request.body || {};
  if (!username || !password) {
    return response.status(400).json({ error: 'Faltan usuario o contraseña' });
  }

  if (!verifyCredentials(username, password)) {
    // Same message whether the user doesn't exist or the password is wrong,
    // so we don't reveal which usernames are valid.
    return response.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  response.setHeader('Set-Cookie', createSessionCookie(username));
  return response.status(200).json({ ok: true, username });
}
