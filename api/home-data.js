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
const FAQ_KEY = 'faq/questions.json';
const TEAM_KEY = 'team/members.json';
const HERO_KEY = 'hero/content.json';
const THEME_KEY = 'site/theme.json';
const MAP_POINTS_KEY = 'map-points/points.json';

// Defaults match exactly what was already hardcoded on the site, so nothing
// changes visually until Kike actually edits something from the panel.
const DEFAULT_FAQ = [
  { id: 'f1', questionEs: '¿Qué os diferencia de otras escuelas TCP?', answerEs: 'Somos la primera escuela de España en incluir formación en Realidad Virtual para extinción de incendios y evacuación, además de las prácticas reales en un avión A300 de Iberia. Eso, junto al acompañamiento individual hasta que empiezas a volar, es lo que nos diferencia.', questionEn: 'What sets you apart from other Cabin Crew schools?', answerEn: 'We are the first school in Spain to include Virtual Reality training for fire fighting and evacuation, on top of real practicals on an Iberia A300 aircraft. That, together with one-on-one support until you start flying, is what sets us apart.' },
  { id: 'f2', questionEs: '¿Necesito saber inglés para apuntarme?', answerEs: 'No hace falta un nivel alto para empezar. Durante el curso trabajamos el inglés específico de la profesión (el que se usa a bordo), así que llegas preparado/a a las entrevistas aunque no partas de un nivel avanzado.', questionEn: 'Do I need to know English to sign up?', answerEn: "You don't need an advanced level to start. During the course we work on the specific English used on board, so you'll arrive prepared for interviews even without a high starting level." },
  { id: 'f3', questionEs: '¿Qué pasa si no supero el examen médico?', answerEs: 'Te orientamos antes de que lo hagas para que sepas qué esperar y minimices sorpresas. La mayoría de nuestros alumnos lo superan sin problema; si tienes dudas sobre tu caso concreto, coméntanoslo en la entrevista informativa y te asesoramos sin compromiso.', questionEn: "What happens if I don't pass the medical exam?", answerEn: "We guide you beforehand so you know what to expect and minimize surprises. Most of our students pass without any issues; if you have doubts about your particular case, mention it at the info interview and we'll advise you with no obligation." },
  { id: 'f4', questionEs: '¿Hay algún límite de edad?', answerEs: 'Para empezar el curso necesitas tener 18 años cumplidos. No hay una edad máxima: cada aerolínea tiene sus propios requisitos, y te ayudamos a identificar cuáles encajan mejor con tu perfil.', questionEn: 'Is there an age limit?', answerEn: "To start the course you need to be 18. There's no maximum age: each airline has its own requirements, and we help you identify which ones best fit your profile." },
  { id: 'f5', questionEs: '¿Puedo financiar el curso?', answerEs: 'Sí, ofrecemos financiación hasta en 12 meses. Lo hablamos contigo en la entrevista informativa para ajustarlo a tu situación.', questionEn: 'Can I finance the course?', answerEn: 'Yes, we offer financing over up to 12 months. We discuss it with you at the info interview to fit your situation.' },
  { id: 'f6', questionEs: '¿De verdad ayudáis a conseguir trabajo al terminar?', answerEs: 'Sí. Incluye preparación de entrevista individual e ilimitada con nuestro director, TCP en Iberia, además de asesoramiento laboral continuo hasta que empieces a volar y acceso a procesos de selección reales.', questionEn: 'Do you really help find a job afterwards?', answerEn: 'Yes. It includes one-on-one, unlimited interview preparation with our director, an Iberia Cabin Crew member, plus ongoing career guidance until you start flying and access to real selection processes.' },
  { id: 'f7', questionEs: '¿Cuál es la diferencia entre el TCP normal y el TCP Ejecutivo?', answerEs: 'Ambos incluyen la misma formación oficial AESA. El TCP Ejecutivo es un complemento para llevar tu formación de TCP a otro nivel: añade 4 asignaturas exclusivas en servicio VIP, protocolo y aviación privada, y te abre acceso a más oportunidades dentro del sector.', questionEn: "What's the difference between the regular Cabin Crew course and the Executive one?", answerEn: 'Both include the same official AESA training. Executive Cabin Crew is an add-on that takes your Cabin Crew training to the next level: it adds 4 exclusive subjects in VIP service, protocol and private aviation, opening up access to more opportunities within the industry.' },
];

