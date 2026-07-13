import { list, get } from '@vercel/blob';

// English quote files end in ".en.txt"; Spanish (default) ones just end in ".txt"
const EN_TEXT_RE = /\.en\.txt$/i;
const ES_TEXT_RE = /(?<!\.en)\.txt$/i;

function baseName(pathname) {
  return pathname.split('/').pop();
}

function normalize(str) {
  return (str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Turns a filename like "PacoPinazo.txt" or "Pau Llorens.txt" (with the
// occasional stray comma/typo) into a clean display name: "Paco Pinazo".
function nameFromFilename(raw) {
  let name = raw;
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
  const lang = request.query && request.query.lang === 'en' ? 'en' : 'es';

  try {
    const { blobs } = await list({ prefix: 'testimonios/' });
    const esTexts = blobs.filter((b) => ES_TEXT_RE.test(b.pathname));
    const enTexts = blobs.filter((b) => EN_TEXT_RE.test(b.pathname));

    // Index English files by normalized display name, so we can pair each
    // Spanish testimonial with its optional English translation.
    const enByName = {};
    for (const t of enTexts) {
      const raw = baseName(t.pathname).replace(EN_TEXT_RE, '');
      enByName[normalize(nameFromFilename(raw))] = t;
    }

    const testimonials = await Promise.all(
      esTexts.map(async (t) => {
        const rawName = baseName(t.pathname).replace(ES_TEXT_RE, '');
        const name = nameFromFilename(rawName);
        const key = normalize(name);

        let sourceBlob = t;
        if (lang === 'en' && enByName[key]) {
          sourceBlob = enByName[key];
        }

        const quote = await fetchBlobText(sourceBlob.pathname);
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
