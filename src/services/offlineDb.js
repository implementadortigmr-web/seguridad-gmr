import Dexie from "dexie";
import {
  HORAS_GRACIA_CIERRE_SESION,
  construirCierreAutomaticoRecorrido,
  recorridoDebeCerrarseAutomaticamente,
} from "../pages/guardia/utils/routeExpiry";

export const localDb = new Dexie("seguridadGmrOffline");

localDb.version(1).stores({
  ejecuciones: "id, guardiaId, estado, pendienteSync",
  evidencias: "id, ejecucionId, puntoId, guardiaId, pendienteSync",
});

localDb.version(2).stores({
  ejecuciones: "id, guardiaId, estado, pendienteSync",
  evidencias: "id, ejecucionId, puntoId, guardiaId, pendienteSync",
  incidencias:
    "id, ejecucionId, guardiaId, propiedadId, tipo, estado, pendienteSync",
});

function ahoraIso() {
  return new Date().toISOString();
}

export async function iniciarEjecucionLocal(ejecucion) {
  if (!ejecucion?.id) {
    throw new Error("La ejecución no tiene ID.");
  }

  const data = {
    ...ejecucion,
    creadoEn: ejecucion.creadoEn || ahoraIso(),
    actualizadoEn: ahoraIso(),
  };

  await localDb.ejecuciones.put(data);

  return data;
}

export async function finalizarEjecucionLocal(ejecucionId, cambios = {}) {
  if (!ejecucionId) {
    throw new Error("No se encontró la ejecución.");
  }

  const actual = await localDb.ejecuciones.get(ejecucionId);

  if (!actual) {
    throw new Error("No se encontró el recorrido local.");
  }

  const actualizada = {
    ...actual,
    ...cambios,
    actualizadoEn: ahoraIso(),
  };

  await localDb.ejecuciones.put(actualizada);

  return actualizada;
}

export async function actualizarEjecucionLocal(ejecucionId, cambios = {}) {
  if (!ejecucionId) {
    throw new Error("No se encontró la ejecución.");
  }

  const actual = await localDb.ejecuciones.get(ejecucionId);

  if (!actual) {
    throw new Error("No se encontró el recorrido local.");
  }

  const actualizada = {
    ...actual,
    ...cambios,
    actualizadoEn: ahoraIso(),
  };

  await localDb.ejecuciones.put(actualizada);

  return actualizada;
}

export async function listarEjecucionesPendientesSync(guardiaId = "") {
  const ejecuciones = await localDb.ejecuciones.toArray();

  return ejecuciones
    .filter((ejecucion) => {
      const pendiente = ejecucion.pendienteSync !== false;
      const estadoSincronizable = ["finalizado", "cerrado_incompleto"].includes(
        ejecucion.estado
      );
      const mismoGuardia = !guardiaId || ejecucion.guardiaId === guardiaId;

      return pendiente && estadoSincronizable && mismoGuardia;
    })
    .sort((a, b) =>
      String(b.finalizadaEn || b.iniciadaEn || "").localeCompare(
        String(a.finalizadaEn || a.iniciadaEn || "")
      )
    );
}

export async function marcarEjecucionSincronizada(ejecucionId) {
  if (!ejecucionId) return;

  await localDb.ejecuciones.update(ejecucionId, {
    pendienteSync: false,
    sincronizado: true,
    sincronizadaEn: ahoraIso(),
    actualizadoEn: ahoraIso(),
  });
}

export async function guardarEvidenciaLocal(evidencia) {
  if (!evidencia?.id) {
    throw new Error("La evidencia no tiene ID.");
  }

  const data = {
    ...evidencia,
    pendienteSync: evidencia.pendienteSync !== false,
    sincronizado: evidencia.sincronizado === true,
    creadoEn: evidencia.creadoEn || ahoraIso(),
    actualizadoEn: ahoraIso(),
  };

  await localDb.evidencias.put(data);

  return data;
}

export async function listarEvidencias(ejecucionId) {
  if (!ejecucionId) return [];

  const evidencias = await localDb.evidencias
    .where("ejecucionId")
    .equals(ejecucionId)
    .toArray();

  return evidencias.sort(
    (a, b) => Number(a.puntoOrden || 0) - Number(b.puntoOrden || 0)
  );
}

export async function marcarEvidenciasSincronizadas(ejecucionId) {
  const evidencias = await listarEvidencias(ejecucionId);

  await Promise.all(
    evidencias.map((evidencia) =>
      localDb.evidencias.update(evidencia.id, {
        pendienteSync: false,
        sincronizado: true,
        sincronizadaEn: ahoraIso(),
        actualizadoEn: ahoraIso(),
      })
    )
  );
}

export async function guardarIncidenciaLocal(incidencia) {
  if (!incidencia?.id) {
    throw new Error("La incidencia no tiene ID.");
  }

  const data = {
    ...incidencia,
    pendienteSync: true,
    sincronizado: false,
    creadaEn: incidencia.creadaEn || ahoraIso(),
    actualizadoEn: ahoraIso(),
  };

  await localDb.incidencias.put(data);

  return data;
}

