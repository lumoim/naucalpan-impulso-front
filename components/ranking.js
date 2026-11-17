/* ============================================================================
   RANKING MUNICIPAL — Tablero de aprobación en vivo
   ----------------------------------------------------------------------------
   Construye la sección #ranking-municipal a partir de window.MUNICIPIOS y
   window.ALERTAS (ambas definidas en data/municipios.js):

   - Tarjetas por presidencia con anillo-gauge SVG: el círculo lleva la
     foto del alcalde (m.foto) y degrada al monograma si no carga.
   - Reorden estilo FLIP: las tarjetas se deslizan a su posición según su
     lugar en el ranking (la más aprobada queda hasta la izquierda).
   - Popover compartido de sentimiento en redes al poner el cursor encima
     (palabras en proporción al porcentaje; el dominante en grande).
   - Ticker de monitoreo con renglones de ALERTAS (bucle continuo en CSS).

   La vida simulada es PROPIA de este componente (media-reverting ±4 puntos,
   cada 6–8 s) y NO toca el contrato del Pulso (pulse.js).

   Script clásico: sin módulos, sin fetch, sin dependencias. El anillo SVG se
   construye por innerHTML SIN xmlns para que el verificador de dependencias
   externas de GUIA-CONSTRUCCION §7 siga limpio (el parser de HTML asigna el
   namespace solo).

   Publica una sola global: window.Ranking = { init }.
   ============================================================================ */