const DEFAULT_TEAM = [
  { id: 't1', name: 'Kike', photo: 'images/crew-kike.jpg', roleEs: 'TCP en Iberia · Director de la escuela', roleEn: 'Iberia Cabin Crew · School Director', subjectEs: 'Preparación de entrevistas y orientación laboral', subjectEn: 'Interview preparation and career guidance', bioEs: 'TCP en Iberia. Como director de Global Crew, prepara a cada alumno de forma individual para sus entrevistas y le acompaña hasta verle volar.', bioEn: "Iberia Cabin Crew member. As Global Crew's director, he prepares every student individually for their interviews and supports them until they're flying." },
  { id: 't2', name: 'Nabila', photo: 'images/crew-nabila.jpg', roleEs: 'Enfermera · Instructora', roleEn: 'Nurse · Instructor', subjectEs: 'Medicina aeronáutica y primeros auxilios', subjectEn: 'Aviation medicine and first aid', bioEs: 'Enfermera en activo. Enseña a los alumnos a administrar oxígeno, hacer RCP y actuar ante cualquier emergencia médica a bordo.', bioEn: 'Active nurse. Teaches students to administer oxygen, perform CPR and respond to any medical emergency on board.' },
  { id: 't3', name: 'Manuel', photo: 'images/crew-manuel.jpg', roleEs: 'Piloto en Ryanair · Instructor', roleEn: 'Pilot at Ryanair · Instructor', subjectEs: 'Conocimientos generales de aviación', subjectEn: 'General aviation knowledge', bioEs: 'Piloto en activo. Acerca a los alumnos la realidad de la navegación aérea y el funcionamiento de una aeronave desde la cabina de mando.', bioEn: 'Active pilot. Brings students closer to the reality of air navigation and how an aircraft works, from the flight deck.' },
  { id: 't4', name: 'David', photo: 'images/crew-david.jpg', roleEs: 'TCP en Air Europa · Instructor', roleEn: 'Cabin Crew at Air Europa · Instructor', subjectEs: 'ONE (Operación Normal y de Emergencia) y Fuego', subjectEn: 'Normal & Emergency Operations and Fire', bioEs: 'Enseña a los alumnos a actuar ante cualquier situación en cabina, desde la operación normal hasta la extinción de un fuego real.', bioEn: 'Teaches students how to respond to any situation in the cabin, from normal operations to putting out a real fire.' },
  { id: 't5', name: 'Amparo', photo: 'images/crew-amparo.jpg', roleEs: 'TCP en Air Nostrum · Instructora', roleEn: 'Air Nostrum Cabin Crew · Instructor', subjectEs: 'Mercancías Peligrosas', subjectEn: 'Dangerous Goods', bioEs: 'TCP en activo en Air Nostrum. Enseña a identificar y gestionar mercancías peligrosas a bordo según la normativa AESA.', bioEn: 'Active Cabin Crew member at Air Nostrum. Teaches how to identify and handle dangerous goods on board under AESA regulations.' },
  { id: 't6', name: 'Alicia', photo: 'images/crew-alicia.jpg', roleEs: 'TCP en Air Nostrum · Instructora', roleEn: 'Cabin Crew at Air Nostrum · Instructor', subjectEs: 'CRM (Gestión de Recursos de la Tripulación)', subjectEn: 'CRM (Crew Resource Management)', bioEs: 'Enseña a coordinarse como equipo en cabina: comunicación, liderazgo y toma de decisiones conjunta ante cualquier situación.', bioEn: 'Teaches how to work as a crew in the cabin: communication, leadership and joint decision-making in any situation.' },
];

