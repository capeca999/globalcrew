import CITIES from './_cities.js';
import { requireAuth, getSession } from './_auth.js';
import { fetchPublicText, fetchPublicJson, listObjects, putObject, checkWriteBudget, publicUrl } from './_blog-utils.js';

// ---- Shared matchers ----
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const EN_TEXT_RE = /\.en\.txt$/i;
const ES_TEXT_RE = /(?<!\.en)\.txt$/i;

// The 16 slots in the seat-map gallery on the homepage: 4 rows, A-D each.
const SEAT_IDS = ['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D', '3A', '3B', '3C', '3D', '4A', '4B', '4C', '4D'];
const SEATMAP_KEY = 'seatmap/seats.json';

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

function buildTextIndex(texts, stripRe) {
  const byFullName = {};
  const byFirstName = {};
  for (const t of texts) {
    const raw = baseName(t.pathname).replace(stripRe, '').trim();
    const fullKey = normalize(raw);
    byFullName[fullKey] = t.url;
    const firstKey = normalize(raw.split(',')[0]);
    if (!(firstKey in byFirstName)) {
      byFirstName[firstKey] = t.url;
    } else {
      byFirstName[firstKey] = null; // ambiguous, disable fallback
    }
  }
  return { byFullName, byFirstName };
}

function resolveTextUrl(index, fullKey, firstKey, isFirstNameUnique) {
  if (index.byFullName[fullKey]) return { url: index.byFullName[fullKey], source: 'full_name' };
  if (isFirstNameUnique && index.byFirstName[firstKey]) return { url: index.byFirstName[firstKey], source: 'first_name_fallback' };
  return { url: null, source: null };
}

// Picks the most recently uploaded text file and returns its contents.
async function mostRecentText(blobs) {
  if (!blobs.length) return '';
  const sorted = [...blobs].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return fetchPublicText(sorted[0].url);
}

async function handleRead(request, response) {
  const debug = request.query && (request.query.debug === '1' || request.query.debug === 'true');
  const lang = request.query && request.query.lang === 'en' ? 'en' : 'es';

  try {
    // ---- ONE listObjects() call for the entire bucket ----
    const allBlobs = await listObjects('');

    const inFolder = (b, folder) => b.pathname.startsWith(folder);

    const alumniImages = allBlobs.filter((b) => inFolder(b, 'alumnoscontratados/') && IMAGE_RE.test(b.pathname));
    const alumniEsTexts = allBlobs.filter((b) => inFolder(b, 'alumnoscontratados/') && ES_TEXT_RE.test(b.pathname));
    const alumniEnTexts = allBlobs.filter((b) => inFolder(b, 'alumnoscontratados/') && EN_TEXT_RE.test(b.pathname));
    const logos = allBlobs.filter((b) => inFolder(b, 'logo/') && IMAGE_RE.test(b.pathname));
    const courseBlobs = allBlobs.filter((b) => inFolder(b, 'proximoscursos/'));

    // ================= ALUMNI =================
    const esIndex = buildTextIndex(alumniEsTexts, ES_TEXT_RE);
    const enIndex = buildTextIndex(alumniEnTexts, EN_TEXT_RE);

    const logoByAirline = {};
    for (const l of logos) {
      logoByAirline[normalize(baseName(l.pathname).replace(IMAGE_RE, ''))] = l.url;
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
          ? resolveTextUrl(enIndex, fullKey, firstKey, isFirstNameUnique)
          : { url: null, source: null };
        let usedLang = 'en';
        if (!resolved.url) {
          resolved = resolveTextUrl(esIndex, fullKey, firstKey, isFirstNameUnique);
          usedLang = 'es';
        }

        let quote = resolved.url ? await fetchPublicText(resolved.url) : '';
        if (!quote) {
          quote = lang === 'en'
            ? (airline ? `Former Global Crew student, now hired at ${airline}.` : 'Former Global Crew student, already flying!')
            : (airline ? `Antiguo alumno de Global Crew, ahora contratado en ${airline}.` : 'Antiguo alumno de Global Crew, ¡ya está volando!');
        }

        const logoUrl = airline ? logoByAirline[normalize(airline)] : null;
        const city = lookupCity(cityName);

        if (debug) {
          debugAlumni.push({
            imageFile: baseName(img.pathname), name, airline, cityName,
            cityMatched: !!city, requestedLang: lang, usedLang,
            matchedTextUrl: resolved.url, matchSource: resolved.source,
            firstNameIsAmbiguous: !isFirstNameUnique
          });
        }

        return {
          name, airline, quote,
          city: city ? city.name : null,
          cityLat: city ? city.lat : null,
          cityLon: city ? city.lon : null,
          photoUrl: img.url,
          airlineLogoUrl: logoUrl || null,
          uploadedAt: img.uploadedAt
        };
      })
    );
    alumni.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

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

    // ================= SEAT MAP =================
    // Known exact path, so this is fetched directly by URL — no listing needed.
    const seatmapData = (await fetchPublicJson(publicUrl(SEATMAP_KEY))) || {};
    const seatmap = SEAT_IDS.map((id) => ({
      id,
      image: seatmapData[id]?.image || null,
      caption: seatmapData[id]?.caption || '',
    }));

    // ================= RESPONSE =================
    if (!debug) {
      response.setHeader('Cache-Control', getSession(request) ? 'no-store' : 's-maxage=900, stale-while-revalidate=86400');
    }

    const payload = { alumni, nextCourseText, seatmap };
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
    return response.status(500).json({ error: err.message, alumni: [], nextCourseText: '', seatmap: [] });
  }
}

