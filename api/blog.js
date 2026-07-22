import { list, put, del } from '@vercel/blob';
import { requireAuth, getSession } from './_auth.js';
import { slugify, fetchPublicJson, BLOB_TOKEN } from './_blog-utils.js';

// One function handles all blog operations, picked by HTTP method:
//   GET    /api/blog?lang=es                 -> list posts, resolved to one language
//   GET    /api/blog?slug=xxx                -> one post, BOTH languages included
//                                                (so blog-post.html can switch language
//                                                without another request)
//   POST   /api/blog        (auth)           -> create/update a post (both languages at once)
//   DELETE /api/blog        (auth)           -> delete a post
//
// Each post is now a single JSON blob at blog/{slug}.json with the shape:
//   { slug, category, image, es: {title,text,body}, en: {title,text,body}, author, publishedAt, updatedAt }
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

function resolveForLang(post, lang) {
  const primary = post[lang] || {};
  const other = post[lang === 'en' ? 'es' : 'en'] || {};
  return {
    slug: post.slug,
    category: post.category,
    image: post.image || null,
    title: primary.title || other.title || '',
    text: primary.text || other.text || '',
    body: primary.body || other.body || '',
    hasEs: !!(post.es && post.es.title),
    hasEn: !!(post.en && post.en.title),
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
  };
}

async function handleGetOne(request, response) {
  const slug = request.query.slug;

  try {
    const { blobs } = await list({ prefix: `blog/${slug}.json`, token: BLOB_TOKEN });
    const match = blobs.find((b) => b.pathname === `blog/${slug}.json`);
    if (!match) return response.status(404).json({ error: 'Artículo no encontrado' });

    const post = await fetchPublicJson(match.url);
    if (!post) return response.status(404).json({ error: 'Artículo no encontrado' });

    // A logged-in admin (checking their own edit, or right after a delete)
    // always gets a fresh read — only public, unauthenticated visitors get
    // the 10-minute cache.
    response.setHeader('Cache-Control', getSession(request) ? 'no-store' : 's-maxage=600, stale-while-revalidate=3600');
    // Full bilingual object — the caller (blog-post.html, or the admin edit
    // form) picks which language block to show/edit.
    return response.status(200).json({ post });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}

async function handleList(request, response) {
  if (request.query.slug) return handleGetOne(request, response);

  const lang = request.query.lang === 'en' ? 'en' : 'es';
  const category = request.query.category || null;

  try {
    const { blobs } = await list({ prefix: 'blog/', token: BLOB_TOKEN });
    const jsonBlobs = blobs.filter((b) => b.pathname.endsWith('.json'));

    const rawPosts = (await Promise.all(jsonBlobs.map((b) => fetchPublicJson(b.url)))).filter(Boolean);
    let posts = rawPosts.map((p) => resolveForLang(p, lang));
    if (category && category !== 'todas') {
      posts = posts.filter((p) => p.category === category);
    }
    posts.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

    // Same idea: the admin panel's own listing (right after adding/editing/
    // deleting a post) always gets a fresh read; public visitors get the cache.
    response.setHeader('Cache-Control', getSession(request) ? 'no-store' : 's-maxage=600, stale-while-revalidate=3600');
    return response.status(200).json({ posts });
  } catch (err) {
    return response.status(500).json({ error: err.message, posts: [] });
  }
}

async function handleSave(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const {
    slug: incomingSlug, category,
    titleEs, textEs, bodyEs,
    titleEn, textEn, bodyEn,
    imageBase64, imageType, existingImage, publishedAt: incomingPublishedAt,
  } = request.body || {};

  if (!titleEs || !titleEs.trim()) return response.status(400).json({ error: 'Falta el título en español' });
  if (!textEs || !textEs.trim()) return response.status(400).json({ error: 'Falta el extracto en español' });

  const slug = incomingSlug || slugify(titleEs) || `post-${Date.now()}`;

  let image = existingImage || null;
  if (imageBase64) {
    try {
      const ext = (imageType || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const buffer = Buffer.from(imageBase64, 'base64');
      const uploaded = await put(`blog-images/${slug}-${Date.now()}.${ext}`, buffer, {
        access: 'public', contentType: imageType || 'image/jpeg', token: BLOB_TOKEN,
      });
      image = uploaded.url;
    } catch (err) {
      return response.status(500).json({ error: `No se pudo subir la imagen: ${err.message}` });
    }
  }

  const now = new Date().toISOString();
  const post = {
    slug,
    category: category || 'noticias',
    image,
    es: { title: titleEs.trim(), text: textEs.trim(), body: bodyEs || '' },
    en: (titleEn && titleEn.trim()) ? { title: titleEn.trim(), text: (textEn || '').trim(), body: bodyEn || '' } : null,
    author: session.username,
    publishedAt: incomingPublishedAt || now,
    updatedAt: now,
  };

  try {
    await put(`blog/${slug}.json`, JSON.stringify(post), {
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

  const { slug } = request.body || {};
  if (!slug) return response.status(400).json({ error: 'Falta el slug del artículo' });

  try {
    await del(`blog/${slug}.json`, { token: BLOB_TOKEN });
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
