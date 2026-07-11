import { list } from '@vercel/blob';

// Matches image files: "Nombre, Aerolinea.jpg" (case-insensitive extension)
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const TEXT_RE = /\.txt$/i;

function baseName(pathname) {
  return pathname.split('/').pop();
}

export default async function handler(request, response) {
  try {
    const { blobs } = await list({ prefix: 'alumnoscontratados/' });

    const images = blobs.filter((b) => IMAGE_RE.test(b.pathname));
    const texts = blobs.filter((b) => TEXT_RE.test(b.pathname));

    // Index quote files by the student's first name (lowercased, trimmed)
    const textByName = {};
    for (const t of texts) {
      const key = baseName(t.pathname).replace(TEXT_RE, '').trim().toLowerCase();
      textByName[key] = t.url;
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
          try {
            const textRes = await fetch(textByName[key]);
            quote = (await textRes.text()).trim();
          } catch (_) {
            quote = '';
          }
        }
        if (!quote) {
          quote = airline
            ? `Antiguo alumno de Global Crew, ahora contratado en ${airline}.`
            : 'Antiguo alumno de Global Crew, ¡ya está volando!';
        }

        return {
          name,
          airline,
          quote,
          photoUrl: img.url,
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
