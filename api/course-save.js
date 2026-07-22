import { put } from '@vercel/blob';
import { requireAuth } from './_auth.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Método no permitido' });
  }

  const session = requireAuth(request, response);
  if (!session) return;

  const { textEs, textEn } = request.body || {};
  if (!textEs || !textEs.trim()) {
    return response.status(400).json({ error: 'Falta el texto en español' });
  }

  try {
    // proximo-curso.js always picks the MOST RECENTLY uploaded file, so a
    // fresh timestamped upload is all it takes to become "the" announcement —
    // no need to find and overwrite a previous one.
    const stamp = Date.now();
    await put(`proximoscursos/convocatoria-${stamp}.txt`, textEs.trim(), {
      access: 'private',
      contentType: 'text/plain; charset=utf-8',
      addRandomSuffix: false,
    });

    if (textEn && textEn.trim()) {
      await put(`proximoscursos/convocatoria-${stamp}.en.txt`, textEn.trim(), {
        access: 'private',
        contentType: 'text/plain; charset=utf-8',
        addRandomSuffix: false,
      });
    }

    return response.status(200).json({ ok: true });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}
