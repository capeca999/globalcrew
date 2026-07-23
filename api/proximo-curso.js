import { requireAuth, getSession } from './_auth.js';
import { fetchPublicText, listObjects, putObject, checkWriteBudget } from './_blog-utils.js';

// One function handles both operations, picked by HTTP method:
//   GET  /api/proximo-curso?lang=es  -> read the current announcement (public)
//   POST /api/proximo-curso  (auth)  -> publish a new announcement

const EN_TEXT_RE = /\.en\.txt$/i;
const ES_TEXT_RE = /(?<!\.en)\.txt$/i;

function mostRecentUrl(blobs) {
  if (!blobs.length) return null;
  const sorted = [...blobs].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return sorted[0].url;
}

async function handleRead(request, response) {
  const lang = request.query && request.query.lang === 'en' ? 'en' : 'es';

  try {
    const blobs = await listObjects('proximoscursos/');

    if (!blobs.length) {
      return response.status(200).json({ text: '' });
    }

    const esTexts = blobs.filter((b) => ES_TEXT_RE.test(b.pathname));
    const enTexts = blobs.filter((b) => EN_TEXT_RE.test(b.pathname));

    let text = '';
    if (lang === 'en' && enTexts.length) {
      text = await fetchPublicText(mostRecentUrl(enTexts));
    }
    if (!text) {
      text = await fetchPublicText(mostRecentUrl(esTexts.length ? esTexts : blobs));
    }

    response.setHeader('Vary', 'Cookie');

    response.setHeader('Cache-Control', getSession(request) ? 'no-store' : 's-maxage=900, stale-while-revalidate=3600');
    return response.status(200).json({ text });
  } catch (err) {
    return response.status(500).json({ error: err.message, text: '' });
  }
}

async function handleSave(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const budget = await checkWriteBudget();
  if (!budget.allowed) {
    return response.status(503).json({ error: 'Se ha alcanzado el límite de seguridad de operaciones de este mes. Vuelve a intentarlo el mes que viene, o contacta con el desarrollador.' });
  }

  const { textEs, textEn } = request.body || {};
  if (!textEs || !textEs.trim()) {
    return response.status(400).json({ error: 'Falta el texto en español' });
  }

  try {
    const stamp = Date.now();
    await putObject(`proximoscursos/convocatoria-${stamp}.txt`, textEs.trim(), 'text/plain; charset=utf-8');
    if (textEn && textEn.trim()) {
      await putObject(`proximoscursos/convocatoria-${stamp}.en.txt`, textEn.trim(), 'text/plain; charset=utf-8');
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
