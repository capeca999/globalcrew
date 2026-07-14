import { list, get } from '@vercel/blob';

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

export default async function handler(request, response) {
  const lang = request.query && request.query.lang === 'en' ? 'en' : 'es';

  try {
    const { blobs } = await list({ prefix: 'proximoscursos/' });

    if (!blobs.length) {
      return response.status(200).json({ text: '' });
    }

    const esTexts = blobs.filter((b) => ES_TEXT_RE.test(b.pathname));
    const enTexts = blobs.filter((b) => EN_TEXT_RE.test(b.pathname));

    // Prefer the requested language; fall back to Spanish (or to any
    // other file at all) if there's no English announcement yet.
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