(function () {
  'use strict';

  var raiz = null;
  var pista = null;
  var ventana = null;
  var pop = null;
  var tarjetas = [];
  var temporizador = null;
  var ancho = 0;
  var alto = 330;

  var SEPARACION = 14;
  var RADIO = 36;
  var PERIMETRO = 2 * Math.PI * RADIO;
  var REDUCIDO = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* El #1 del ranking se dibuja un 30% mas grande (scale); la pista se
     recorre ese extra para que las demas tarjetas no queden tapadas. */
  var ESCALA_LIDER = 1.3;

  function crear(tag, clase, texto) {
    var el = document.createElement(tag);
    if (clase) el.className = clase;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  }

  function numero(n, dec) {
    return Number(n).toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function limite(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /* Anillo del gauge: pista gris + arco del acento del municipio.
     Sin xmlns: el parser de HTML lo asigna solo y el grep de §7 queda limpio. */
  function construirAnillo(medallon, m) {
    medallon.innerHTML = '<svg viewBox="0 0 84 84" aria-hidden="true">' +
      '<circle class="rk-pista-arco" cx="42" cy="42" r="36"></circle>' +
      '<circle class="rk-arco" cx="42" cy="42" r="36" style="stroke:' + m.acento + '"></circle>' +
      '</svg>';
    return medallon.querySelector('.rk-arco');
  }

  function construirTarjeta(m) {
    var nodo = crear('article', 'rk-card');
    nodo.tabIndex = 0;
    nodo.setAttribute('data-id', m.id);
    nodo.setAttribute('aria-label', m.municipio + ' — aprobación');
    var pos = crear('span', 'rk-pos', '—');
    var gauge = crear('div', 'rk-gauge');
    var arco = construirAnillo(gauge, m);
    /* La foto manda: si hay foto NO se dibuja el monograma (antes quedaba
       debajo y las letras se montaban sobre el rostro). El monograma solo
       aparece si no hay foto o si la imagen falla al cargar. */
    if (m.foto) {
      var foto = crear('img', 'rk-foto');
      var srcFoto = m.foto;
      try {
        var ov = (location.protocol === 'file:') ? localStorage.getItem('plataforma:foto:' + m.id) : null;
        if (ov) srcFoto = ov;
        else { var v = (location.protocol === 'file:') ? (localStorage.getItem('plataforma:version') || '0') : String(Date.now()); srcFoto = m.foto + (m.foto.indexOf('?') < 0 ? '?' : '&') + 'v=' + v; }
      } catch (e) {}
      foto.src = srcFoto;
      foto.alt = m.municipio;
      foto.setAttribute('loading', 'lazy');
      foto.onerror = function () {
        if (foto.parentNode) { foto.parentNode.removeChild(foto); }
        gauge.appendChild(crear('span', 'rk-iniciales', m.iniciales));
      };
      /* la foto va DETRAS del anillo: insertBefore la deja como primera capa (fondo) */
      gauge.insertBefore(foto, gauge.firstChild);
    } else {
      gauge.appendChild(crear('span', 'rk-iniciales', m.iniciales));
    }
    var tema = crear('span', 'rk-tema', m.tema);
    var nombre = crear('p', 'rk-nombre', m.municipio);
    var rol = crear('p', 'rk-rol', m.presidente);
    var dato = crear('div', 'rk-dato');
    var pct = crear('span', 'rk-pct');
    var b = crear('b', null, numero(m.aprobacion, 1));
    pct.appendChild(b);
    pct.appendChild(crear('small', null, '%'));
    var delta = crear('span', 'rk-delta', '—');
    dato.appendChild(pct);
    dato.appendChild(delta);
    nodo.appendChild(pos);
    nodo.appendChild(gauge);
    nodo.appendChild(tema);
    nodo.appendChild(nombre);
    nodo.appendChild(rol);
    nodo.appendChild(dato);
    return { datos: m, nodo: nodo, pos: pos, arco: arco, b: b, delta: delta, actual: m.aprobacion };
  }

  /* Ordena por aprobación descendente (empate: nombre asc), repinta número,
     delta contra la base y arco del gauge. */
  function repintar() {
    var orden = tarjetas.slice().sort(function (a, b) {
      return (b.actual - a.actual) || (a.datos.municipio < b.datos.municipio ? -1 : 1);
    });
    orden.forEach(function (t, i) {
      var x = i * (ancho + SEPARACION) + (i > 0 ? ancho * (ESCALA_LIDER - 1) : 0);
      t.nodo.style.transform = 'translateX(' + x + 'px) scale(' + (i === 0 ? ESCALA_LIDER : 1) + ')';
      /* Las demas tarjetas se centran verticalmente contra la del #1:
         su borde superior queda a la mitad de la altura extra del lider. */
      t.nodo.style.top = (i === 0 ? '0px' : Math.round(alto * (ESCALA_LIDER - 1) / 2) + 'px');
      t.nodo.classList.toggle('rk-lider', i === 0);
      t.pos.textContent = String(i + 1);
      t.b.textContent = numero(t.actual, 1);
      var dif = t.actual - t.datos.aprobacion;
      if (dif > 0.05) {
        t.delta.textContent = '▲ ' + numero(dif, 1);
        t.delta.className = 'rk-delta es-positivo';
      } else if (dif < -0.05) {
        t.delta.textContent = '▼ ' + numero(Math.abs(dif), 1);
        t.delta.className = 'rk-delta es-negativo';
      } else {
        t.delta.textContent = '—';
        t.delta.className = 'rk-delta';
      }
      t.arco.style.strokeDashoffset = (PERIMETRO * (1 - t.actual / 100)).toFixed(2);
    });
  }

  function medir() {
    if (!tarjetas.length) return;
    ancho = tarjetas[0].nodo.offsetWidth;
    pista.style.width = (tarjetas.length * (ancho + SEPARACION) - SEPARACION + ancho * (ESCALA_LIDER - 1)) + 'px';
    alto = tarjetas[0].nodo.offsetHeight || 330;
    pista.style.height = Math.ceil(alto * ESCALA_LIDER) + 'px';
    repintar();
  }

  /* Simulación propia: media-reverting hacia la base con ruido acotado,
     clamp base±4, redondeo a 0.1. Bases cercanas ⇒ el ranking se reordena
     en vivo; las posiciones nunca se disparan. */
  function tick() {
    if (document.hidden) {
      temporizador = window.setTimeout(tick, 8000);
      return;
    }
    tarjetas.forEach(function (t) {
      var base = t.datos.aprobacion;
      var delta = (base - t.actual) * 0.15 + (Math.random() - 0.5) * 2.4;
      t.actual = Math.round(limite(t.actual + delta, base - 4, base + 4) * 10) / 10;
    });
    repintar();
    temporizador = window.setTimeout(tick, 6000 + Math.random() * 2000);
  }

  /* Popover compartido (UNO solo, hermano de .rk-scroll, posicionado por JS
     respecto a la sección: así nunca lo recorta el contenedor con scroll). */
  function mostrarPop(t) {
    var m = t.datos;
    var s = m.sentimiento;
    pop.innerHTML = '';
    pop.appendChild(crear('p', 'rk-pop-titulo', 'Sentimiento en redes · ' + m.municipio));
    var maximo = Math.max(s.positivo, s.neutro, s.negativo);
    var filas = [
      { palabra: 'POSITIVO', valor: s.positivo, clase: 'es-positivo' },
      { palabra: 'NEUTRO', valor: s.neutro, clase: 'es-neutro' },
      { palabra: 'NEGATIVO', valor: s.negativo, clase: 'es-negativo' }
    ];
    filas.forEach(function (f) {
      var linea = crear('div', 'rk-pop-linea' + (f.valor === maximo ? ' rk-dominante' : ''));
      var palabra = crear('span', 'rk-pop-palabra ' + f.clase, f.palabra);
      palabra.style.fontSize = Math.round(13 + f.valor * 0.38) + 'px';
      linea.appendChild(palabra);
      linea.appendChild(crear('span', 'rk-pop-valor', f.valor + '%'));
      pop.appendChild(linea);
    });
    var temaP = crear('p', 'rk-pop-tema');
    temaP.appendChild(document.createTextNode('Tema del momento: '));
    temaP.appendChild(crear('strong', null, m.tema));
    temaP.appendChild(document.createTextNode(' · tendencia ' + m.tendencia + '.'));
    pop.appendChild(temaP);
    pop.appendChild(crear('p', 'rk-pop-nota', 'Cifras de muestra — la conexión oficial se activa con la aprobación de la colaboración.'));
    /* Posicionar en coordenadas LOCALES de la sección (evita el recorte). */
    var rectCard = t.nodo.getBoundingClientRect();
    var rectRaiz = raiz.getBoundingClientRect();
    pop.style.visibility = 'hidden';
    pop.classList.add('is-visible');
    var anchoPop = pop.offsetWidth;
    var centroLocal = (rectCard.left + rectCard.width / 2) - rectRaiz.left;
    var izquierda = limite(centroLocal - anchoPop / 2, 8, Math.max(8, rectRaiz.width - anchoPop - 8));
    pop.style.left = izquierda + 'px';
    pop.style.top = (rectCard.bottom - rectRaiz.top + 10) + 'px';
    pop.style.visibility = 'visible';
  }

  function ocultarPop() {
    if (pop) pop.classList.remove('is-visible');
  }

  /* Barra de monitoreo: dos grupos idénticos en la pista = bucle continuo
     desplazándose -50% (CSS keyframes). Se pausa al pasar el cursor. */
  function construirTicker(alertas) {
    var barra = crear('div', 'rk-ticker');
    barra.appendChild(crear('span', 'ticker-etiqueta', 'Monitoreo en vivo'));
    var ventanaT = crear('div', 'ticker-ventana');
    var pistaT = crear('div', 'ticker-pista');
    for (var g = 0; g < 2; g++) {
      var grupo = crear('div', 'ticker-grupo');
      alertas.forEach(function (a) {
        var item = crear('span', 'ticker-item es-' + a.tipo);
        item.appendChild(crear('strong', null, a.municipio + ':'));
        item.appendChild(document.createTextNode(' ' + a.texto));
        grupo.appendChild(item);
      });
      pistaT.appendChild(grupo);
    }
    ventanaT.appendChild(pistaT);
    barra.appendChild(ventanaT);
    barra.appendChild(crear('span', 'ticker-nota', 'menciones de muestra'));
    return barra;
  }

  /* --- Desplazamiento intuitivo de la pista (sin barra visible) ------------
     La pista es un carrusel mas ancho que la pantalla: se desliza con
     arrastre de mouse, con la rueda (vertical -> horizontal) y con teclado.
     La rueda solo se "roba" cuando la pista aun puede deslizarse; en los
     extremos se devuelve el scroll a la pagina, para no atrapar al lector. */
  var arrastre = null;

  function engancharArrastre(el) {
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;   /* el sistema ya lo maneja */
      arrastre = { x: e.clientX, base: el.scrollLeft, id: e.pointerId };
      el.classList.add('es-arrastrando');
    });
    el.addEventListener('pointermove', function (e) {
      if (!arrastre || arrastre.id !== e.pointerId) return;
      if (Math.abs(e.clientX - arrastre.x) > 3) { e.preventDefault(); }
      el.scrollLeft = arrastre.base - (e.clientX - arrastre.x);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (tipo) {
      el.addEventListener(tipo, function () {
        arrastre = null;
        el.classList.remove('es-arrastrando');
      });
    });
    el.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      var alInicio = el.scrollLeft <= 0 && e.deltaY < 0;
      var alFinal = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1 && e.deltaY > 0;
      if (alInicio || alFinal) return;      /* deja pasar el scroll de pagina */
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  function init() {
    raiz = document.getElementById('ranking-municipal');
    if (!raiz || !window.MUNICIPIOS || !window.MUNICIPIOS.length) return;

    var datos = window.MUNICIPIOS;
    var alertas = window.ALERTAS || [];

    var cabeza = crear('div', 'rk-cabeza');
    cabeza.appendChild(crear('h2', 'rk-titulo', 'Aprobación municipal en vivo'));
    cabeza.appendChild(crear('p', 'rk-sub', 'Ranking por presidencia del Estado de México. Coloca el cursor sobre una tarjeta para ver el sentimiento en redes.'));
    raiz.appendChild(cabeza);

    ventana = crear('div', 'rk-scroll');
    pista = crear('div', 'rk-pista');
    datos.forEach(function (m) {
      var t = construirTarjeta(m);
      tarjetas.push(t);
      pista.appendChild(t.nodo);
    });
    ventana.appendChild(pista);
    raiz.appendChild(ventana);

    pop = crear('div', 'rk-pop');
    pop.setAttribute('role', 'status');
    raiz.appendChild(pop);

    if (alertas.length) {
      raiz.appendChild(construirTicker(alertas));
    }

    tarjetas.forEach(function (t) {
      t.nodo.addEventListener('mouseenter', function () { mostrarPop(t); });
      t.nodo.addEventListener('mouseleave', ocultarPop);
      t.nodo.addEventListener('focusin', function () { mostrarPop(t); });
      t.nodo.addEventListener('focusout', function (e) {
        if (!t.nodo.contains(e.relatedTarget)) ocultarPop();
      });
    });
    ventana.addEventListener('scroll', ocultarPop);
    engancharArrastre(ventana);
    window.addEventListener('resize', function () {
      ocultarPop();
      medir();
    });

    medir();
    if (!REDUCIDO) {
      temporizador = window.setTimeout(tick, 6000 + Math.random() * 2000);
    }
  }

  window.Ranking = { init: init };
})();
