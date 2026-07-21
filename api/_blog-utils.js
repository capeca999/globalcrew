import { get } from '@vercel/blob';

export function slugify(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 80);
}

export async function readJsonBlob(pathname) {
  try {
    const result = await get(pathname, { access: 'private' });
    if (!result) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Same pattern already used for alumni photos in home-data.js: the Blob
// store here is private, so images are served through this proxy instead
// of a direct public URL.
export function proxiedImageUrl(request, pathname) {
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  const protocol = request.headers['x-forwarded-proto'] || 'https';
  const base = host ? `${protocol}://${host}` : '';
  return `${base}/api/blob-image?path=${encodeURIComponent(pathname)}`;
}

export const CATEGORIES = ['noticias', 'vida', 'curso', 'curiosidades'];
