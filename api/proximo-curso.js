import { list, get } from '@vercel/blob';

export default async function handler(request, response) {
  try {
    const { blobs } = await list({ prefix: 'proximoscursos/' });

    if (!blobs.length) {
      return response.status(200).json({ text: '' });
    }

    const texts = blobs.filter((b) => /\.txt$/i.test(b.pathname));
    const candidates = texts.length ? texts : blobs;

    // Use the most recently uploaded file, so publishing a new .txt
    // automatically replaces the announcement without touching the code.
    candidates.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    const target = candidates[0];

    const result = await get(target.pathname, { access: 'private' });
    if (!result) {
      return response.status(200).json({ text: '' });
    }
    const text = (await new Response(result.stream).text()).trim();

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return response.status(200).json({ text });
  } catch (err) {
    return response.status(500).json({ error: err.message, text: '' });
  }
}
