export const HORAS_GRACIA_CIERRE_SESION = 6;
export const HORAS_MAXIMAS_RECORRIDO_SIN_MARCA = 24;

function parseMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

export function obtenerVencimientoRecorrido(ejecucion = {}) {
  const cierreSesionMs = parseMs(ejecucion.sesionCerradaEn);

  if (cierreSesionMs !== null) {
    return {
      venceEnMs: cierreSesionMs + HORAS_GRACIA_CIERRE_SESION * 60 * 60 * 1000,
      origen: "sesion_cerrada",
    };
  }

  const referenciaMs =
    parseMs(ejecucion.actualizadoEn) ??
    parseMs(ejecucion.iniciadaEn) ??
    parseMs(ejecucion.creadoEn);

  if (referenciaMs === null) return null;

  return {
    venceEnMs:
      referenciaMs + HORAS_MAXIMAS_RECORRIDO_SIN_MARCA * 60 * 60 * 1000,
    origen: "recorrido_antiguo",
  };
}

export function recorridoDebeCerrarseAutomaticamente(
  ejecucion = {},
  ahoraMs = Date.now()
) {
  if (!["en_proceso", "pausado"].includes(ejecucion.estado)) return false;

  const vencimiento = obtenerVencimientoRecorrido(ejecucion);
  if (!vencimiento) return false;

  return ahoraMs >= vencimiento.venceEnMs;
}

export function construirCierreAutomaticoRecorrido({
  ejecucion = {},
  puntosCompletados = 0,
  ahoraMs = Date.now(),
} = {}) {
  const vencimiento = obtenerVencimientoRecorrido(ejecucion);
  const total = Math.max(0, Number(ejecucion.puntosTotales || 0));
  const completados = Math.min(total || puntosCompletados, Math.max(0, Number(puntosCompletados || 0)));
  const finalizadaMs = vencimiento?.venceEnMs || ahoraMs;

  return {
    estado: "cerrado_incompleto",
    cierreAutomatico: true,
    guardiaNoTermino: true,
    motivoCierreAutomatico: "guardia_no_termino",
    motivoCierreAutomaticoNombre: "Guardia no terminó",
    comentarioCierreAutomatico:
      vencimiento?.origen === "sesion_cerrada"
        ? `El guardia cerró sesión y el recorrido permaneció pendiente durante ${HORAS_GRACIA_CIERRE_SESION} horas.`
        : `El recorrido permaneció pendiente por más de ${HORAS_MAXIMAS_RECORRIDO_SIN_MARCA} horas sin actividad.`,
    origenCierreAutomatico: vencimiento?.origen || "desconocido",
    puntosCompletados: completados,
    puntosPendientes: Math.max(0, total - completados),
    pendienteSync: true,
    sincronizado: false,
    finalizadaEn: new Date(finalizadaMs).toISOString(),
    cerradaAutomaticamenteEn: new Date(ahoraMs).toISOString(),
  };
}
