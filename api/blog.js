import { list, put, del } from '@vercel/blob';
import { requireAuth } from './_auth.js';
import { slugify, fetchPublicJson, BLOB_TOKEN } from './_blog-utils.js';

// One function handles all blog operations, picked by HTTP method:
//   GET    /api/blog?lang=es              -> list posts
//   POST   /api/blog        (auth)        -> create/update post
//   DELETE /api/blog        (auth)        -> delete a post
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

async function handleList(request, response) {
  const lang = request.query.lang === 'en' ? 'en' : 'es';
  const category = request.query.category || null;

  try {
    const { blobs } = await list({ prefix: `blog/${lang}/`, token: BLOB_TOKEN });
    const jsonBlobs = blobs.filter((b) => b.pathname.endsWith('.json'));

    // Public blobs are fetched straight from their URL — no SDK read, no
    // Advanced Operation, just a normal HTTP request per post.
    let posts = (await Promise.all(jsonBlobs.map((b) => fetchPublicJson(b.url)))).filter(Boolean);
    if (category && category !== 'todas') {
      posts = posts.filter((p) => p.category === category);
    }
    posts.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

    response.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    return response.status(200).json({ posts });
  } catch (err) {
    return response.status(500).json({ error: err.message, posts: [] });
  }
}

async function handleSave(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const {
    slug: incomingSlug, lang, title, category, text, body,
    imageBase64, imageType, existingImage, publishedAt: incomingPublishedAt,
  } = request.body || {};

  const langKey = lang === 'en' ? 'en' : 'es';
  if (!title || !title.trim()) return response.status(400).json({ error: 'Falta el título' });
  if (!text || !text.trim()) return response.status(400).json({ error: 'Falta el texto' });

  const slug = incomingSlug || slugify(title) || `post-${Date.now()}`;

  // existingImage now carries the direct public URL from a previous save
  // (kept as-is when the person edits a post without changing the photo).
  let image = existingImage || null;
  if (imageBase64) {
    try {
      const ext = (imageType || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const buffer = Buffer.from(imageBase64, 'base64');
      const uploaded = await put(`blog-images/${langKey}-${slug}-${Date.now()}.${ext}`, buffer, {
        access: 'public', contentType: imageType || 'image/jpeg', token: BLOB_TOKEN,
      });
      image = uploaded.url;
    } catch (err) {
      return response.status(500).json({ error: `No se pudo subir la imagen: ${err.message}` });
    }
  }

  const now = new Date().toISOString();
  const post = {
    slug, lang: langKey, title: title.trim(), category: category || 'noticias', text: text.trim(),
    body: body || '', image, author: session.username, publishedAt: incomingPublishedAt || now, updatedAt: now,
  };

  try {
    await put(`blog/${langKey}/${slug}.json`, JSON.stringify(post), {
      access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, token: BLOB_TOKEN,
    });
    return response.status(200).json({ ok: true, post });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}

async function handleDelete(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const { slug, lang } = request.body || {};
  if (!slug) return response.status(400).json({ error: 'Falta el slug del artículo' });
  const langKey = lang === 'en' ? 'en' : 'es';

  try {
    await del(`blog/${langKey}/${slug}.json`, { token: BLOB_TOKEN });
    return response.status(200).json({ ok: true });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}

export default async function handler(request, response) {
  if (request.method === 'GET') return handleList(request, response);
  if (request.method === 'POST') return handleSave(request, response);
  if (request.method === 'DELETE') return handleDelete(request, response);
  return response.status(405).json({ error: 'Método no permitido' });
}
