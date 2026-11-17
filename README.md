# Naucalpan Impulso — sitio público estático

Front estático de la plataforma Naucalpan Impulso (demo). Todo vive en esta carpeta: `index.html`, `script.js`, `styles.css`, `data/*.js` y `assets/`.

- `data/proyectos.js` y `data/municipios.js` son la exportación pública del API local: solo proyectos en estado `publicado` (30 tarjetas numeradas 1–30).
- Cada banner referencia su imagen por ruta en `assets/proyectos/<id>.<ext>` (`imagenFondo`) con velo uniforme `imagenTransparencia: 80` (el render lo acota a 70–95).
- Las cifras del demo conservan la marca de "de muestra".
- Publicación: GitHub Pages con la rama `main` en la raíz.

Para refrescar tras editar en el admin: exportar de nuevo los dos `data/*.js` desde el sitio local público, copiar las imágenes nuevas a `assets/proyectos/`, y luego commit + push.
