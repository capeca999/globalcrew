import { list, get } from '@vercel/blob';
import CITIES from './cities.js';

// Matches image files: "Nombre, Aerolinea, Ciudad.jpg" (case-insensitive extension)
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
// English quote files end in ".en.txt"; Spanish (default) ones just end in ".txt"
const EN_TEXT_RE = /\.en\.txt$/i;
const ES_TEXT_RE = /(?<!\.en)\.txt$/i;

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

// Builds "full name" and "first name" lookup indexes for a set of text
// blobs, matching the same rules used for Spanish quote files: prefer an
// exact match on the full filename, fall back to first-name-only only
// when that first name isn't ambiguous among the photos.
function buildTextIndex(texts, stripRe) {
  const byFullName = {};
  const byFirstName = {};
  for (const t of texts) {
    const raw = baseName(t.pathname).replace(stripRe, '').trim();
    const fullKey = normalize(raw);
    byFullName[fullKey] = t.pathname;
    const firstKey = normalize(raw.split(',')[0]);
    if (!(firstKey in byFirstName)) {
      byFirstName[firstKey] = t.pathname;
    } else {
      byFirstName[firstKey] = null; // ambiguous, disable fallback
    }
  }
  return { byFullName, byFirstName };
}

function resolveTextPath(index, fullKey, firstKey, isFirstNameUnique) {
  if (index.byFullName[fullKey]) return { path: index.byFullName[fullKey], source: 'full_name' };
  if (isFirstNameUnique && index.byFirstName[firstKey]) return { path: index.byFirstName[firstKey], source: 'first_name_fallback' };
  return { path: null, source: null };
}

export default async function handler(request, response) {
  const debug = request.query && (request.query.debug === '1' || request.query.debug === 'true');
  const lang = request.query && request.query.lang === 'en' ? 'en' : 'es';

  try {
    const [{ blobs }, logoResult] = await Promise.all([
      list({ prefix: 'alumnoscontratados/' }),
      list({ prefix: 'logo/' })
    ]);

    const images = blobs.filter((b) => IMAGE_RE.test(b.pathname));
    const esTexts = blobs.filter((b) => ES_TEXT_RE.test(b.pathname));
    const enTexts = blobs.filter((b) => EN_TEXT_RE.test(b.pathname));
    const logos = logoResult.blobs.filter((b) => IMAGE_RE.test(b.pathname));

    // Two independent indexes: Spanish quote files ("Nombre, Aerolinea,
    // Ciudad.txt") and English ones ("Nombre, Aerolinea, Ciudad.en.txt").
    // The English one is optional — if it isn't there, we fall back to
    // the Spanish quote so nothing ever ends up blank.
    const esIndex = buildTextIndex(esTexts, ES_TEXT_RE);
    const enIndex = buildTextIndex(enTexts, EN_TEXT_RE);

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

        // Prefer the requested language; fall back to Spanish if there's
        // no English quote yet for this person.
        let resolved = lang === 'en'
          ? resolveTextPath(enIndex, fullKey, firstKey, isFirstNameUnique)
          : { path: null, source: null };
        let usedLang = 'en';
        if (!resolved.path) {
          resolved = resolveTextPath(esIndex, fullKey, firstKey, isFirstNameUnique);
          usedLang = 'es';
        }

        let quote = '';
        let fetchError = null;
        if (resolved.path) {
          const result = await fetchBlobText(resolved.path);
          quote = result.text;
          fetchError = result.error;
        } else {
          fetchError = 'no_matching_txt_file';
        }
        if (!quote) {
          quote = lang === 'en'
            ? (airline ? `Former Global Crew student, now hired at ${airline}.` : 'Former Global Crew student, already flying!')
            : (airline ? `Antiguo alumno de Global Crew, ahora contratado en ${airline}.` : 'Antiguo alumno de Global Crew, ¡ya está volando!');
        }

        const logoPath = airline ? logoByAirline[normalize(airline)] : null;
        const city = lookupCity(cityName);

        if (debug) {
          debugAlumni.push({
            imageFile: baseName(img.pathname), name, airline, cityName,
            cityMatched: !!city, requestedLang: lang, usedLang,
            matchedTextFile: resolved.path, matchSource: resolved.source, fetchError,
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
        lang,
        esTextFilesFound: esTexts.map((t) => baseName(t.pathname)),
        enTextFilesFound: enTexts.map((t) => baseName(t.pathname)),
        matching: debugAlumni
      };
    }
    return response.status(200).json(payload);
  } catch (err) {
    return response.status(500).json({ error: err.message, alumni: [] });
  }
}
