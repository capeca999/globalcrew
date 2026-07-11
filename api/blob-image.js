// Streams a private Blob file through the server using the read-write token,
// so <img> tags in the browser can show it without exposing the token.

const ALLOWED_HOST_FRAGMENT = '.blob.vercel-storage.com';

export default async function handler(request, response) {
  const { url } = request.query;

  if (!url || typeof url !== 'string' || !url.includes(ALLOWED_HOST_FRAGMENT)) {
    return response.status(400).send('Invalid or missing url');
  }

  try {
    const blobRes = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
    });

    if (!blobRes.ok) {
      return response.status(blobRes.status).send('Blob fetch failed');
    }

    const contentType = blobRes.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await blobRes.arrayBuffer();

    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    return response.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    return response.status(500).send('Error fetching blob image');
  }
}
