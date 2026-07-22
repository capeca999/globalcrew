// The Blob store is now PUBLIC (store "globalcrewpublic"), so this token
// must be passed explicitly to every @vercel/blob call in every file —
// otherwise the SDK falls back to the default BLOB_READ_WRITE_TOKEN env
// var, which would point at the old private store instead.
export const BLOB_TOKEN = process.env.publicblob_READ_WRITE_TOKEN;

export function slugify(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 80);
}

// Public blobs are fetchable directly at their URL, no SDK round-trip (and
// no Advanced Operation) needed just to read a text file's contents.
export async function fetchPublicText(url) {
  if (!url) return '';
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    return (await res.text()).trim();
  } catch {
    return '';
  }
}

// Same idea for the JSON blog-post files.
export async function fetchPublicJson(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
