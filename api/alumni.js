import { list, get } from '@vercel/blob';

// Matches image files: "Nombre, Aerolinea.jpg" (case-insensitive extension)
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const TEXT_RE = /\.txt$/i;

function baseName(pathname) {
  return pathname.split('/').pop();
}

// Normalizes "Air Nostrum" / "airnostrum.jpg" / "TradeAir" to the same key,
// so the airline name in the photo filename can be matched against the
// logo filenames in the logo/ folder regardless of spacing or case.
function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchBlobText(pathname) {
  try {
    const result = await get(pathname, { access: 'private' });
    if (!result) return '';
    const text = await new Response(result.stream).text();
    return text.trim();
  } catch (err) {
    return '';
  }
}

function proxiedImageUrl(request, pathname) {
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  const protocol = request.headers['x-forwarded-proto'] || 'https';
  const base = host ? `${protocol}://${host}` : '';
  return `${base}/api/blob-image?path=${encodeURIComponent(pathname)}`;
}

export default async function handler(request, response) {
  try {
    const [{ blobs }, logoResult] = await Promise.all([
      list({ prefix: 'alumnoscontratados/' }),
      list({ prefix: 'logo/' })
    ]);

    const images = blobs.filter((b) => IMAGE_RE.test(b.pathname));
    const texts = blobs.filter((b) => TEXT_RE.test(b.pathname));
    const logos = logoResult.blobs.filter((b) => IMAGE_RE.test(b.pathname));

    // Index quote files by the student's first name (lowercased, trimmed)
    const textByName = {};
    for (const t of texts) {
      const key = baseName(t.pathname).replace(TEXT_RE, '').trim().toLowerCase();
      textByName[key] = t.pathname;
    }

    // Index airline logos by normalized airline name
    const logoByAirline = {};
    for (const l of logos) {
      const key = normalize(baseName(l.pathname).replace(IMAGE_RE, ''));
      logoByAirline[key] = l.pathname;
    }

    const alumni = await Promise.all(
      images.map(async (img) => {
        const filename = baseName(img.pathname).replace(IMAGE_RE, '');
        const [rawName, rawAirline] = filename.split(',');
        const name = (rawName || filename).trim();
        const airline = (rawAirline || '').trim();
        const key = name.toLowerCase();

        let quote = '';
        if (textByName[key]) {
          quote = await fetchBlobText(textByName[key]);
        }
        if (!quote) {
          quote = airline
            ? `Antiguo alumno de Global Crew, ahora contratado en ${airline}.`
            : 'Antiguo alumno de Global Crew, ¡ya está volando!';
        }

        const logoPath = airline ? logoByAirline[normalize(airline)] : null;

        return {
          name,
          airline,
          quote,
          photoUrl: proxiedImageUrl(request, img.pathname),
          airlineLogoUrl: logoPath ? proxiedImageUrl(request, logoPath) : null,
          uploadedAt: img.uploadedAt
        };
      })
    );

    // Most recently uploaded first
    alumni.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return response.status(200).json({ alumni });
  } catch (err) {
    return response.status(500).json({ error: err.message, alumni: [] });
  }
}
