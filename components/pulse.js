/**
 * pulse.js — Simulación viva "Pulso Ciudadano"
 * -------------------------------------------------------------
 * Expone window.Pulso: un motor de fluctuación local (Math.random, sin red)
 * que genera menciones/hora, sentimiento % y delta de avance por proyecto,
 * con un ritmo natural de tick (6-8 s ALEATORIO EN CADA TICK, no un
 * cronómetro visible). Cero countdowns, cero fechas futuras decrecientes:
 * esto se lee como análisis en vivo, no como temporizador.
 *
 * Contrato (fase2-arquitectura.md §8):
 *   Pulso.fluctuar(base, {min, max, volatilidad}) -> number
 *   Pulso.sentimiento({positivo, neutro, negativo}) -> {positivo, neutro, negativo}
 *   Pulso.semilla(idProyecto, estadoInicial)      -> registra estado base
 *   Pulso.estado(idProyecto)                      -> estado vivo actual
 *   Pulso.iniciar(onTick)                         // onTick({momento: Date})
 *   Pulso.pausar() / Pulso.reanudar()
 *
 * Script clásico (sin import/export), sin dependencias, sin fetch.
 * Los datos en vivo se actualizan en cada tick aunque el usuario tenga
 * prefers-reduced-motion: la información nunca depende del movimiento.
 */
