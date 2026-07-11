# Global Crew Valencia — web + Blob dinámico

Esta carpeta es un proyecto de Vercel (no un simple HTML suelto): incluye tres
funciones de servidor (`/api/alumni`, `/api/proximo-curso` y `/api/blob-image`)
que leen directamente de tu Blob Store `globalcrew` para rellenar:

- El carrusel "Alumnos contratados" (fotos + citas).
- El texto "PRÓXIMO CURSO" de la barra superior.

Tus archivos están subidos como **privados**, así que todas las lecturas
(texto y fotos) pasan autenticadas por el servidor con tu
`BLOB_READ_WRITE_TOKEN` — no hace falta cambiar nada de cómo subes los
archivos ni marcarlos como públicos.

## 1. Desplegar

1. Sube esta carpeta a un repositorio de GitHub (o arrastra la carpeta en
   vercel.com → **Add New → Project → Deploy**).
2. En **Settings → Environment Variables**, confirma que existe
   `BLOB_READ_WRITE_TOKEN` (Vercel la crea sola al conectar el proyecto al
   Blob Store `globalcrew`, como en la pantalla "Connect a Project").
3. Deploy. Vercel detecta `/api/*.js` como funciones automáticamente; no
   hace falta configurar nada más.

## 2. Cómo añadir un alumno contratado

Sube a la carpeta `alumnoscontratados/` del Blob Store **dos archivos**:

- La foto: `Nombre, Aerolínea.jpg` (o .jpeg/.png/.webp) — ej. `Sara, Iberia.jpg`
- El texto: `Nombre.txt` (mismo nombre, sin la aerolínea) — ej. `Sara.txt`,
  con la cita que quieras que aparezca en su tarjeta, por ejemplo:

  ```
  Entré sin saber nada del sector y hoy vuelo con Iberia. Las prácticas
  reales en el A300 marcaron la diferencia.
  ```

En cuanto lo subas, aparecerá solo en la web (la caché dura 5 minutos, así
que puede tardar un poco en verse el cambio). Si subes una foto sin su
`.txt`, la tarjeta usará una frase genérica automáticamente.

**Importante:** el nombre del `.txt` debe coincidir con la parte del nombre
antes de la coma en el `.jpg` (no hace falta que coincidan mayúsculas).

## 3. Cómo cambiar el "Próximo curso"

Sube un `.txt` a la carpeta `proximoscursos/` del Blob Store con el texto
que quieras que aparezca en negrita en la barra superior, por ejemplo:

```
OCTUBRE 2026
```

Si subes varios archivos, se usa el más reciente. Borra o sustituye el
archivo cuando cambie la convocatoria.

## 4. Si algún día alojas esto fuera de Vercel (WordPress, hosting normal...)

Las funciones `/api/*` no existirán ahí, así que el carrusel y la fecha
usarán automáticamente el contenido de ejemplo que ya está escrito dentro
del HTML (no se rompe nada, simplemente deja de actualizarse solo).