const DEFAULT_HERO = {
  beforeEs: 'Tu futuro, listo para', highlightEs: 'despegar', afterEs: '.',
  ledeEs: 'La aventura de tu vida puede empezar hoy. Viajar, descubrir nuevos países, conocer personas de todo el mundo y convertir la aviación en tu profesión. En Global Crew recibirás una formación oficial AESA con un enfoque claro: prepararte para conseguir tu primer trabajo como Tripulante de Cabina y ayudarte a dar el salto a una aerolínea.',
  beforeEn: 'Your future, ready to', highlightEn: 'take off', afterEn: '.',
  ledeEn: "The adventure of your life can start today. Travelling, discovering new countries, meeting people from all over the world, and turning aviation into your profession. At Global Crew you'll get official AESA training with a clear focus: preparing you to land your first job as Cabin Crew and helping you make the leap to an airline.",
};

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
      byFirstName[firstKey] = null;
    }
  }
  return { byFullName, byFirstName };
}

function resolveTextUrl(index, fullKey, firstKey, isFirstNameUnique) {
  if (index.byFullName[fullKey]) return { url: index.byFullName[fullKey], source: 'full_name' };
  if (isFirstNameUnique && index.byFirstName[firstKey]) return { url: index.byFirstName[firstKey], source: 'first_name_fallback' };
  return { url: null, source: null };
}

async function mostRecentText(blobs) {
  if (!blobs.length) return '';
  const sorted = [...blobs].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return fetchPublicText(sorted[0].url);
}

async function handleRead(request, response) {
  const debug = request.query && (request.query.debug === '1' || request.query.debug === 'true');
  const lang = request.query && request.query.lang === 'en' ? 'en' : 'es';

  try {
    const allBlobs = await listObjects('');
    const inFolder = (b, folder) => b.pathname.startsWith(folder);

    const alumniImages = allBlobs.filter((b) => inFolder(b, 'alumnoscontratados/') && IMAGE_RE.test(b.pathname));
    const alumniEsTexts = allBlobs.filter((b) => inFolder(b, 'alumnoscontratados/') && ES_TEXT_RE.test(b.pathname));
    const alumniEnTexts = allBlobs.filter((b) => inFolder(b, 'alumnoscontratados/') && EN_TEXT_RE.test(b.pathname));
    const logos = allBlobs.filter((b) => inFolder(b, 'logo/') && IMAGE_RE.test(b.pathname));
    const courseBlobs = allBlobs.filter((b) => inFolder(b, 'proximoscursos/'));

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

    const courseEsTexts = courseBlobs.filter((b) => ES_TEXT_RE.test(b.pathname));
    const courseEnTexts = courseBlobs.filter((b) => EN_TEXT_RE.test(b.pathname));
    let nextCourseText = '';
    if (lang === 'en' && courseEnTexts.length) {
      nextCourseText = await mostRecentText(courseEnTexts);
    }
    if (!nextCourseText) {
      nextCourseText = await mostRecentText(courseEsTexts.length ? courseEsTexts : courseBlobs);
    }

    // ================= SEAT MAP / FAQ / TEAM / HERO =================
    // All known exact paths, fetched directly by URL — no listing needed.
    // Fetched in parallel since they're independent of each other.
    const [seatmapDataRaw, faqRaw, teamRaw, heroRaw, themeRaw, mapPointsRaw] = await Promise.all([
      fetchPublicJson(publicUrl(SEATMAP_KEY)),
      fetchPublicJson(publicUrl(FAQ_KEY)),
      fetchPublicJson(publicUrl(TEAM_KEY)),
      fetchPublicJson(publicUrl(HERO_KEY)),
      fetchPublicJson(publicUrl(THEME_KEY)),
      fetchPublicJson(publicUrl(MAP_POINTS_KEY)),
    ]);
    const seatmapData = seatmapDataRaw || {};
    const seatmap = SEAT_IDS.map((id) => ({
      id, image: seatmapData[id]?.image || null, caption: seatmapData[id]?.caption || '',
    }));
    const faq = faqRaw || DEFAULT_FAQ;
    const team = teamRaw || DEFAULT_TEAM;
    const hero = heroRaw || DEFAULT_HERO;
    const theme = (themeRaw && themeRaw.theme) || 'none';
    const mapPoints = Array.isArray(mapPointsRaw) ? mapPointsRaw : [];

    // ================= RESPONSE =================
    if (!debug) {
      response.setHeader('Cache-Control', getSession(request) ? 'no-store' : 's-maxage=900, stale-while-revalidate=86400');
    }

    const payload = { alumni, nextCourseText, seatmap, faq, team, hero, theme, mapPoints };
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
    return response.status(500).json({ error: err.message, alumni: [], nextCourseText: '', seatmap: [], faq: DEFAULT_FAQ, team: DEFAULT_TEAM, hero: DEFAULT_HERO, theme: 'none', mapPoints: [] });
  }
}

