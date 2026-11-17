/* data-override.js - override local del admin, SOLO en file://.
   En http:// (Docker) no hace nada: los datos vienen de la API vía /data/*.js.
   Carga DESPUÉS de data/municipios.js y ANTES de script.js. */
(function () {
  'use strict';
  if (location.protocol !== 'file:') return;
  function aplicar(clave) {
    try {
      var t = localStorage.getItem(clave);
      if (t) { new Function(t)(); return true; }
    } catch (e) { /* si falla, se quedan los datos de archivo */ }
    return false;
  }
  var a = aplicar('plataforma:municipios.js');
  var b = aplicar('plataforma:proyectos.js');
  if (a || b) window.__DATOS_SOBREESCRITOS = true;
  try {
    window.__VERSION_VISTA = localStorage.getItem('plataforma:version') || '0';
    setInterval(function () {
      try {
        var nv = localStorage.getItem('plataforma:version') || '0';
        if (nv !== window.__VERSION_VISTA) { window.__VERSION_VISTA = nv; location.reload(); }
      } catch (e) {}
    }, 1000);
  } catch (e) {}
})();
