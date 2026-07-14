import { list, get } from '@vercel/blob';
import CITIES from './cities.js';

// ---- Shared matchers ----
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const EN_TEXT_RE = /\.en\.txt$/i;
const ES_TEXT_RE = /(?<!\.en)\.txt$/i;

function baseName(pathname) {
  return pathname.split('/').pop();
}

// Normalizes "Abril" / "abril.txt" / " Abril " / "Ábril" to the same key,
// so filenames match regardless of spacing, case or accents.
function normalize(str) {
  return (str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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

// Turns "PacoPinazo.txt" / "Pau Llorens.txt" into a clean display name.
function nameFromFilename(raw) {
  let name = raw.replace(/,+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name.includes(' ')) {
    name = name.replace(/([a-z\u00e0-\u00fc])([A-Z\u00c0-\u00dc])/g, '$1 $2');
  }
  return name;
}

async function mostRecentText(blobs) {
  if (!blobs.length) return '';
  const sorted = [...blobs].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const result = await fetchBlobText(sorted[0].pathname);
  return result.text;
}

export default async function handler(request, response) {
  const debug = request.query && (request.query.debug === '1' || request.query.debug === 'true');
  const lang = request.query && request.query.lang === 'en' ? 'en' : 'es';

  try {
    // ---- ONE list() call for the entire store ----
    const { blobs: allBlobs } = await list();

    const inFolder = (b, folder) => b.pathname.startsWith(folder);

    const alumniImages = allBlobs.filter((b) => inFolder(b, 'alumnoscontratados/') && IMAGE_RE.test(b.pathname));
    const alumniEsTexts = allBlobs.filter((b) => inFolder(b, 'alumnoscontratados/') && ES_TEXT_RE.test(b.pathname));
    const alumniEnTexts = allBlobs.filter((b) => inFolder(b, 'alumnoscontratados/') && EN_TEXT_RE.test(b.pathname));
    const logos = allBlobs.filter((b) => inFolder(b, 'logo/') && IMAGE_RE.test(b.pathname));
    const testiEsTexts = allBlobs.filter((b) => inFolder(b, 'testimonios/') && ES_TEXT_RE.test(b.pathname));
    const testiEnTexts = allBlobs.filter((b) => inFolder(b, 'testimonios/') && EN_TEXT_RE.test(b.pathname));
    const courseBlobs = allBlobs.filter((b) => inFolder(b, 'proximoscursos/'));

    // ================= ALUMNI =================
    const esIndex = buildTextIndex(alumniEsTexts, ES_TEXT_RE);
    const enIndex = buildTextIndex(alumniEnTexts, EN_TEXT_RE);

    const logoByAirline = {};
    for (const l of logos) {
      logoByAirline[normalize(baseName(l.pathname).replace(IMAGE_RE, ''))] = l.pathname;
    }

    const firstNameCounts = {};
    for (const img of alumniImages) {
      const raw = baseName(img.pathname).replace(IMAGE_RE, '');
      const firstKey = normalize(raw.split(',')[0]);
      firstNameCounts[firstKey] = (firstNameCounts[firstKey] || 0) + 1;
    }

    const debugAlumni = [];

    const alumni = await Promise.all(
      alumniImages.map(async (img) => {
        const filename = baseName(img.pathname).replace(IMAGE_RE, '');
        const [rawName, rawAirline, rawCity] = filename.split(',');
        const name = (rawName || filename).trim();
        const airline = (rawAirline || '').trim();
        const cityName = (rawCity || '').trim();

        const fullKey = normalize(filename.trim());
        const firstKey = normalize(name);
        const isFirstNameUnique = firstNameCounts[firstKey] === 1;

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
          name, airline, quote,
          city: city ? city.name : null,
          cityLat: city ? city.lat : null,
          cityLon: city ? city.lon : null,
          photoUrl: proxiedImageUrl(request, img.pathname),
          airlineLogoUrl: logoPath ? proxiedImageUrl(request, logoPath) : null,
          uploadedAt: img.uploadedAt
        };
      })
    );
    alumni.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    // ================= TESTIMONIALS =================
    const testiEnByName = {};
    for (const t of testiEnTexts) {
      const raw = baseName(t.pathname).replace(EN_TEXT_RE, '');
      testiEnByName[normalize(nameFromFilename(raw))] = t;
    }

    const testimonials = await Promise.all(
      testiEsTexts.map(async (t) => {
        const rawName = baseName(t.pathname).replace(ES_TEXT_RE, '');
        const name = nameFromFilename(rawName);
        const key = normalize(name);

        let sourceBlob = t;
        if (lang === 'en' && testiEnByName[key]) sourceBlob = testiEnByName[key];

        const result = await fetchBlobText(sourceBlob.pathname);
        return { name, quote: result.text, uploadedAt: t.uploadedAt };
      })
    );
    const cleanedTestimonials = testimonials
      .filter((t) => t.quote)
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    // ================= NEXT COURSE DATE =================
    const courseEsTexts = courseBlobs.filter((b) => ES_TEXT_RE.test(b.pathname));
    const courseEnTexts = courseBlobs.filter((b) => EN_TEXT_RE.test(b.pathname));
    let nextCourseText = '';
    if (lang === 'en' && courseEnTexts.length) {
      nextCourseText = await mostRecentText(courseEnTexts);
    }
    if (!nextCourseText) {
      nextCourseText = await mostRecentText(courseEsTexts.length ? courseEsTexts : courseBlobs);
    }

    // ================= RESPONSE =================
    if (!debug) {
      // 1 hour cache: fewer Advanced Operations, still fresh enough for how
      // often this content actually changes. Vercel serves the cached
      // version instantly and revalidates in the background afterwards.
      response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    }

    const payload = { alumni, testimonials: cleanedTestimonials, nextCourseText };
    if (debug) {
      payload.debug = {
        lang,
        totalBlobsListed: allBlobs.length,
        alumniEsTextFilesFound: alumniEsTexts.map((t) => baseName(t.pathname)),
        alumniEnTextFilesFound: alumniEnTexts.map((t) => baseName(t.pathname)),
        matching: debugAlumni
      };
    }
    return response.status(200).json(payload);
  } catch (err) {
    return response.status(500).json({ error: err.message, alumni: [], testimonials: [], nextCourseText: '' });
  }
}
