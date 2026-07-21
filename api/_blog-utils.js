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

export const CATEGORIES = ['noticias', 'vida', 'curso', 'curiosidades'];
