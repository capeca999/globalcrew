import { del } from '@vercel/blob';
import { requireAuth } from './_auth.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Método no permitido' });
  }

  const session = requireAuth(request, response);
  if (!session) return;

  const { slug, lang } = request.body || {};
  if (!slug) return response.status(400).json({ error: 'Falta el slug del artículo' });
  const langKey = lang === 'en' ? 'en' : 'es';

  try {
    await del(`blog/${langKey}/${slug}.json`);
    return response.status(200).json({ ok: true });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}