export async function listarIncidencias(ejecucionId) {
  if (!ejecucionId) return [];

  const incidencias = await localDb.incidencias
    .where("ejecucionId")
    .equals(ejecucionId)
    .toArray();

  return incidencias.sort((a, b) =>
    String(b.creadaEn || "").localeCompare(String(a.creadaEn || ""))
  );
}

export async function listarIncidenciasPendientesSync(guardiaId = "") {
  const incidencias = await localDb.incidencias.toArray();

  return incidencias
    .filter((incidencia) => {
      const pendiente = incidencia.pendienteSync !== false;
      const mismoGuardia = !guardiaId || incidencia.guardiaId === guardiaId;

      return pendiente && mismoGuardia;
    })
    .sort((a, b) =>
      String(b.creadaEn || "").localeCompare(String(a.creadaEn || ""))
    );
}

export async function marcarIncidenciaSincronizada(incidenciaId) {
  if (!incidenciaId) return;

  await localDb.incidencias.update(incidenciaId, {
    pendienteSync: false,
    sincronizado: true,
    sincronizadaEn: ahoraIso(),
    actualizadoEn: ahoraIso(),
  });
}

export async function marcarIncidenciasSincronizadas(ejecucionId) {
  const incidencias = await listarIncidencias(ejecucionId);

  await Promise.all(
    incidencias.map((incidencia) =>
      marcarIncidenciaSincronizada(incidencia.id)
    )
  );
}


export async function marcarRecorridosPorCierreSesion(guardiaId = "") {
  if (!guardiaId) return [];

  const ahora = ahoraIso();
  const vence = new Date(
    Date.parse(ahora) + HORAS_GRACIA_CIERRE_SESION * 60 * 60 * 1000
  ).toISOString();

  const ejecuciones = await localDb.ejecuciones.toArray();
  const pendientes = ejecuciones.filter(
    (ejecucion) =>
      ejecucion.guardiaId === guardiaId &&
      ["en_proceso", "pausado"].includes(ejecucion.estado)
  );

  await Promise.all(
    pendientes.map((ejecucion) =>
      localDb.ejecuciones.update(ejecucion.id, {
        sesionCerradaEn: ahora,
        vencimientoSesionEn: vence,
        actualizadoEn: ahora,
      })
    )
  );

  return Promise.all(pendientes.map((ejecucion) => localDb.ejecuciones.get(ejecucion.id)));
}

export async function limpiarCierreSesionRecorrido(ejecucionId) {
  if (!ejecucionId) return null;

  await localDb.ejecuciones.update(ejecucionId, {
    sesionCerradaEn: null,
    vencimientoSesionEn: null,
    recuperadoTrasCierreSesionEn: ahoraIso(),
    actualizadoEn: ahoraIso(),
  });

  return localDb.ejecuciones.get(ejecucionId);
}

function contarPuntosCapturados(evidencias = []) {
  return new Set(
    evidencias
      .map((evidencia) => String(evidencia?.puntoId || ""))
      .filter((puntoId) => puntoId && !puntoId.startsWith("__"))
  ).size;
}

export async function cerrarRecorridosVencidosLocal(guardiaId = "") {
  const ahoraMs = Date.now();
  const ejecuciones = await localDb.ejecuciones.toArray();
  const vencidas = ejecuciones.filter((ejecucion) => {
    const mismoGuardia = !guardiaId || ejecucion.guardiaId === guardiaId;
    return mismoGuardia && recorridoDebeCerrarseAutomaticamente(ejecucion, ahoraMs);
  });

  const cerradas = [];

  for (const ejecucion of vencidas) {
    const evidencias = await listarEvidencias(ejecucion.id);
    const cambios = construirCierreAutomaticoRecorrido({
      ejecucion,
      puntosCompletados: contarPuntosCapturados(evidencias),
      ahoraMs,
    });

    const actualizada = await finalizarEjecucionLocal(ejecucion.id, cambios);
    cerradas.push(actualizada);
  }

  return cerradas;
}

export async function listarEjecucionesActivasLocal(guardiaId = "") {
  const ejecuciones = await localDb.ejecuciones.toArray();

  return ejecuciones
    .filter((ejecucion) => {
      const esActiva = ejecucion.estado === "en_proceso";
      const mismoGuardia = !guardiaId || ejecucion.guardiaId === guardiaId;

      return esActiva && mismoGuardia;
    })
    .sort((a, b) =>
      String(b.actualizadoEn || b.iniciadaEn || "").localeCompare(
        String(a.actualizadoEn || a.iniciadaEn || "")
      )
    );
}

export async function obtenerEjecucionActivaLocal(guardiaId = "") {
  const activas = await listarEjecucionesActivasLocal(guardiaId);
  return activas[0] || null;
}

export async function listarEjecucionesPausadasLocal(guardiaId = "") {
  const ejecuciones = await localDb.ejecuciones.toArray();

  return ejecuciones
    .filter((ejecucion) => {
      const esPausado = ejecucion.estado === "pausado";
      const mismoGuardia = !guardiaId || ejecucion.guardiaId === guardiaId;

      return esPausado && mismoGuardia;
    })
    .sort((a, b) =>
      String(b.pausadoEn || b.iniciadaEn || "").localeCompare(
        String(a.pausadoEn || a.iniciadaEn || "")
      )
    );
}