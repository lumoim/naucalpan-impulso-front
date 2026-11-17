/**
 * reveal.js — Animaciones de entrada, parallax y fondo vivo
 * -------------------------------------------------------------
 * Expone window.Reveal (contrato fase2-arquitectura.md §9):
 *   Reveal.init()      // observa [data-reveal] y agrega .is-visible al entrar (una vez)
 *   Reveal.parallax()  // mueve [data-parallax] con rAF según scrollY (solo decorativo)
 *   Reveal.fondo()     // canvas #fondo-vivo: malla de nodos dorados, opacidad baja
 *
 * Script clásico (sin import/export), sin dependencias, sin fetch.
 * Respeta prefers-reduced-motion: sin movimiento, solo estados finales.
 * Comentarios en español.
 */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- 1) init: entrada al hacer scroll ----------

  function init() {
    var elementos = document.querySelectorAll('[data-reveal]');
    if (!elementos.length) { return; }

    // Sin IntersectionObserver o con movimiento reducido: todo visible al instante.
    if (!('IntersectionObserver' in window) || REDUCED) {
      for (var i = 0; i < elementos.length; i++) {
        elementos[i].classList.add('is-visible');
      }
      return;
    }

    var observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (entrada.isIntersecting) {
          entrada.target.classList.add('is-visible');
          observador.unobserve(entrada.target); // una sola vez, no se repite
        }
      });
    }, { threshold: 0.15 });

    for (var j = 0; j < elementos.length; j++) {
      observador.observe(elementos[j]);
    }
  }

  // ---------- 2) parallax: decorativo, acelerado por GPU ----------

  function parallax() {
    var elementos = document.querySelectorAll('[data-parallax]');
    if (!elementos.length) { return; }
    if (REDUCED) { return; } // sin movimiento: nada que hacer

    var pendiente = false;

    function paso() {
      pendiente = false;
      if (document.hidden) { return; }
      for (var i = 0; i < elementos.length; i++) {
        var el = elementos[i];
        var fuerza = parseFloat(el.getAttribute('data-parallax')) || 0.15;
        var rect = el.getBoundingClientRect();
        var centro = rect.top + rect.height / 2 - window.innerHeight / 2;
        // Desplazamiento sutil, proporcional a la distancia del centro del viewport.
        el.style.transform = 'translate3d(0,' + (-centro * fuerza).toFixed(1) + 'px,0)';
      }
    }

    window.addEventListener('scroll', function () {
      if (!pendiente) {
        pendiente = true;
        requestAnimationFrame(paso); // rAF: máximo un cálculo por cuadro
      }
    }, { passive: true });

    paso(); // posición inicial correcta sin esperar el primer scroll
  }

  // ---------- 3) fondo: malla de nodos dorados ----------

  function fondo() {
    var lienzo = document.getElementById('fondo-vivo');
    if (!lienzo || !lienzo.getContext) { return; }
    var ctx = lienzo.getContext('2d');

    var NUM = 42;            // nodos en pantalla
    var RADIO = 130;         // distancia máxima para trazar una línea
    var DORADO = { r: 201, g: 162, b: 39 };
    var ancho = 0, alto = 0, nodos = [];
    var corriendo = false;

    // Ajusta el lienzo al tamaño real de la ventana (nítido en retina).
    function medir() {
      var dpr = window.devicePixelRatio || 1;
      ancho = window.innerWidth;
      alto = window.innerHeight;
      lienzo.width = Math.round(ancho * dpr);
      lienzo.height = Math.round(alto * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Crea los nodos con velocidades lentas y direcciones variadas.
    function poblar() {
      nodos = [];
      for (var i = 0; i < NUM; i++) {
        nodos.push({
          x: Math.random() * ancho,
          y: Math.random() * alto,
          vx: (Math.random() * 2 - 1) * 0.22,
          vy: (Math.random() * 2 - 1) * 0.22
        });
      }
    }

    // Un cuadro: mueve los nodos, los dibuja y enlaza los cercanos.
    function dibujar() {
      ctx.clearRect(0, 0, ancho, alto);

      var i, j, n, dx, dy;
      for (i = 0; i < nodos.length; i++) {
        n = nodos[i];
        n.x += n.vx;
        n.y += n.vy;
        // Reaparición por el borde opuesto (margen de 10 px).
        if (n.x < -10) { n.x = ancho + 10; } else if (n.x > ancho + 10) { n.x = -10; }
        if (n.y < -10) { n.y = alto + 10; } else if (n.y > alto + 10) { n.y = -10; }

        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + DORADO.r + ',' + DORADO.g + ',' + DORADO.b + ',0.35)';
        ctx.fill();
      }

      // Líneas entre pares cercanos: opacidad decreciente con la distancia.
      ctx.lineWidth = 1;
      for (i = 0; i < nodos.length; i++) {
        for (j = i + 1; j < nodos.length; j++) {
          dx = nodos[i].x - nodos[j].x;
          dy = nodos[i].y - nodos[j].y;
          var dist = dx * dx + dy * dy; // comparar al cuadrado evita la raíz
          if (dist < RADIO * RADIO) {
            var alfa = (1 - Math.sqrt(dist) / RADIO) * 0.14;
            ctx.strokeStyle = 'rgba(' + DORADO.r + ',' + DORADO.g + ',' + DORADO.b + ',' + alfa.toFixed(3) + ')';
            ctx.beginPath();
            ctx.moveTo(nodos[i].x, nodos[i].y);
            ctx.lineTo(nodos[j].x, nodos[j].y);
            ctx.stroke();
          }
        }
      }
    }

    function cuadro() {
      if (!corriendo || document.hidden) { return; }
      dibujar();
      requestAnimationFrame(cuadro);
    }

    window.addEventListener('resize', function () {
      medir();
      poblar();
      if (REDUCED) { dibujar(); } // en modo estático redibujar una vez
    });

    medir();
    poblar();

    if (REDUCED) {
      dibujar(); // un solo cuadro estático, sin animación
      return;
    }

    corriendo = true;
    requestAnimationFrame(cuadro);
  }

  // ---------- API pública ----------
  window.Reveal = { init: init, parallax: parallax, fondo: fondo };
})();
