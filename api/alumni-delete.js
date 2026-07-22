import { del } from '@vercel/blob';
import { requireAuth } from './_auth.js';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];

async function tryDelete(path) {
  try {
    await del(path);
  } catch {
    // Fine if that particular file/extension didn't exist.
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Método no permitido' });
  }

  const session = requireAuth(request, response);
  if (!session) return;

  const { identity } = request.body || {}; // e.g. "Abril, Air Arabia, Dubai"
  if (!identity) return response.status(400).json({ error: 'Falta el alumno a borrar' });

  await Promise.all([
    ...IMAGE_EXTS.map((ext) => tryDelete(`alumnoscontratados/${identity}.${ext}`)),
    tryDelete(`alumnoscontratados/${identity}.txt`),
    tryDelete(`alumnoscontratados/${identity}.en.txt`),
  ]);

  return response.status(200).json({ ok: true });
}