(function () {
  'use strict';

  // ---------- utilidades internas ----------

  // Entero aleatorio en [a, b] inclusive.
  function azar(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  // Redondeo a `d` decimales.
  function redondear(n, d) {
    var f = Math.pow(10, d || 0);
    return Math.round(n * f) / f;
  }

  // ---------- estado por proyecto ----------
  // semillas[id] = { mencionesHora, sentimiento: {positivo, neutro, negativo}, avance }
  var semillas = {};

  /**
   * fluctuar(base, {min, max, volatilidad})
   * Caminata aleatoria SIN estado: parte de `base` en cada llamada, se mueve
   * a lo sumo `volatilidad` por paso (saltos pequeños y creíbles, nunca
   * bruscos) y respeta los límites [min, max]. Devuelve número acotado.
   */
  function fluctuar(base, opts) {
    if (typeof base !== 'number' || !isFinite(base)) { return 0; }
    if (!opts) { opts = {}; }
    var vol = Math.abs(opts.volatilidad);
    if (typeof vol !== 'number' || !isFinite(vol) || vol <= 0) { vol = 1; }
    // Paso acotado a ±volatilidad, con leve regresión a la media para que
    // la serie no se pegue a los extremos del rango.
    var paso = (Math.random() * 2 - 1) * vol * 0.85;
    var valor = base + paso;
    var min = (typeof opts.min === 'number' && isFinite(opts.min)) ? opts.min : base - vol * 4;
    var max = (typeof opts.max === 'number' && isFinite(opts.max)) ? opts.max : base + vol * 4;
    valor = Math.max(min, Math.min(max, valor));
    // Enteros si el rango lo es (menciones/hora, personas); 1 decimal si no.
    var decimales = (Number.isInteger(min) && Number.isInteger(max) && Number.isInteger(base)) ? 0 : 1;
    return redondear(valor, decimales);
  }

  /**
   * sentimiento({positivo, neutro, negativo})
   * Redistribución coherente: mueve 1-3 puntos DEL NEUTRO hacia positivo o
   * negativo. Si el neutro se agota, toma del lado opuesto (un sentimiento
   * que sube SIEMPRE lo paga otro). Renormaliza a 100, sin negativos,
   * conservando enteros.
   */
  function sentimiento(actual) {
    var s = {
      positivo: Math.max(0, Math.round(actual && actual.positivo) || 0),
      neutro: Math.max(0, Math.round(actual && actual.neutro) || 0),
      negativo: Math.max(0, Math.round(actual && actual.negativo) || 0)
    };
    // Defensa contra entradas vacías o que no sumen 100.
    var total = s.positivo + s.neutro + s.negativo;
    if (total <= 0) { s.positivo = 60; s.neutro = 30; s.negativo = 10; }
    if (s.positivo + s.neutro + s.negativo !== 100) {
      s.neutro = Math.max(0, 100 - s.positivo - s.negativo);
    }
    if (s.positivo + s.neutro + s.negativo !== 100) {
      s.positivo = Math.max(0, 100 - s.neutro - s.negativo);
    }

    var delta = azar(1, 3) * (Math.random() < 0.5 ? -1 : 1); // ±1-3 puntos
    if (delta > 0) {
      // Positivo sube: paga primero el neutro, luego el negativo.
      var falta = delta - Math.min(s.neutro, delta);
      var tomaNeutro = delta - falta;
      s.neutro -= tomaNeutro;
      var tomaNegativo = Math.min(s.negativo, falta);
      s.negativo -= tomaNegativo;
      s.positivo += tomaNeutro + tomaNegativo;
    } else {
      // Negativo sube: paga primero el neutro, luego el positivo.
      var dn = -delta;
      var falta2 = dn - Math.min(s.neutro, dn);
      var tomaNeutro2 = dn - falta2;
      s.neutro -= tomaNeutro2;
      var tomaPositivo = Math.min(s.positivo, falta2);
      s.positivo -= tomaPositivo;
      s.negativo += tomaNeutro2 + tomaPositivo;
    }
    // Renormalización final exacta a 100 (el ajuste de redondeo cae en neutro).
    var fin = s.positivo + s.neutro + s.negativo;
    if (fin !== 100) { s.neutro += (100 - fin); }
    if (s.neutro < 0) {
      // Caso extremo: el lado dominante absorbe el déficit; neutro a 0.
      if (s.positivo >= s.negativo) { s.positivo += s.neutro; } else { s.negativo += s.neutro; }
      s.neutro = 0;
    }
    return s;
  }

  /**
   * semilla(idProyecto, estadoInicial)
   * Registra el estado base de un proyecto:
   *   { mencionesHora, sentimiento: {positivo, neutro, negativo}, avance }
   * Idempotente: re-registrar sobrescribe (útil para reiniciar el panel).
   */
  function semilla(id, estadoInicial) {
    if (!id) { return; }
    var s = estadoInicial || {};
    semillas[id] = {
      mencionesHora: Math.max(0, Math.round(s.mencionesHora) || 0),
      sentimiento: {
        positivo: Math.max(0, Math.round(s.sentimiento && s.sentimiento.positivo) || 0),
        neutro: Math.max(0, Math.round(s.sentimiento && s.sentimiento.neutro) || 0),
        negativo: Math.max(0, Math.round(s.sentimiento && s.sentimiento.negativo) || 0)
      },
      avance: (typeof s.avance === 'number' && isFinite(s.avance)) ? s.avance : 0
    };
  }

  /**
   * estado(idProyecto)
   * Estado VIVO actual (evoluciona en cada tick y persiste entre ticks).
   * Si el proyecto no tiene semilla registrada, devuelve null.
   */
  function estado(id) {
    return Object.prototype.hasOwnProperty.call(semillas, id) ? semillas[id] : null;
  }

  // ---------- motor de ticks (ritmo natural) ----------

  var temporizador = null; // setTimeout encadenado (NO setInterval: el retardo
                           // se re-sortea en cada tick → 6-8 s verdaderamente vivos).
  var oyente = null;       // callback del integrador.
  var activo = false;
  var pausadoPorOculto = false;

  // Un tick: evoluciona el estado de TODAS las semillas registradas y notifica.
  function tick() {
    var momento = new Date();
    for (var id in semillas) {
      if (!Object.prototype.hasOwnProperty.call(semillas, id)) { continue; }
      var e = semillas[id];
      // Menciones/hora: caminata acotada alrededor de la última lectura,
      // con rango dinámico proporcional a la base (mínimos sensatos).
      var baseM = Math.max(1, e.mencionesHora);
      e.mencionesHora = fluctuar(baseM, {
        min: Math.max(1, Math.round(baseM * 0.6)),
        max: Math.round(baseM * 1.4),
        volatilidad: Math.max(1, Math.round(baseM * 0.06))
      });
      // Sentimiento: redistribución coherente (positivo↑ ⇒ neutro/negativo↓).
      e.sentimiento = sentimiento(e.sentimiento);
      // Avance: delta pequeño, solo al alza, probabilístico (obra pública no
      // retrocede). Techo 99: el 100 lo marca el cronograma, no la simulación.
      if (typeof e.avance === 'number' && e.avance < 99 && Math.random() < 0.15) {
        e.avance = redondear(Math.min(99, e.avance + 0.1), 1);
      }
    }
    if (typeof oyente === 'function') {
      try { oyente({ momento: momento }); } catch (err) { /* un consumidor con errores no detiene el pulso */ }
    }
    // Re-sortear el retardo EN CADA TICK es lo que da el ritmo natural.
    if (activo && !pausadoPorOculto) { programar(); }
  }

  function programar() {
    temporizador = setTimeout(tick, azar(6000, 8000));
  }

  /**
   * iniciar(onTick)
   * Arranca el pulso. onTick recibe {momento: Date} una vez cada 6-8 s
   * (aleatorio por tick). Reinicia limpio si ya estaba activo.
   */
  function iniciar(onTick) {
    detener();
    pausadoPorOculto = false;
    oyente = (typeof onTick === 'function') ? onTick : null;
    activo = true;
    programar();
  }

  // Cancela el temporizador pendiente sin tocar el estado acumulado.
  function detener() {
    if (temporizador !== null) {
      clearTimeout(temporizador);
      temporizador = null;
    }
  }

  /** pausar(): congela el tick (el estado acumulado se conserva). */
  function pausar() {
    activo = false;
    detener();
  }

  /** reanudar(): retoma el pulso donde estaba (o lo arranca si nunca inició). */
  function reanudar() {
    if (activo) { return; }
    activo = true;
    pausadoPorOculto = false;
    programar();
  }

  // Pausa automática al ocultar la pestaña: no quemar batería ni acumular
  // saltos raros; al volver, el pulso sigue con ritmo fresco.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && activo && !pausadoPorOculto) {
      pausadoPorOculto = true;
      detener();
    } else if (!document.hidden && pausadoPorOculto) {
      pausadoPorOculto = false;
      if (activo) { programar(); }
    }
  });

  // ---------- API pública ----------
  window.Pulso = {
    fluctuar: fluctuar,
    sentimiento: sentimiento,
    semilla: semilla,
    estado: estado,
    iniciar: iniciar,
    pausar: pausar,
    reanudar: reanudar
  };
})();