async function handleSaveSeat(request, response) {
  const { seatId, caption, imageBase64, imageType } = request.body || {};
  if (!seatId || !SEAT_IDS.includes(seatId)) {
    return response.status(400).json({ error: 'Asiento no válido' });
  }

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
}

async function handleDeleteSeat(request, response) {
  const { seatId } = request.body || {};
  if (!seatId || !SEAT_IDS.includes(seatId)) {
    return response.status(400).json({ error: 'Asiento no válido' });
  }
  const seatmapData = (await fetchPublicJson(publicUrl(SEATMAP_KEY))) || {};
  delete seatmapData[seatId];
  await putObject(SEATMAP_KEY, JSON.stringify(seatmapData), 'application/json');
  return response.status(200).json({ ok: true });
}

async function handleSaveFaq(request, response) {
  const { items } = request.body || {};
  if (!Array.isArray(items) || !items.length) {
    return response.status(400).json({ error: 'Faltan las preguntas' });
  }
  for (const it of items) {
    if (!it.questionEs || !it.answerEs) {
      return response.status(400).json({ error: 'Cada pregunta necesita al menos el texto en español' });
    }
  }
  await putObject(FAQ_KEY, JSON.stringify(items), 'application/json');
  return response.status(200).json({ ok: true, faq: items });
}

