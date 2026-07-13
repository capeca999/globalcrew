import { list, get } from '@vercel/blob';
import CITIES from './cities.js';

// Matches image files: "Nombre, Aerolinea, Ciudad.jpg" (case-insensitive extension)
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

function lookupCity(cityName) {
  if (!cityName) return null;
  const entry = CITIES[normalize(cityName)];
  if (!entry) return null;
  return { name: entry.display, lat: entry.lat, lon: entry.lon };
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

    // Index quote files two ways:
    //  - by their FULL filename ("Abril, Air Arabia, Sharjah") — the
    //    recommended way, matches the photo exactly, so two people with the
    //    same first name never collide as long as their .txt is named just
    //    like their photo.
    //  - by first name only ("Abril") — kept as a fallback for older uploads
    //    that only used the first name, but only used when that first name
    //    is unique among the photos (otherwise it's ambiguous and skipped).
    const textByFullName = {};
    const textByFirstName = {};
    for (const t of texts) {
      const raw = baseName(t.pathname).replace(TEXT_RE, '').trim();
      const fullKey = normalize(raw);
      textByFullName[fullKey] = t.pathname;
      const firstKey = normalize(raw.split(',')[0]);
      // Only keep first-name fallback if not already claimed by another text file
      if (!(firstKey in textByFirstName)) {
        textByFirstName[firstKey] = t.pathname;
      } else {
        textByFirstName[firstKey] = null; // ambiguous, disable fallback
      }
    }

    // Index airline logos by normalized airline name
    const logoByAirline = {};
    for (const l of logos) {
      const key = normalize(baseName(l.pathname).replace(IMAGE_RE, ''));
      logoByAirline[key] = l.pathname;
    }

    // Count how many photos share each first name, to know if the
    // first-name-only fallback would be ambiguous for a given photo.
    const firstNameCounts = {};
    for (const img of images) {
      const raw = baseName(img.pathname).replace(IMAGE_RE, '');
      const firstKey = normalize(raw.split(',')[0]);
      firstNameCounts[firstKey] = (firstNameCounts[firstKey] || 0) + 1;
    }

    const debugAlumni = [];

    const alumni = await Promise.all(
      images.map(async (img) => {
        const filename = baseName(img.pathname).replace(IMAGE_RE, '');
        // "Nombre, Aerolinea, Ciudad" — city is optional (older uploads may
        // only have "Nombre, Aerolinea", which is still fully supported,
        // it just won't get a point on the world map).
        const [rawName, rawAirline, rawCity] = filename.split(',');
        const name = (rawName || filename).trim();
        const airline = (rawAirline || '').trim();
        const cityName = (rawCity || '').trim();

        const fullKey = normalize(filename.trim());
        const firstKey = normalize(name);
        const isFirstNameUnique = firstNameCounts[firstKey] === 1;

        let matchedTextPath = textByFullName[fullKey] || null;
        let matchSource = matchedTextPath ? 'full_name' : null;
        if (!matchedTextPath && isFirstNameUnique && textByFirstName[firstKey]) {
          matchedTextPath = textByFirstName[firstKey];
          matchSource = 'first_name_fallback';
        }

        let quote = '';
        let fetchError = null;
        if (matchedTextPath) {
          const result = await fetchBlobText(matchedTextPath);
          quote = result.text;
          fetchError = result.error;
        } else {
          fetchError = 'no_matching_txt_file';
        }
        if (!quote) {
          quote = airline
            ? `Antiguo alumno de Global Crew, ahora contratado en ${airline}.`
            : 'Antiguo alumno de Global Crew, ¡ya está volando!';
        }

        const logoPath = airline ? logoByAirline[normalize(airline)] : null;
        const city = lookupCity(cityName);

        if (debug) {
          debugAlumni.push({
            imageFile: baseName(img.pathname), name, airline, cityName,
            cityMatched: !!city, matchedTextFile: matchedTextPath, matchSource, fetchError,
            firstNameIsAmbiguous: !isFirstNameUnique
          });
        }

        return {
          name,
          airline,
          quote,
          city: city ? city.name : null,
          cityLat: city ? city.lat : null,
          cityLon: city ? city.lon : null,
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
