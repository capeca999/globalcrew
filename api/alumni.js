import CITIES from './_cities.js';
import { requireAuth, getSession } from './_auth.js';
import { fetchPublicText, listObjects, putObject, deleteObject } from './_blog-utils.js';

// One function handles all alumni-related operations, picked by HTTP method:
//   GET    /api/alumni?lang=es                -> list alumni (public)
//   GET    /api/alumni?resource=airlines       -> list airline logos (public)
//   POST   /api/alumni  (auth)                 -> create/update an alumno, or an airline logo (type:'airline')
//   DELETE /api/alumni  (auth)                 -> delete an alumno, or an airline logo (type:'airline')
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
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

function lookupCity(cityName) {
  if (!cityName) return null;
  const entry = CITIES[normalize(cityName)];
  if (!entry) return null;
  return { name: entry.display, lat: entry.lat, lon: entry.lon };
}

// Builds "full name" and "first name" lookup indexes, storing each text
// blob's public URL (so we can fetch its contents directly, no extra call).
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

async function handleList(request, response) {
  const debug = request.query && (request.query.debug === '1' || request.query.debug === 'true');
  const lang = request.query && request.query.lang === 'en' ? 'en' : 'es';

  try {
    // One listObjects() call for the whole bucket instead of two prefixed ones.
    const allBlobs = await listObjects('');
    const blobs = allBlobs.filter((b) => b.pathname.startsWith('alumnoscontratados/'));
    const logoBlobs = allBlobs.filter((b) => b.pathname.startsWith('logo/'));

    const images = blobs.filter((b) => IMAGE_RE.test(b.pathname));
    const esTexts = blobs.filter((b) => ES_TEXT_RE.test(b.pathname));
    const enTexts = blobs.filter((b) => EN_TEXT_RE.test(b.pathname));
    const logos = logoBlobs.filter((b) => IMAGE_RE.test(b.pathname));

    const esIndex = buildTextIndex(esTexts, ES_TEXT_RE);
    const enIndex = buildTextIndex(enTexts, EN_TEXT_RE);

    const logoByAirline = {};
    for (const l of logos) {
      const key = normalize(baseName(l.pathname).replace(IMAGE_RE, ''));
      logoByAirline[key] = l.url;
    }

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
          name, airline, quote, city: city ? city.name : null,
          cityLat: city ? city.lat : null, cityLon: city ? city.lon : null,
          photoUrl: img.url,
          airlineLogoUrl: logoUrl || null,
          uploadedAt: img.uploadedAt
        };
      })
    );

    alumni.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    if (!debug) {
      response.setHeader('Cache-Control', getSession(request) ? 'no-store' : 's-maxage=300, stale-while-revalidate=600');
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

async function handleListAirlines(request, response) {
  try {
    const blobs = await listObjects('logo/');
    const logos = blobs.filter((b) => IMAGE_RE.test(b.pathname));
    const airlines = logos
      .map((l) => ({ name: baseName(l.pathname).replace(IMAGE_RE, ''), logoUrl: l.url }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    response.setHeader('Cache-Control', getSession(request) ? 'no-store' : 's-maxage=300, stale-while-revalidate=600');
    return response.status(200).json({ airlines });
  } catch (err) {
    return response.status(500).json({ error: err.message, airlines: [] });
  }
}

function buildIdentity(name, airline, city) {
  const parts = [name.trim(), airline.trim()];
  if (city && city.trim()) parts.push(city.trim());
  return parts.join(', ');
}

async function handleSave(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const {
    originalIdentity, name, airline, city, quoteEs, quoteEn, photoBase64, photoType,
  } = request.body || {};

  if (!name || !name.trim()) return response.status(400).json({ error: 'Falta el nombre' });
  if (!airline || !airline.trim()) return response.status(400).json({ error: 'Falta la aerolínea' });
  if (!quoteEs || !quoteEs.trim()) return response.status(400).json({ error: 'Falta la cita en español' });

  const identity = buildIdentity(name, airline, city);
  const isNew = !originalIdentity;
  const identityChanged = originalIdentity && originalIdentity !== identity;

  if ((isNew || identityChanged) && !photoBase64) {
    return response.status(400).json({ error: 'Hace falta una foto' });
  }

  try {
    if (identityChanged) {
      await Promise.all([
        ...IMAGE_EXTS.map((ext) => deleteObject(`alumnoscontratados/${originalIdentity}.${ext}`)),
        deleteObject(`alumnoscontratados/${originalIdentity}.txt`),
        deleteObject(`alumnoscontratados/${originalIdentity}.en.txt`),
      ]);
    }

    if (photoBase64) {
      const ext = (photoType || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const buffer = Buffer.from(photoBase64, 'base64');
      await putObject(`alumnoscontratados/${identity}.${ext}`, buffer, photoType || 'image/jpeg');
    }

    await putObject(`alumnoscontratados/${identity}.txt`, quoteEs.trim(), 'text/plain; charset=utf-8');

    if (quoteEn && quoteEn.trim()) {
      await putObject(`alumnoscontratados/${identity}.en.txt`, quoteEn.trim(), 'text/plain; charset=utf-8');
    } else if (!isNew) {
      await deleteObject(`alumnoscontratados/${identity}.en.txt`);
    }

    return response.status(200).json({ ok: true, identity });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}

async function handleDelete(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const { identity } = request.body || {};
  if (!identity) return response.status(400).json({ error: 'Falta el alumno a borrar' });

  await Promise.all([
    ...IMAGE_EXTS.map((ext) => deleteObject(`alumnoscontratados/${identity}.${ext}`)),
    deleteObject(`alumnoscontratados/${identity}.txt`),
    deleteObject(`alumnoscontratados/${identity}.en.txt`),
  ]);

  return response.status(200).json({ ok: true });
}

async function handleSaveAirline(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const { airlineName, logoBase64, logoType, originalAirlineName } = request.body || {};
  if (!airlineName || !airlineName.trim()) return response.status(400).json({ error: 'Falta el nombre de la aerolínea' });
  if (!logoBase64 && !originalAirlineName) return response.status(400).json({ error: 'Hace falta el logo' });

  const name = airlineName.trim();

  try {
    if (originalAirlineName && originalAirlineName !== name) {
      await Promise.all(IMAGE_EXTS.map((ext) => deleteObject(`logo/${originalAirlineName}.${ext}`)));
    }

    if (logoBase64) {
      const ext = (logoType || 'image/png').split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      const buffer = Buffer.from(logoBase64, 'base64');
      await putObject(`logo/${name}.${ext}`, buffer, logoType || 'image/png');
    }

    return response.status(200).json({ ok: true, name });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}

async function handleDeleteAirline(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const { airlineName } = request.body || {};
  if (!airlineName) return response.status(400).json({ error: 'Falta la aerolínea a borrar' });

  await Promise.all(IMAGE_EXTS.map((ext) => deleteObject(`logo/${airlineName}.${ext}`)));
  return response.status(200).json({ ok: true });
}

export default async function handler(request, response) {
  if (request.method === 'GET') {
    if (request.query.resource === 'airlines') return handleListAirlines(request, response);
    return handleList(request, response);
  }
  if (request.method === 'POST') {
    if ((request.body || {}).type === 'airline') return handleSaveAirline(request, response);
    return handleSave(request, response);
  }
  if (request.method === 'DELETE') {
    if ((request.body || {}).type === 'airline') return handleDeleteAirline(request, response);
    return handleDelete(request, response);
  }
  return response.status(405).json({ error: 'Método no permitido' });
}