async function handleSaveTeam(request, response) {
  const { items } = request.body || {};
  if (!Array.isArray(items) || !items.length) {
    return response.status(400).json({ error: 'Falta el equipo' });
  }

  const finalItems = [];
  for (const it of items) {
    if (!it.name) return response.status(400).json({ error: 'Falta el nombre de un profesor' });
    let photo = it.photo || null;
    if (it.photoBase64) {
      const ext = (it.photoType || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const buffer = Buffer.from(it.photoBase64, 'base64');
      const uploaded = await putObject(`team-photos/${it.id}-${Date.now()}.${ext}`, buffer, it.photoType || 'image/jpeg');
      photo = uploaded.url;
    }
    finalItems.push({
      id: it.id, name: it.name, photo,
      roleEs: it.roleEs || '', roleEn: it.roleEn || '',
      subjectEs: it.subjectEs || '', subjectEn: it.subjectEn || '',
      bioEs: it.bioEs || '', bioEn: it.bioEn || '',
    });
  }

  await putObject(TEAM_KEY, JSON.stringify(finalItems), 'application/json');
  return response.status(200).json({ ok: true, team: finalItems });
}

async function handleSaveHero(request, response) {
  const { beforeEs, highlightEs, afterEs, ledeEs, beforeEn, highlightEn, afterEn, ledeEn } = request.body || {};
  if (!ledeEs || !highlightEs) {
    return response.status(400).json({ error: 'Falta el texto principal en español' });
  }
  const hero = {
    beforeEs: beforeEs || '', highlightEs, afterEs: afterEs || '', ledeEs,
    beforeEn: beforeEn || '', highlightEn: highlightEn || '', afterEn: afterEn || '', ledeEn: ledeEn || '',
  };
  await putObject(HERO_KEY, JSON.stringify(hero), 'application/json');
  return response.status(200).json({ ok: true, hero });
}

const VALID_THEMES = ['none', 'christmas', 'halloween'];
async function handleSaveTheme(request, response) {
  const { theme } = request.body || {};
  if (!VALID_THEMES.includes(theme)) {
    return response.status(400).json({ error: 'Tema no válido' });
  }
  await putObject(THEME_KEY, JSON.stringify({ theme }), 'application/json');
  return response.status(200).json({ ok: true, theme });
}

async function handleSaveMapPoint(request, response) {
  const { city, label } = request.body || {};
  if (!city || !city.trim()) return response.status(400).json({ error: 'Falta la ciudad' });

  const matched = lookupCity(city.trim());
  if (!matched) {
    return response.status(400).json({ error: 'No reconocemos esa ciudad. Prueba a escribirla igual que aparece en el buscador de ciudades del formulario de alumnos.' });
  }

  const points = (await fetchPublicJson(publicUrl(MAP_POINTS_KEY))) || [];
  const point = {
    id: 'mp' + Date.now(),
    city: matched.name,
    label: (label || '').trim(),
    cityLat: matched.lat,
    cityLon: matched.lon,
  };
  points.push(point);
  await putObject(MAP_POINTS_KEY, JSON.stringify(points), 'application/json');
  return response.status(200).json({ ok: true, point, mapPoints: points });
}

async function handleDeleteMapPoint(request, response) {
  const { id } = request.body || {};
  if (!id) return response.status(400).json({ error: 'Falta el punto a borrar' });

  const points = (await fetchPublicJson(publicUrl(MAP_POINTS_KEY))) || [];
  const filtered = points.filter((p) => p.id !== id);
  await putObject(MAP_POINTS_KEY, JSON.stringify(filtered), 'application/json');
  return response.status(200).json({ ok: true, mapPoints: filtered });
}

async function handlePost(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const budget = await checkWriteBudget();
  if (!budget.allowed) {
    return response.status(503).json({ error: 'Se ha alcanzado el límite de seguridad de operaciones de este mes. Vuelve a intentarlo el mes que viene, o contacta con el desarrollador.' });
  }

  try {
    const type = (request.body || {}).type;
    if (type === 'faq') return await handleSaveFaq(request, response);
    if (type === 'team') return await handleSaveTeam(request, response);
    if (type === 'hero') return await handleSaveHero(request, response);
    if (type === 'theme') return await handleSaveTheme(request, response);
    if (type === 'mapPoint') return await handleSaveMapPoint(request, response);
    return await handleSaveSeat(request, response); // default: seat (no type sent, matches existing admin.html)
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}

async function handleDelete(request, response) {
  const session = requireAuth(request, response);
  if (!session) return;

  const budget = await checkWriteBudget();
  if (!budget.allowed) {
    return response.status(503).json({ error: 'Se ha alcanzado el límite de seguridad de operaciones de este mes. Vuelve a intentarlo el mes que viene, o contacta con el desarrollador.' });
  }

  try {
    const type = (request.body || {}).type;
    if (type === 'mapPoint') return await handleDeleteMapPoint(request, response);
    return await handleDeleteSeat(request, response); // default: seat (matches existing admin.html)
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}

export default async function handler(request, response) {
  if (request.method === 'GET') return handleRead(request, response);
  if (request.method === 'POST') return handlePost(request, response);
  if (request.method === 'DELETE') return handleDelete(request, response);
  return response.status(405).json({ error: 'Método no permitido' });
}