async function handleSaveSeat(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const budget = await checkWriteBudget();
  if (!budget.allowed) {
    return response.status(503).json({ error: 'Se ha alcanzado el límite de seguridad de operaciones de este mes. Vuelve a intentarlo el mes que viene, o contacta con el desarrollador.' });
  }

  const { seatId, caption, imageBase64, imageType } = request.body || {};
  if (!seatId || !SEAT_IDS.includes(seatId)) {
    return response.status(400).json({ error: 'Asiento no válido' });
  }

  try {
    const seatmapData = (await fetchPublicJson(publicUrl(SEATMAP_KEY))) || {};
    const existing = seatmapData[seatId] || {};

    let image = existing.image || null;
    if (imageBase64) {
      const ext = (imageType || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const buffer = Buffer.from(imageBase64, 'base64');
      const uploaded = await putObject(`seatmap-images/${seatId}-${Date.now()}.${ext}`, buffer, imageType || 'image/jpeg');
      image = uploaded.url;
    }

    seatmapData[seatId] = { image, caption: caption !== undefined ? caption : (existing.caption || '') };
    await putObject(SEATMAP_KEY, JSON.stringify(seatmapData), 'application/json');

    return response.status(200).json({ ok: true, seat: seatmapData[seatId] });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}

async function handleDeleteSeat(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const budget = await checkWriteBudget();
  if (!budget.allowed) {
    return response.status(503).json({ error: 'Se ha alcanzado el límite de seguridad de operaciones de este mes. Vuelve a intentarlo el mes que viene, o contacta con el desarrollador.' });
  }

  const { seatId } = request.body || {};
  if (!seatId || !SEAT_IDS.includes(seatId)) {
    return response.status(400).json({ error: 'Asiento no válido' });
  }

  try {
    const seatmapData = (await fetchPublicJson(publicUrl(SEATMAP_KEY))) || {};
    delete seatmapData[seatId];
    await putObject(SEATMAP_KEY, JSON.stringify(seatmapData), 'application/json');
    return response.status(200).json({ ok: true });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}

export default async function handler(request, response) {
  if (request.method === 'GET') return handleRead(request, response);
  if (request.method === 'POST') return handleSaveSeat(request, response);
  if (request.method === 'DELETE') return handleDeleteSeat(request, response);
  return response.status(405).json({ error: 'Método no permitido' });
}
