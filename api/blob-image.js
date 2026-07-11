import { get } from '@vercel/blob';

// Only allow proxying files inside these known folders, to avoid
// this route being used to fetch arbitrary paths from the store.
const ALLOWED_PREFIXES = ['alumnoscontratados/', 'proximoscursos/', 'logo/'];

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
    response.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    return response.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    return response.status(500).send('Error fetching blob image');
  }
}
