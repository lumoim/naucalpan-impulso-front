/* ============================================================
   TechCharts — Motor de gráficas en canvas, 100% vanilla.
   Sin dependencias, sin CDN, funciona en file://.
   API pública (window.TechCharts):
     TechCharts.line(canvas, {series, yUnidad, mostrarPuntos}) → {update, destroy}
     TechCharts.bars(canvas, {barras, max})                    → {update, destroy}
     TechCharts.donut(canvas, {segmentos, centro})             → {update, destroy}
     TechCharts.countUp(el, valor, {duracion, decimales, prefijo, sufijo})
   Decisiones:
     · devicePixelRatio en cada dibujo → nítido en retina.
     · Redibujo en resize (ResizeObserver con respaldo en window).
     · Leyenda DOM clicable (toggle de series / resaltar segmento).
     · Tooltip DOM: valor grande + etiqueta X.
     · Animaciones: easeOutExpo (línea ~1.2 s) y easeOutCubic
       (barras, dona y count-up). Se respetan prefers-reduced-motion.
   ============================================================ */
(function () {
  'use strict';

  var REDUCED = typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- utilidades internas ---------- */

  // Interpoladores de easing (sin GSAP: ~20 líneas hacen el trabajo)
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  // rAF genérico: corre cb(p) de 0→1 en `ms` milisegundos con easing
  function animar(ms, easing, cb, alTerminar) {
    if (REDUCED) { cb(1); if (alTerminar) alTerminar(); return; }
    var inicio = performance.now();
    function paso(hora) {
      var t = Math.min(1, (hora - inicio) / ms);
      cb(easing(t));
      if (t < 1) requestAnimationFrame(paso);
      else if (alTerminar) alTerminar();
    }
    requestAnimationFrame(paso);
  }

  // Prepara el canvas para retina y devuelve el contexto escalado + tamaño CSS
  function preparar(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var ancho = canvas.clientWidth || canvas.parentNode.clientWidth || 320;
    var alto = canvas.clientHeight || canvas.parentNode.clientHeight || 220;
    canvas.width = Math.round(ancho * dpr);
    canvas.height = Math.round(alto * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, ancho: ancho, alto: alto };
  }

  // Colores del sistema (espejo del :root de styles.css, en tonos vino)
  var TOKENS = {
    texto: '#F2EFE6', medio: '#C9BFC1', bajo: '#988B8E',
    borde: '#2E2027', panel: '#241A1F', fondo: '#130D10'
  };

  // Tipografía de datos (grotesk del sistema, sin webfonts)
  var FUENTE = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  function texto(ctx, size, color, peso) {
    ctx.font = (peso || '400') + ' ' + size + 'px ' + FUENTE;
    ctx.fillStyle = color;
  }

  // Crea el tooltip DOM (un div por gráfica) dentro del contenedor del canvas
  function crearTooltip(canvas) {
    var host = canvas.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.style.cssText = 'position:absolute;pointer-events:none;opacity:0;' +
      'transform:translate(-50%,-112%);transition:opacity .15s ease;' +
      'background:rgba(36,26,31,.96);border:1px solid #3E2A32;border-radius:8px;' +
      'padding:8px 12px;text-align:center;white-space:nowrap;z-index:5;';
    host.appendChild(tip);
    return tip;
  }

  function mostrarTip(tip, x, y, html) {
    tip.innerHTML = html;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.style.opacity = '1';
  }
  function ocultarTip(tip) { tip.style.opacity = '0'; }

  // Registra redibujado en resize; devuelve función de limpieza
  function alRedimensionar(canvas, redibujar) {
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () { redibujar(); });
      ro.observe(canvas.parentNode);
      return function () { ro.disconnect(); };
    }
    window.addEventListener('resize', redibujar);
    return function () { window.removeEventListener('resize', redibujar); };
  }

  // Formatea un número con decimales fijos y separador de miles es-MX
  function fmt(v, dec) {
    return v.toLocaleString('es-MX', {
      minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0
    });
  }

  /* ============================================================
     LINE — gráfica de línea(s) animada con tooltip y leyenda
     ============================================================ */
  function line(canvas, opc) {
    var serieActiva = {}; // id → bool (series visibles, para la leyenda)
    var series = opc.series || [];
    var yUnidad = opc.yUnidad || '';
    var puntos = opc.mostrarPuntos !== false;
    var leyendaItems = [];
    var tip = crearTooltip(canvas);
    var hover = null; // {serie, i}
    var limpiarResize = null;
    var destruido = false;

    series.forEach(function (s, i) { serieActiva[i] = true; });

    function xs() { return (series[0] && series[0].data || []).map(function (d) { return d.x; }); }

    function escala(p) {
      var ancho = p.ancho, alto = p.alto;
      var izq = 46, der = 14, arriba = 18, abajo = 30; // márgenes del área de trazado
      var todas = [];
      series.forEach(function (s) {
        s.data.forEach(function (d) { todas.push(d.y); });
      });
      var minY = Math.min.apply(null, todas), maxY = Math.max.apply(null, todas);
      if (minY === maxY) { minY -= 1; maxY += 1; }
      var margen = (maxY - minY) * 0.12;
      minY = Math.max(0, minY - margen); maxY = maxY + margen;
      return {
        x: function (i, n) { return izq + (ancho - izq - der) * (n <= 1 ? .5 : i / (n - 1)); },
        y: function (v) { return arriba + (alto - arriba - abajo) * (1 - (v - minY) / (maxY - minY)); },
        izq: izq, arriba: arriba, abajo: abajo,
        alto: alto, ancho: ancho, minY: minY, maxY: maxY
      };
    }

    function dibujar(progreso) {
      if (destruido) return;
      var p = preparar(canvas);
      var ctx = p.ctx, e = escala(p);
      var etiquetas = xs();
      var n = etiquetas.length;

      // Cuadrícula sutil + etiquetas Y
      var pasos = 4;
      ctx.strokeStyle = 'rgba(46,32,39,.9)';
      ctx.lineWidth = 1;
      for (var g = 0; g <= pasos; g++) {
        var vy = minYreal(e, g / pasos);
        var py = e.y(vy);
        ctx.beginPath(); ctx.moveTo(e.izq, py); ctx.lineTo(p.ancho - 14, py); ctx.stroke();
        texto(ctx, 11, TOKENS.bajo);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(fmt(vy, vy % 1 ? 1 : 0) + yUnidad, e.izq - 8, py);
      }
      function minYreal(e, fr) { return e.minY + (e.maxY - e.minY) * fr; }

      // Etiquetas X (hasta ~8 para no amontonar)
      var salto = Math.max(1, Math.ceil(n / 8));
      texto(ctx, 11, TOKENS.bajo);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      etiquetas.forEach(function (et, i) {
        if (i % salto && i !== n - 1) return;
        ctx.fillText(et, e.x(i, n), p.alto - e.abajo + 8);
      });

      // Recorte horizontal = efecto de "dibujarse" de izquierda a derecha
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, e.izq + (p.ancho - e.izq - 14) * progreso, p.alto);
      ctx.clip();

      series.forEach(function (s, si) {
        if (!serieActiva[si]) return;
        var datos = s.data;
        // Relleno degradado sutil bajo la primera serie visible
        if (si === 0) {
          var grad = ctx.createLinearGradient(0, e.arriba, 0, p.alto - e.abajo);
          grad.addColorStop(0, s.color + '33');
          grad.addColorStop(1, s.color + '00');
          ctx.beginPath();
          datos.forEach(function (d, i) {
            var px = e.x(i, n), py = e.y(d.y);
            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          });
          ctx.lineTo(e.x(n - 1, n), p.alto - e.abajo);
          ctx.lineTo(e.x(0, n), p.alto - e.abajo);
          ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
        }
        // Trazo principal
        ctx.beginPath();
        datos.forEach(function (d, i) {
          var px = e.x(i, n), py = e.y(d.y);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.strokeStyle = s.color; ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.stroke();
        // Puntos
        if (puntos) {
          datos.forEach(function (d, i) {
            var px = e.x(i, n), py = e.y(d.y);
            ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = s.color; ctx.fill();
            ctx.strokeStyle = TOKENS.fondo; ctx.lineWidth = 2; ctx.stroke();
          });
        }
      });
      ctx.restore();

      // Punto destacado bajo el cursor
      if (hover && serieActiva[hover.serie]) {
        var d = series[hover.serie].data[hover.i];
        var hx = e.x(hover.i, n), hy = e.y(d.y);
        ctx.beginPath(); ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = series[hover.serie].color + '33'; ctx.fill();
        ctx.beginPath(); ctx.arc(hx, hy, 3.6, 0, Math.PI * 2);
        ctx.fillStyle = series[hover.serie].color; ctx.fill();
      }
    }

    // Leyenda DOM clicable: alterna series
    function crearLeyenda() {
      var host = canvas.parentNode;
      var ley = document.createElement('div');
      ley.className = 'leyenda';
      ley.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:10px;';
      series.forEach(function (s, i) {
        var it = document.createElement('button');
        it.type = 'button';
        it.className = 'leyenda-item' + (serieActiva[i] ? '' : ' is-inactiva');
        it.innerHTML = '<span class="leyenda-color" style="background:' + s.color + '"></span>' + s.name;
        it.addEventListener('click', function () {
          serieActiva[i] = !serieActiva[i];
          it.classList.toggle('is-inactiva', !serieActiva[i]);
          dibujar(1);
        });
        ley.appendChild(it);
        leyendaItems.push(it);
      });
      host.appendChild(ley);
    }

    // Hover: buscar el punto visible más cercano al cursor
    canvas.addEventListener('mousemove', function (ev) {
      var r = canvas.getBoundingClientRect();
      var mx = ev.clientX - r.left, my = ev.clientY - r.top;
      var n = xs().length, mejor = null;
      series.forEach(function (s, si) {
        if (!serieActiva[si]) return;
        s.data.forEach(function (d, i) {
          var e = escala({ ancho: r.width, alto: r.height });
          var dx = e.x(i, n) - mx, dy = e.y(d.y) - my;
          var dist = dx * dx + dy * dy;
          if (!mejor || dist < mejor.dist) mejor = { serie: si, i: i, dist: dist, d: d };
        });
      });
      if (mejor && mejor.dist < 38 * 38) {
        hover = { serie: mejor.serie, i: mejor.i };
        var e2 = escala({ ancho: r.width, alto: r.height });
        mostrarTip(tip, e2.x(mejor.i, n), e2.y(mejor.d.y),
          '<div style="font:600 17px ' + FUENTE + ';color:' + TOKENS.texto + '">' +
          fmt(mejor.d.y, mejor.d.y % 1 ? 1 : 0) + yUnidad + '</div>' +
          '<div style="font:400 11px ' + FUENTE + ';color:' + TOKENS.medio + '">' +
          series[mejor.serie].name + ' · ' + mejor.d.x + '</div>');
        dibujar(1);
      } else if (hover) {
        hover = null; ocultarTip(tip); dibujar(1);
      }
    });
    canvas.addEventListener('mouseleave', function () {
      if (hover) { hover = null; ocultarTip(tip); dibujar(1); }
    });

    crearLeyenda();
    limpiarResize = alRedimensionar(canvas, function () { dibujar(1); });
    animar(1200, easeOutExpo, dibujar); // entrada ~1.2 s

    return {
      update: function (nuevaSerie) {
        series = nuevaSerie;
        serieActiva = {}; series.forEach(function (s, i) { serieActiva[i] = true; });
        leyendaItems.forEach(function (it, i) {
          it.classList.toggle('is-inactiva', false);
          if (series[i]) it.querySelector('.leyenda-color').style.background = series[i].color;
        });
        dibujar(1);
      },
      destroy: function () {
        destruido = true;
        if (limpiarResize) limpiarResize();
        tip.remove();
        var ley = canvas.parentNode.querySelector('.leyenda');
        if (ley) ley.remove();
      }
    };
  }

  /* ============================================================
     BARS — barras horizontales animadas con tooltip
     ============================================================ */
  function bars(canvas, opc) {
    var barras = opc.barras || [];
    var tip = crearTooltip(canvas);
    var limpiarResize = null;
    var destruido = false;

    function maximo() {
      return opc.max || Math.max.apply(null, barras.map(function (b) { return b.valor; })) * 1.15;
    }

    function dibujar(p) {
      if (destruido) return;
      var t = preparar(canvas);
      var ctx = t.ctx;
      var altoFila = t.alto / barras.length;
      var izq = Math.max(70, t.ancho * 0.24); // zona de etiquetas
      var max = maximo();

      barras.forEach(function (b, i) {
        var y = altoFila * i + altoFila * 0.18;
        var h = altoFila * 0.64;
        var w = (t.ancho - izq - 12) * (b.valor / max) * p;
        // etiqueta a la izquierda
        texto(ctx, 12, TOKENS.medio);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(b.etiqueta, izq - 10, y + h / 2);
        // pista
        ctx.fillStyle = 'rgba(36,26,31,.85)';
        redondear(ctx, izq, y, t.ancho - izq - 12, h, 6); ctx.fill();
        // valor al final de la barra
        if (p > .95) {
          texto(ctx, 12, TOKENS.texto, '600');
          ctx.textAlign = 'left';
          ctx.fillText(fmt(b.valor, b.valor % 1 ? 1 : 0), izq + w + 8, y + h / 2);
        }
        // barra
        if (w > 0) {
          var grad = ctx.createLinearGradient(izq, 0, izq + w, 0);
          grad.addColorStop(0, b.color + 'CC');
          grad.addColorStop(1, b.color);
          ctx.fillStyle = grad;
          redondear(ctx, izq, y, w, h, 6); ctx.fill();
        }
      });
    }

    // rectángulo con esquinas redondeadas
    function redondear(ctx, x, y, w, h, r) {
      r = Math.min(r, h / 2, w / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    canvas.addEventListener('mousemove', function (ev) {
      var r = canvas.getBoundingClientRect();
      var mx = ev.clientX - r.left, my = ev.clientY - r.top;
      var fila = Math.floor(my / (r.height / barras.length));
      if (fila >= 0 && fila < barras.length && mx > r.width * 0.24 - 20) {
        var b = barras[fila];
        mostrarTip(tip, mx, my,
          '<div style="font:600 17px ' + FUENTE + ';color:' + TOKENS.texto + '">' +
          fmt(b.valor, b.valor % 1 ? 1 : 0) + '</div>' +
          '<div style="font:400 11px ' + FUENTE + ';color:' + TOKENS.medio + '">' + b.etiqueta + '</div>');
      } else ocultarTip(tip);
    });
    canvas.addEventListener('mouseleave', function () { ocultarTip(tip); });

    limpiarResize = alRedimensionar(canvas, function () { dibujar(1); });
    animar(900, easeOutCubic, dibujar);

    return {
      update: function (n) { barras = n; dibujar(1); },
      destroy: function () {
        destruido = true;
        if (limpiarResize) limpiarResize();
        tip.remove();
      }
    };
  }

  /* ============================================================
     DONUT — dona por barrido angular, centro dominante,
     leyenda clicable que resalta segmento
     ============================================================ */
  function donut(canvas, opc) {
    var segmentos = opc.segmentos || [];
    var tip = crearTooltip(canvas);
    var limpiarResize = null;
    var destruido = false;
    var resaltado = -1; // índice de segmento resaltado por la leyenda

    function total() { return segmentos.reduce(function (a, s) { return a + s.valor; }, 0); }
    function dominante() {
      var mejor = segmentos[0];
      segmentos.forEach(function (s) { if (s.valor > mejor.valor) mejor = s; });
      return mejor;
    }

    function dibujar(p) {
      if (destruido) return;
      var t = preparar(canvas);
      var ctx = t.ctx;
      var cx = t.ancho / 2, cy = t.alto / 2;
      var R = Math.min(t.ancho, t.alto) / 2 - 10;
      var r = R * 0.62;
      var tot = total();
      var ang = -Math.PI / 2; // arranca arriba

      segmentos.forEach(function (s, i) {
        var frac = s.valor / tot;
        var barrido = frac * Math.PI * 2 * p;
        var salto = 0.012 * (segmentos.length > 1 ? 1 : 0); // separación fina
        ctx.beginPath();
        ctx.arc(cx, cy, R, ang + salto, ang + barrido - salto);
        ctx.arc(cx, cy, r, ang + barrido - salto, ang + salto, true);
        ctx.closePath();
        var escala = (resaltado === -1 || resaltado === i) ? 1 : 0.28; // atenuar no resaltados
        ctx.globalAlpha = escala;
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ang += barrido;
      });

      // Centro: dominante (o total si se pide explícitamente)
      var c = opc.centro === 'total'
        ? { valor: tot, etiqueta: 'total' }
        : dominante();
      texto(ctx, 26, TOKENS.texto, '700');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(fmt(c.valor, c.valor % 1 ? 1 : 0) + (opc.centro === 'total' ? '' : '%'), cx, cy - 8);
      texto(ctx, 11, TOKENS.bajo);
      ctx.fillText(c.etiqueta, cx, cy + 16);
    }

    // Hover: detectar segmento por ángulo
    canvas.addEventListener('mousemove', function (ev) {
      var r = canvas.getBoundingClientRect();
      var dx = ev.clientX - r.left - r.width / 2;
      var dy = ev.clientY - r.top - r.height / 2;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var R = Math.min(r.width, r.height) / 2;
      if (dist > R * 0.62 - 4 && dist < R - 6) {
        var ang = Math.atan2(dy, dx) + Math.PI / 2; // 0 = arriba
        if (ang < 0) ang += Math.PI * 2;
        var acum = 0, tot = total(), hit = -1;
        for (var i = 0; i < segmentos.length; i++) {
          acum += (segmentos[i].valor / tot) * Math.PI * 2;
          if (ang <= acum) { hit = i; break; }
        }
        if (hit >= 0) {
          var s = segmentos[hit];
          mostrarTip(tip, r.width / 2 + dx, r.height / 2 + dy,
            '<div style="font:600 17px ' + FUENTE + ';color:' + TOKENS.texto + '">' +
            fmt(s.valor, s.valor % 1 ? 1 : 0) + '%</div>' +
            '<div style="font:400 11px ' + FUENTE + ';color:' + TOKENS.medio + '">' + s.etiqueta + '</div>');
          return;
        }
      }
      ocultarTip(tip);
    });
    canvas.addEventListener('mouseleave', function () { ocultarTip(tip); });

    // Leyenda clicable: resalta un segmento (segundo clic restaura)
    var ley = document.createElement('div');
    ley.className = 'leyenda';
    ley.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:10px;justify-content:center;';
    segmentos.forEach(function (s, i) {
      var it = document.createElement('button');
      it.type = 'button';
      it.className = 'leyenda-item';
      it.innerHTML = '<span class="leyenda-color" style="background:' + s.color + '"></span>' +
        s.etiqueta + ' · <strong>' + fmt(s.valor) + '%</strong>';
      it.addEventListener('click', function () {
        resaltado = (resaltado === i) ? -1 : i;
        segmentos.forEach(function (_, j) {
          ley.children[j].classList.toggle('is-inactiva', resaltado !== -1 && resaltado !== j);
        });
        dibujar(1);
      });
      ley.appendChild(it);
    });
    canvas.parentNode.appendChild(ley);

    limpiarResize = alRedimensionar(canvas, function () { dibujar(1); });
    animar(1100, easeOutCubic, dibujar);

    return {
      update: function (n) {
        segmentos = n;
        resaltado = -1;
        // refrescar la leyenda con los nuevos valores
        segmentos.forEach(function (s, i) {
          if (ley.children[i]) {
            ley.children[i].classList.remove('is-inactiva');
            ley.children[i].innerHTML = '<span class="leyenda-color" style="background:' +
              s.color + '"></span>' + s.etiqueta + ' · <strong>' + fmt(s.valor) + '%</strong>';
          }
        });
        dibujar(1);
      },
      destroy: function () {
        destruido = true;
        if (limpiarResize) limpiarResize();
        tip.remove(); ley.remove();
      }
    };
  }

  /* ============================================================
     countUp — número que cuenta hasta el objetivo (easeOutCubic)
     ============================================================ */
  function countUp(el, valor, opc) {
    opc = opc || {};
    var dec = opc.decimales || 0;
    var pre = opc.prefijo || '', suf = opc.sufijo || '';
    function pintar(v) {
      el.textContent = pre + fmt(v, dec) + suf;
    }
    if (REDUCED) { pintar(valor); return; }
    animar(opc.duracion || 1200, easeOutCubic, function (p) {
      pintar(valor * p);
    });
  }

  /* ---------- export ---------- */
  window.TechCharts = { line: line, bars: bars, donut: donut, countUp: countUp };
})();
