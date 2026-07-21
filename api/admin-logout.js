import { clearSessionCookie } from './_auth.js';

export default async function handler(request, response) {
  response.setHeader('Set-Cookie', clearSessionCookie());
  return response.status(200).json({ ok: true });
}
