// HARDENED-2026-11-11 — extraído del inline de index.html para permitir CSP script-src 'self'.
(function () {
  var d = document.getElementById('datos-info');
  if (d) d.textContent = 'Datos cargados: ' + (window.MUNICIPIOS ? MUNICIPIOS.length : 0) + ' municipios · ' + (window.PROYECTOS ? PROYECTOS.length : 0) + ' proyectos · ' + (window.ALERTAS ? ALERTAS.length : 0) + ' alertas' + (window.__DATOS_SOBREESCRITOS ? ' · versión guardada desde el admin' : '');
})();
