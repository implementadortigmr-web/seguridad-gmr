import Dexie from "dexie";

export const localDb = new Dexie("seguridadGmrLocalDb");

localDb.version(1).stores({
  ejecuciones:
    "id, guardiaId, plantillaId, recorridoId, propiedadId, estado, pendienteSync, sincronizado, iniciadaEn, finalizadaEn",
  evidencias:
    "id, ejecucionId, puntoId, guardiaId, propiedadId, pendienteSync, sincronizado, capturadaEn",
});

function limpiarObjeto(objeto = {}) {
  return Object.fromEntries(
    Object.entries(objeto).filter(([, valor]) => valor !== undefined)
  );
}

export async function iniciarEjecucionLocal(ejecucion) {
  if (!ejecucion?.id) {
    throw new Error("La ejecución no tiene ID.");
  }

  const ahora = new Date().toISOString();

  const data = limpiarObjeto({
    ...ejecucion,
    estado: ejecucion.estado || "en_proceso",
    pendienteSync: ejecucion.pendienteSync !== false,
    sincronizado: ejecucion.sincronizado === true,
    iniciadaEn: ejecucion.iniciadaEn || ahora,
    creadaEn: ejecucion.creadaEn || ahora,
    actualizadaEn: ahora,
  });

  await localDb.ejecuciones.put(data);

  return data;
}

export async function finalizarEjecucionLocal(ejecucionId, cambios = {}) {
  if (!ejecucionId) {
    throw new Error("No se recibió el ID de la ejecución.");
  }

  const ejecucionActual = await localDb.ejecuciones.get(ejecucionId);

  if (!ejecucionActual) {
    throw new Error("No se encontró la ejecución local.");
  }

  const ahora = new Date().toISOString();

  const ejecucionFinalizada = limpiarObjeto({
    ...ejecucionActual,
    ...cambios,
    estado: cambios.estado || "finalizado",
    finalizadaEn: cambios.finalizadaEn || ahora,
    pendienteSync: cambios.pendienteSync !== false,
    sincronizado: cambios.sincronizado === true,
    actualizadaEn: ahora,
  });

  await localDb.ejecuciones.put(ejecucionFinalizada);

  return ejecucionFinalizada;
}

export async function guardarEvidenciaLocal(evidencia) {
  if (!evidencia?.id) {
    throw new Error("La evidencia no tiene ID.");
  }

  if (!evidencia?.ejecucionId) {
    throw new Error("La evidencia no tiene ejecución.");
  }

  const ahora = new Date().toISOString();

  const data = limpiarObjeto({
    ...evidencia,
    pendienteSync: evidencia.pendienteSync !== false,
    sincronizado: evidencia.sincronizado === true,
    capturadaEn: evidencia.capturadaEn || ahora,
    creadaEn: evidencia.creadaEn || ahora,
    actualizadaEn: ahora,
  });

  await localDb.evidencias.put(data);

  return data;
}

export async function listarEvidencias(ejecucionId) {
  if (!ejecucionId) return [];

  const evidencias = await localDb.evidencias
    .where("ejecucionId")
    .equals(ejecucionId)
    .toArray();

  return evidencias.sort((a, b) => {
    const ordenA = Number(a.puntoOrden || 0);
    const ordenB = Number(b.puntoOrden || 0);

    if (ordenA !== ordenB) return ordenA - ordenB;

    return String(a.capturadaEn || "").localeCompare(
      String(b.capturadaEn || "")
    );
  });
}

export async function obtenerEjecucionLocal(ejecucionId) {
  if (!ejecucionId) return null;

  return await localDb.ejecuciones.get(ejecucionId);
}

export async function listarEjecucionesPendientesSync() {
  const ejecuciones = await localDb.ejecuciones.toArray();

  return ejecuciones
    .filter((ejecucion) => {
      const estaFinalizada = ejecucion.estado === "finalizado";
      const estaPendiente = ejecucion.pendienteSync !== false;
      const noSincronizada = ejecucion.sincronizado !== true;

      return estaFinalizada && estaPendiente && noSincronizada;
    })
    .sort((a, b) =>
      String(b.finalizadaEn || b.iniciadaEn || "").localeCompare(
        String(a.finalizadaEn || a.iniciadaEn || "")
      )
    );
}

export async function marcarEjecucionSincronizada(ejecucionId) {
  if (!ejecucionId) return;

  const ejecucion = await localDb.ejecuciones.get(ejecucionId);

  if (!ejecucion) return;

  await localDb.ejecuciones.put({
    ...ejecucion,
    pendienteSync: false,
    sincronizado: true,
    sincronizadaEn: new Date().toISOString(),
    actualizadaEn: new Date().toISOString(),
  });
}

export async function marcarEvidenciasSincronizadas(ejecucionId) {
  if (!ejecucionId) return;

  const evidencias = await listarEvidencias(ejecucionId);
  const ahora = new Date().toISOString();

  const evidenciasActualizadas = evidencias.map((evidencia) => ({
    ...evidencia,
    pendienteSync: false,
    sincronizado: true,
    sincronizadaEn: ahora,
    actualizadaEn: ahora,
  }));

  if (evidenciasActualizadas.length > 0) {
    await localDb.evidencias.bulkPut(evidenciasActualizadas);
  }
}

export async function eliminarEjecucionLocal(ejecucionId) {
  if (!ejecucionId) return;

  await localDb.transaction("rw", localDb.ejecuciones, localDb.evidencias, async () => {
    await localDb.evidencias.where("ejecucionId").equals(ejecucionId).delete();
    await localDb.ejecuciones.delete(ejecucionId);
  });
}

export async function limpiarRecorridosSincronizados() {
  const ejecuciones = await localDb.ejecuciones.toArray();

  const sincronizadas = ejecuciones.filter(
    (ejecucion) =>
      ejecucion.estado === "finalizado" &&
      ejecucion.pendienteSync === false &&
      ejecucion.sincronizado === true
  );

  for (const ejecucion of sincronizadas) {
    await eliminarEjecucionLocal(ejecucion.id);
  }

  return sincronizadas.length;
}

export async function limpiarEvidenciasLocal(ejecucionId = "") {
  /*
    Si recibe ejecucionId, limpia solo las evidencias de ese recorrido.
    Si no recibe ejecucionId, limpia únicamente evidencias ya sincronizadas.
    Esto evita borrar recorridos pendientes por error.
  */

  if (ejecucionId) {
    const evidencias = await localDb.evidencias
      .where("ejecucionId")
      .equals(ejecucionId)
      .toArray();

    const evidenciasSincronizadas = evidencias.filter(
      (evidencia) =>
        evidencia.pendienteSync === false || evidencia.sincronizado === true
    );

    if (evidenciasSincronizadas.length > 0) {
      await localDb.evidencias.bulkDelete(
        evidenciasSincronizadas.map((evidencia) => evidencia.id)
      );
    }

    return evidenciasSincronizadas.length;
  }

  const evidencias = await localDb.evidencias.toArray();

  const evidenciasSincronizadas = evidencias.filter(
    (evidencia) =>
      evidencia.pendienteSync === false || evidencia.sincronizado === true
  );

  if (evidenciasSincronizadas.length > 0) {
    await localDb.evidencias.bulkDelete(
      evidenciasSincronizadas.map((evidencia) => evidencia.id)
    );
  }

  return evidenciasSincronizadas.length;
}