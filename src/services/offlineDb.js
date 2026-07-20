import Dexie from "dexie";

export const localDb = new Dexie("RondinesSeguridadGMR");

localDb.version(1).stores({
  evidencias:
    "++id, [recorridoId+puntoId], recorridoId, puntoId, guardiaId, estado, capturadaEn",
});

localDb.version(2).stores({
  evidencias:
    "++id, [ejecucionId+puntoId], ejecucionId, recorridoId, puntoId, guardiaId, estado, capturadaEn",
  ejecuciones:
    "id, plantillaId, guardiaId, propiedadId, estado, iniciadaEn, finalizadaEn",
});

function crearIdEjecucion(plantillaId, guardiaId) {
  return `local_${plantillaId}_${guardiaId}_${Date.now()}`;
}

export async function crearEjecucionLocal({ plantilla, guardia }) {
  const ejecucion = {
    id: crearIdEjecucion(plantilla.id, guardia.id),
    plantillaId: plantilla.id,
    plantillaNombre: plantilla.nombre,
    propiedadId: plantilla.propiedadId,
    propiedadNombre: plantilla.propiedadNombre || plantilla.propiedadId,
    guardiaId: guardia.id,
    guardiaNombre: guardia.nombre,
    estado: "en_proceso",
    totalPuntos: plantilla.totalPuntos || plantilla.puntos?.length || 0,
    puntosCompletados: 0,
    iniciadaEn: new Date().toISOString(),
    finalizadaEn: null,
    pendienteSync: true,
  };

  await localDb.ejecuciones.add(ejecucion);

  return ejecucion;
}

export async function obtenerEjecucionActiva(plantillaId, guardiaId) {
  const ejecuciones = await localDb.ejecuciones
    .where("estado")
    .equals("en_proceso")
    .toArray();

  return (
    ejecuciones.find(
      (item) => item.plantillaId === plantillaId && item.guardiaId === guardiaId
    ) || null
  );
}

export async function finalizarEjecucionLocal(ejecucionId, resumen = {}) {
  const cambios = {
    estado: "finalizado",
    finalizadaEn: new Date().toISOString(),
    pendienteSync: true,
    ...resumen,
  };

  await localDb.ejecuciones.update(ejecucionId, cambios);

  return localDb.ejecuciones.get(ejecucionId);
}

export async function guardarEvidenciaLocal(evidencia) {
  const registroExistente = await localDb.evidencias
    .where("[ejecucionId+puntoId]")
    .equals([evidencia.ejecucionId, evidencia.puntoId])
    .first();

  const data = {
    ...evidencia,
    estado: evidencia.estado || "pendiente_sync",
    capturadaEn: evidencia.capturadaEn || new Date().toISOString(),
    pendienteSync: true,
  };

  if (registroExistente) {
    return localDb.evidencias.put({
      ...data,
      id: registroExistente.id,
    });
  }

  return localDb.evidencias.add(data);
}

export async function listarEvidencias(ejecucionId) {
  if (!ejecucionId) return [];

  return localDb.evidencias
    .where("ejecucionId")
    .equals(ejecucionId)
    .toArray();
}

export async function contarEvidenciasPendientes() {
  return localDb.evidencias
    .where("estado")
    .equals("pendiente_sync")
    .count();
}

export async function listarEjecucionesPendientes() {
  return localDb.ejecuciones
    .where("pendienteSync")
    .equals(true)
    .toArray();
}

export async function limpiarEvidenciasLocal() {
  await localDb.evidencias.clear();
  await localDb.ejecuciones.clear();
}

export async function marcarEjecucionSincronizada(ejecucionId) {
  return localDb.ejecuciones.update(ejecucionId, {
    pendienteSync: false,
    sincronizadaEn: new Date().toISOString(),
  });
}

export async function marcarEvidenciasSincronizadas(ejecucionId) {
  const evidencias = await listarEvidencias(ejecucionId);

  await Promise.all(
    evidencias.map((evidencia) =>
      localDb.evidencias.update(evidencia.id, {
        estado: "sincronizada_con_foto",
        pendienteSync: false,
        sincronizadaEn: new Date().toISOString(),
      })
    )
  );
}

export async function listarEjecucionesPendientesSync() {
  const ejecuciones = await localDb.ejecuciones.toArray();

  return ejecuciones
    .filter((ejecucion) => {
      const estaFinalizada = ejecucion.estado === "finalizado";
      const estaPendiente = ejecucion.pendienteSync !== false;

      return estaFinalizada && estaPendiente;
    })
    .sort((a, b) =>
      String(b.finalizadaEn || b.iniciadaEn || "").localeCompare(
        String(a.finalizadaEn || a.iniciadaEn || "")
      )
    );
}