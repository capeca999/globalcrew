import { list } from '@vercel/blob';
import { readJsonBlob } from './_blog-utils.js';

export default async function handler(request, response) {
  const lang = request.query.lang === 'en' ? 'en' : 'es';
  const category = request.query.category || null;

  try {
    const { blobs } = await list({ prefix: `blog/${lang}/` });
    const jsonBlobs = blobs.filter((b) => b.pathname.endsWith('.json'));

    let posts = (await Promise.all(jsonBlobs.map((b) => readJsonBlob(b.pathname)))).filter(Boolean);
    if (category && category !== 'todas') {
      posts = posts.filter((p) => p.category === category);
    }
    posts.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

    response.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    return response.status(200).json({ posts });
  } catch (err) {
    return response.status(500).json({ error: err.message, posts: [] });
  }
}
