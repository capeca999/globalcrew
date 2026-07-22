import { list, get, put, del } from '@vercel/blob';
import CITIES from './_cities.js';
import { requireAuth } from './_auth.js';

// One function handles all alumni-related operations, picked by HTTP
// method, so this only counts as a single Serverless Function:
//   GET    /api/alumni?lang=es   -> list alumni (public, unchanged)
//   POST   /api/alumni  (auth)   -> create/update an alumno (was alumni-save.js)
//   DELETE /api/alumni  (auth)   -> delete an alumno         (was alumni-delete.js)
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

// Matches image files: "Nombre, Aerolinea, Ciudad.jpg" (case-insensitive extension)
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
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

async function handleListAirlines(request, response) {
  try {
    const { blobs } = await list({ prefix: 'logo/' });
    const logos = blobs.filter((b) => IMAGE_RE.test(b.pathname));
    const airlines = logos
      .map((l) => ({
        name: baseName(l.pathname).replace(IMAGE_RE, ''),
        logoUrl: proxiedImageUrl(request, l.pathname),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return response.status(200).json({ airlines });
  } catch (err) {
    return response.status(500).json({ error: err.message, airlines: [] });
  }
}

async function handleList(request, response) {
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

    const esIndex = buildTextIndex(esTexts, ES_TEXT_RE);
    const enIndex = buildTextIndex(enTexts, EN_TEXT_RE);

    const logoByAirline = {};
    for (const l of logos) {
      const key = normalize(baseName(l.pathname).replace(IMAGE_RE, ''));
      logoByAirline[key] = l.pathname;
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
          name, airline, quote, city: city ? city.name : null,
          cityLat: city ? city.lat : null, cityLon: city ? city.lon : null,
          photoUrl: proxiedImageUrl(request, img.pathname),
          airlineLogoUrl: logoPath ? proxiedImageUrl(request, logoPath) : null,
          uploadedAt: img.uploadedAt
        };
      })
    );

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

function buildIdentity(name, airline, city) {
  const parts = [name.trim(), airline.trim()];
  if (city && city.trim()) parts.push(city.trim());
  return parts.join(', ');
}

async function tryDelete(path) {
  try {
    await del(path);
  } catch {
    // Fine if it didn't exist.
  }
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
        ...IMAGE_EXTS.map((ext) => tryDelete(`alumnoscontratados/${originalIdentity}.${ext}`)),
        tryDelete(`alumnoscontratados/${originalIdentity}.txt`),
        tryDelete(`alumnoscontratados/${originalIdentity}.en.txt`),
      ]);
    }

    if (photoBase64) {
      const ext = (photoType || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const buffer = Buffer.from(photoBase64, 'base64');
      await put(`alumnoscontratados/${identity}.${ext}`, buffer, {
        access: 'private', contentType: photoType || 'image/jpeg', addRandomSuffix: false, allowOverwrite: true,
      });
    }

    await put(`alumnoscontratados/${identity}.txt`, quoteEs.trim(), {
      access: 'private', contentType: 'text/plain; charset=utf-8', addRandomSuffix: false, allowOverwrite: true,
    });

    if (quoteEn && quoteEn.trim()) {
      await put(`alumnoscontratados/${identity}.en.txt`, quoteEn.trim(), {
        access: 'private', contentType: 'text/plain; charset=utf-8', addRandomSuffix: false, allowOverwrite: true,
      });
    } else if (!isNew) {
      await tryDelete(`alumnoscontratados/${identity}.en.txt`);
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
    ...IMAGE_EXTS.map((ext) => tryDelete(`alumnoscontratados/${identity}.${ext}`)),
    tryDelete(`alumnoscontratados/${identity}.txt`),
    tryDelete(`alumnoscontratados/${identity}.en.txt`),
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
    // Renaming an airline: clean up the old logo file(s) first.
    if (originalAirlineName && originalAirlineName !== name) {
      await Promise.all(IMAGE_EXTS.map((ext) => tryDelete(`logo/${originalAirlineName}.${ext}`)));
    }

    if (logoBase64) {
      const ext = (logoType || 'image/png').split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      const buffer = Buffer.from(logoBase64, 'base64');
      await put(`logo/${name}.${ext}`, buffer, {
        access: 'private', contentType: logoType || 'image/png', addRandomSuffix: false, allowOverwrite: true,
      });
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

  await Promise.all(IMAGE_EXTS.map((ext) => tryDelete(`logo/${airlineName}.${ext}`)));
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
