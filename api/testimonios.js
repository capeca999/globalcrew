import { list, get } from '@vercel/blob';

const TEXT_RE = /\.txt$/i;

function baseName(pathname) {
  return pathname.split('/').pop();
}

// Turns a filename like "PacoPinazo.txt" or "Pau Llorens.txt" (with the
// occasional stray comma/typo) into a clean display name: "Paco Pinazo".
function nameFromFilename(raw) {
  let name = raw.replace(TEXT_RE, '');
  name = name.replace(/,+/g, ' ');       // stray commas -> spaces
  name = name.replace(/\s+/g, ' ').trim();
  // If it's one long CamelCase word with no spaces, split "PacoPinazo" -> "Paco Pinazo"
  if (!name.includes(' ')) {
    name = name.replace(/([a-z\u00e0-\u00fc])([A-Z\u00c0-\u00dc])/g, '$1 $2');
  }
  return name;
}

async function fetchBlobText(pathname) {
  try {
    const result = await get(pathname, { access: 'private' });
    if (!result) return '';
    return (await new Response(result.stream).text()).trim();
  } catch (err) {
    return '';
  }
}

export default async function handler(request, response) {
  try {
    const { blobs } = await list({ prefix: 'testimonios/' });
    const texts = blobs.filter((b) => TEXT_RE.test(b.pathname));

    const testimonials = await Promise.all(
      texts.map(async (t) => {
        const quote = await fetchBlobText(t.pathname);
        const name = nameFromFilename(baseName(t.pathname));
        return { name, quote, uploadedAt: t.uploadedAt };
      })
    );

    // Most recently uploaded first, skip any empty/unreadable files
    const cleaned = testimonials
      .filter((t) => t.quote)
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return response.status(200).json({ testimonials: cleaned });
  } catch (err) {
    return response.status(500).json({ error: err.message, testimonials: [] });
  }
}
