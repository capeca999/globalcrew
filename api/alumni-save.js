import { put, del } from '@vercel/blob';
import { requireAuth } from './_auth.js';

// Allow a slightly larger body since photos travel as base64.
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];

function buildIdentity(name, airline, city) {
  const parts = [name.trim(), airline.trim()];
  if (city && city.trim()) parts.push(city.trim());
  return parts.join(', ');
}

async function tryDelete(path) {
  try {
    await del(path);
  } catch {
    // Fine if it didn't exist (e.g. no English quote yet, or a different photo extension).
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Método no permitido' });
  }

  const session = requireAuth(request, response);
  if (!session) return; // requireAuth already sent the 401

  const {
    originalIdentity, // e.g. "Abril, Air Arabia, Dubai" — present only when editing an existing alumno
    name,
    airline,
    city,
    quoteEs,
    quoteEn,
    photoBase64, // optional when editing without changing the photo
    photoType,
  } = request.body || {};

  if (!name || !name.trim()) return response.status(400).json({ error: 'Falta el nombre' });
  if (!airline || !airline.trim()) return response.status(400).json({ error: 'Falta la aerolínea' });
  if (!quoteEs || !quoteEs.trim()) return response.status(400).json({ error: 'Falta la cita en español' });

  const identity = buildIdentity(name, airline, city);
  const isNew = !originalIdentity;
  const identityChanged = originalIdentity && originalIdentity !== identity;

  // A brand-new alumno, or one whose name/aerolínea/ciudad changed (which
  // changes the filename itself), always needs a fresh photo.
  if ((isNew || identityChanged) && !photoBase64) {
    return response.status(400).json({ error: 'Hace falta una foto' });
  }

  try {
    // If the identity changed, the old files are now orphaned under their old name — clean them up.
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
        access: 'private',
        contentType: photoType || 'image/jpeg',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    }

    await put(`alumnoscontratados/${identity}.txt`, quoteEs.trim(), {
      access: 'private',
      contentType: 'text/plain; charset=utf-8',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    if (quoteEn && quoteEn.trim()) {
      await put(`alumnoscontratados/${identity}.en.txt`, quoteEn.trim(), {
        access: 'private',
        contentType: 'text/plain; charset=utf-8',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    } else if (!isNew) {
      // The English quote was cleared on an existing alumno — remove any old
      // translation so it doesn't keep showing something stale.
      await tryDelete(`alumnoscontratados/${identity}.en.txt`);
    }

    return response.status(200).json({ ok: true, identity });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}
