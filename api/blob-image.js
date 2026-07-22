import { get } from '@vercel/blob';

// Only allow proxying files inside these known folders, to avoid
// this route being used to fetch arbitrary paths from the store.
const ALLOWED_PREFIXES = ['alumnoscontratados/', 'proximoscursos/', 'logo/', 'blog-images/', 'blog/'];

// Blog post images always get a fresh, unique filename on every save (see
// blog.js), so their content at a given path never changes — safe to cache
// for a long time. Alumni photos and airline logos, on the other hand, can
// be overwritten in place when someone edits them from the admin panel, so
// they get a shorter cache instead (otherwise an edit could take up to a
// month to show up on the site).
function cacheControlFor(path) {
  if (path.startsWith('blog-images/')) {
    return 'public, max-age=2592000, s-maxage=2592000, immutable'; // 30 days
  }
  return 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'; // 1h / 24h
}

export default async function handler(request, response) {
  const { path } = request.query;

  if (!path || typeof path !== 'string' || !ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
    return response.status(400).send('Invalid or missing path');
  }

  try {
    const result = await get(path, { access: 'private' });
    if (!result) {
      return response.status(404).send('Not found');
    }

    const arrayBuffer = await new Response(result.stream).arrayBuffer();

    response.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
    response.setHeader('Cache-Control', cacheControlFor(path));
    return response.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    return response.status(500).send('Error fetching blob image');
  }
}
