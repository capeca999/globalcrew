# Global Crew Valencia — web + Blob dinámico

Esta carpeta es un proyecto de Vercel (no un simple HTML suelto): incluye tres
funciones de servidor (`/api/alumni`, `/api/proximo-curso` y `/api/blob-image`)
que leen directamente de tu Blob Store `globalcrew` para rellenar:

- El carrusel "Alumnos contratados" (fotos + citas).
- El texto "PRÓXIMO CURSO" de la barra superior.

Tu store es de tipo **privado con autenticación OIDC** (por eso tu proyecto
tiene las variables `BLOB_STORE_ID` y `BLOB_WEBHOOK_PUBLIC_KEY`, en vez de un
`BLOB_READ_WRITE_TOKEN`). Los blobs privados de Vercel **no se pueden leer con
un `fetch()` normal a su URL, bajo ningún concepto** — hay que usar el método
`get()` del SDK, que es justo lo que hacen estas funciones. No hace falta que
cambies nada de cómo subes los archivos.

## 0. Multi-idioma (ES / EN)

La web tiene un botón **ES/EN** en el menú (y en el menú móvil) que
traduce todo el texto fijo de la página al instante, sin recargar. La
elección del usuario se recuerda (localStorage), así que si vuelve a
entrar ve el idioma que eligió la última vez.

- Todo el texto "fijo" (titulares, botones, FAQ, formulario, footer...) ya
  está traducido y no necesita que hagas nada.
- El contenido que viene del Blob (citas de alumnos y testimonios) se
  queda en español salvo que subas también una versión `.en.txt` — mira
  las secciones 2 y 3 más abajo.
- Si quieres tocar alguna traducción, están todas juntas en `index.html`,
  buscando `const I18N = {`.

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

- La foto: **`Nombre, Aerolínea, Ciudad.jpg`** (o .jpeg/.png/.webp) — ej.
  `Sara, Iberia, Madrid.jpg`. La ciudad es la base/hub de esa aerolínea —
  es la que decide dónde sale el punto en el mapa mundial, así que
  procura poner una ciudad real y no un apodo raro.
- El texto: **el mismo nombre exacto que la foto, con `.txt`** — ej.
  `Sara, Iberia, Madrid.txt`, con la cita que quieras que aparezca en su
  tarjeta:

  ```
  Entré sin saber nada del sector y hoy vuelo con Iberia. Las prácticas
  reales en el A300 marcaron la diferencia.
  ```

En cuanto lo subas, aparecerá solo en la web (la caché dura 5 minutos, así
que puede tardar un poco en verse el cambio). Si subes una foto sin su
`.txt`, la tarjeta usará una frase genérica automáticamente.

**¿Y si no pongo la ciudad?** No pasa nada, `Nombre, Aerolínea.jpg` (sin
ciudad) sigue funcionando igual para la tarjeta y el carrusel — lo único
que no tendrá es punto en el mapa mundial, porque no sabemos dónde
ponerlo.

**¿Qué ciudades reconoce?** Hay una lista de casi 200 ciudades del mundo
ya integrada (todas las capitales y ciudades importantes de Europa,
Oriente Medio, América, Asia y Oceanía). Si escribes una ciudad que no
está en la lista, simplemente no le pone punto en el mapa (pero la
tarjeta y el carrusel funcionan igual). Si te pasa, dímelo y añado esa
ciudad en un momento — no hace falta que sea algo que gestiones tú.

**¿Por qué el texto lleva también la aerolínea y la ciudad?** Para que
dos alumnos con el mismo nombre (dos "Abril", por ejemplo) nunca se
mezclen: como cada uno vuela con una aerolínea distinta, `Abril, Air
Arabia, Sharjah.txt` y `Abril, Vueling, Barcelona.txt` son dos archivos
totalmente distintos, sin ninguna ambigüedad. Solo tienes que copiar el
nombre de la foto tal cual y cambiar `.jpg` por `.txt` — no hace falta
pensar en números ni sufijos.

(Si ya tenías `.txt` solo con el nombre, tipo `Abril.txt`, o fotos con
solo `Nombre, Aerolínea.jpg` sin ciudad, siguen funcionando igual que
antes.)

**¿Y en inglés?** La web tiene un botón ES/EN. Si quieres que la cita de
un alumno también se vea en inglés al cambiar de idioma, sube **otro**
`.txt` con el mismo nombre pero terminado en `.en.txt` — ej.
`Sara, Iberia, Madrid.en.txt`, con la cita traducida dentro. Si no lo
subes, en inglés se sigue mostrando la cita en español (mejor eso que
nada) hasta que añadas la versión en inglés.

## 3. Cómo añadir un testimonio

Sube un `.txt` a la carpeta `testimonios/` del Blob Store. El nombre del
archivo es el nombre de la persona (con espacio si quieres que se vea con
espacio, ej. `Paco Pinazo.txt`), y el contenido del archivo es la cita que
quieres que aparezca. Aparece automáticamente en el carrusel de
testimonios (la "pantalla de avión"), ordenado del más reciente al más
antiguo — nada que tocar en el código.

Si subes el nombre sin espacio (`PacoPinazo.txt`), el sistema intenta
separarlo solo por las mayúsculas ("Paco Pinazo"), pero para evitar
sorpresas es mejor poner el espacio tú mismo directamente en el nombre del
archivo.

**¿Y en inglés?** Igual que con los alumnos: sube `Paco Pinazo.en.txt`
con la traducción, y aparecerá automáticamente cuando alguien vea la web
en inglés. Si no la subes, se queda en español también en la versión
inglesa de la web.

## 4. Cómo cambiar el "Próximo curso"

Sube un `.txt` a la carpeta `proximoscursos/` del Blob Store con el texto
que quieras que aparezca en negrita en la barra superior, por ejemplo:

```
OCTUBRE 2026
```

Si subes varios archivos, se usa el más reciente. Borra o sustituye el
archivo cuando cambie la convocatoria.

**¿Y en inglés?** Igual que con los alumnos y los testimonios: sube otro
archivo con el mismo contenido pero terminado en `.en.txt` — ej.
`octubre.en.txt` con dentro `OCTOBER 2026`. Si no lo subes, en la versión
inglesa de la web se sigue mostrando el texto en español hasta que lo
añadas.

## 5. Si algún día alojas esto fuera de Vercel (WordPress, hosting normal...)

Las funciones `/api/*` no existirán ahí, así que el carrusel y la fecha
usarán automáticamente el contenido de ejemplo que ya está escrito dentro
del HTML (no se rompe nada, simplemente deja de actualizarse solo).
