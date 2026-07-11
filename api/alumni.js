import { list, get } from '@vercel/blob';

// Matches image files: "Nombre, Aerolinea.jpg" (case-insensitive extension)
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const TEXT_RE = /\.txt$/i;

function baseName(pathname) {
  return pathname.split('/').pop();
}

// Normalizes "Abril" / "abril.txt" / " Abril " / "Ábril" to the same key,
// so filenames match even with different spacing, case or accents.
function normalize(str) {
  return (str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function fetchBlobText(pathname) {
  try {
    const result = await get(pathname, { access: 'private' });
    if (!result) return { text: '', error: 'not_found' };
    const text = await new Response(result.stream).text();
    return { text: text.trim(), error: null };
  } catch (err) {
    return { text: '', error: err.message };
  }
}

function proxiedImageUrl(request, pathname) {
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  const protocol = request.headers['x-forwarded-proto'] || 'https';
  const base = host ? `${protocol}://${host}` : '';
  return `${base}/api/blob-image?path=${encodeURIComponent(pathname)}`;
}

export default async function handler(request, response) {
  const debug = request.query && (request.query.debug === '1' || request.query.debug === 'true');

  try {
    const [{ blobs }, logoResult] = await Promise.all([
      list({ prefix: 'alumnoscontratados/' }),
      list({ prefix: 'logo/' })
    ]);

    const images = blobs.filter((b) => IMAGE_RE.test(b.pathname));
    const texts = blobs.filter((b) => TEXT_RE.test(b.pathname));
    const logos = logoResult.blobs.filter((b) => IMAGE_RE.test(b.pathname));

    // Index quote files by the student's normalized first name
    const textByName = {};
    for (const t of texts) {
      const key = normalize(baseName(t.pathname).replace(TEXT_RE, ''));
      textByName[key] = t.pathname;
    }

    // Index airline logos by normalized airline name
    const logoByAirline = {};
    for (const l of logos) {
      const key = normalize(baseName(l.pathname).replace(IMAGE_RE, ''));
      logoByAirline[key] = l.pathname;
    }

    const debugAlumni = [];

    const alumni = await Promise.all(
      images.map(async (img) => {
        const filename = baseName(img.pathname).replace(IMAGE_RE, '');
        const [rawName, rawAirline] = filename.split(',');
        const name = (rawName || filename).trim();
        const airline = (rawAirline || '').trim();
        const key = normalize(name);

        let quote = '';
        let textLookup = { matchedKey: key, foundTextFile: textByName[key] || null, fetchError: null };
        if (textByName[key]) {
          const result = await fetchBlobText(textByName[key]);
          quote = result.text;
          textLookup.fetchError = result.error;
        } else {
          textLookup.fetchError = 'no_matching_txt_file';
        }
        if (!quote) {
          quote = airline
            ? `Antiguo alumno de Global Crew, ahora contratado en ${airline}.`
            : 'Antiguo alumno de Global Crew, ¡ya está volando!';
        }

        const logoPath = airline ? logoByAirline[normalize(airline)] : null;

        if (debug) debugAlumni.push({ imageFile: baseName(img.pathname), name, airline, ...textLookup });

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

    if (!debug) {
      response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    }

    const payload = { alumni };
    if (debug) {
      payload.debug = {
        textFilesFoundInFolder: texts.map((t) => baseName(t.pathname)),
        matching: debugAlumni
      };
    }
    return response.status(200).json(payload);
  } catch (err) {
    return response.status(500).json({ error: err.message, alumni: [] });
  }
}
