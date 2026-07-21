import { put } from '@vercel/blob';
import { requireAuth } from './_auth.js';
import { slugify } from './_blog-utils.js';

// Allow a slightly larger body since images travel as base64.
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Método no permitido' });
  }

  const session = requireAuth(request, response);
  if (!session) return; // requireAuth already sent the 401

  const {
    slug: incomingSlug,
    lang,
    title,
    category,
    text,
    imageBase64,   // optional: new image, sent as base64 (no data: prefix)
    imageType,     // e.g. "image/jpeg"
    existingImage, // optional: keep this image URL when editing without changing the photo
    publishedAt: incomingPublishedAt,
  } = request.body || {};

  const langKey = lang === 'en' ? 'en' : 'es';

  if (!title || !title.trim()) {
    return response.status(400).json({ error: 'Falta el título' });
  }
  if (!text || !text.trim()) {
    return response.status(400).json({ error: 'Falta el texto' });
  }

  const slug = incomingSlug || slugify(title) || `post-${Date.now()}`;

  let image = existingImage || null;
  if (imageBase64) {
    try {
      const ext = (imageType || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const buffer = Buffer.from(imageBase64, 'base64');
      const uploaded = await put(`blog-images/${langKey}-${slug}-${Date.now()}.${ext}`, buffer, {
        access: 'public',
        contentType: imageType || 'image/jpeg',
      });
      image = uploaded.url;
    } catch (err) {
      return response.status(500).json({ error: `No se pudo subir la imagen: ${err.message}` });
    }
  }

  const now = new Date().toISOString();
  const post = {
    slug,
    lang: langKey,
    title: title.trim(),
    category: category || 'noticias',
    text: text.trim(),
    image,
    author: session.username,
    publishedAt: incomingPublishedAt || now,
    updatedAt: now,
  };

  try {
    await put(`blog/${langKey}/${slug}.json`, JSON.stringify(post), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return response.status(200).json({ ok: true, post });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}
