import { get } from '@vercel/blob';

// Streams a private Blob file through the server using the SDK's get(),
// so <img> tags in the browser can show it without needing credentials.

export default async function handler(request, response) {
  const { path } = request.query;

  if (!path || typeof path !== 'string' || !path.startsWith('alumnoscontratados/')) {
    return response.status(400).send('Invalid or missing path');
  }

  try {
    const result = await get(path, { access: 'private' });

    if (!result || !result.stream) {
      return response.status(404).send('Blob not found');
    }

    const reader = result.stream.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }

    response.setHeader('Content-Type', result.blob?.contentType || 'application/octet-stream');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    return response.status(200).send(Buffer.concat(chunks));
  } catch (err) {
    return response.status(500).send('Error fetching blob image');
  }
}
