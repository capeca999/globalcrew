import { list, get, put } from '@vercel/blob';
import { requireAuth } from './_auth.js';

// One function handles both operations, picked by HTTP method:
//   GET  /api/proximo-curso?lang=es  -> read the current announcement (public, unchanged)
//   POST /api/proximo-curso  (auth)  -> publish a new announcement    (was course-save.js)

// English announcement files end in ".en.txt"; Spanish (default) ones
// just end in ".txt".
const EN_TEXT_RE = /\.en\.txt$/i;
const ES_TEXT_RE = /(?<!\.en)\.txt$/i;

async function mostRecentText(blobs) {
  if (!blobs.length) return '';
  const sorted = [...blobs].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const target = sorted[0];
  const result = await get(target.pathname, { access: 'private' });
  if (!result) return '';
  return (await new Response(result.stream).text()).trim();
}

async function handleRead(request, response) {
  const lang = request.query && request.query.lang === 'en' ? 'en' : 'es';

  try {
    const { blobs } = await list({ prefix: 'proximoscursos/' });

    if (!blobs.length) {
      return response.status(200).json({ text: '' });
    }

    const esTexts = blobs.filter((b) => ES_TEXT_RE.test(b.pathname));
    const enTexts = blobs.filter((b) => EN_TEXT_RE.test(b.pathname));

    let text = '';
    if (lang === 'en' && enTexts.length) {
      text = await mostRecentText(enTexts);
    }
    if (!text) {
      text = await mostRecentText(esTexts.length ? esTexts : blobs);
    }

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return response.status(200).json({ text });
  } catch (err) {
    return response.status(500).json({ error: err.message, text: '' });
  }
}

async function handleSave(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const { textEs, textEn } = request.body || {};
  if (!textEs || !textEs.trim()) {
    return response.status(400).json({ error: 'Falta el texto en español' });
  }

  try {
    const stamp = Date.now();
    await put(`proximoscursos/convocatoria-${stamp}.txt`, textEs.trim(), {
      access: 'private', contentType: 'text/plain; charset=utf-8', addRandomSuffix: false,
    });
    if (textEn && textEn.trim()) {
      await put(`proximoscursos/convocatoria-${stamp}.en.txt`, textEn.trim(), {
        access: 'private', contentType: 'text/plain; charset=utf-8', addRandomSuffix: false,
      });
    }
    return response.status(200).json({ ok: true });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}

export default async function handler(request, response) {
  if (request.method === 'GET') return handleRead(request, response);
  if (request.method === 'POST') return handleSave(request, response);
  return response.status(405).json({ error: 'Método no permitido' });
}
