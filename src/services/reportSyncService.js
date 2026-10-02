import {
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { subirFotoEvidencia } from "./storageService";


const COLLECTION_EJECUCIONES = "ejecucionesRecorridos";
const COLLECTION_EVIDENCIAS = "evidenciasPuntos";

function convertirFechaParaFirestore(valor) {
  if (!valor) return null;

  if (valor instanceof Date) {
    return Timestamp.fromDate(valor);
  }

  if (typeof valor === "string") {
    const fecha = new Date(valor);

    if (!Number.isNaN(fecha.getTime())) {
      return Timestamp.fromDate(fecha);
    }
  }

  if (valor?.seconds !== undefined && valor?.nanoseconds !== undefined) {
    return valor;
  }

  return null;
}

function limpiarObjeto(objeto = {}) {
  return Object.fromEntries(
    Object.entries(objeto).filter(([, valor]) => valor !== undefined)
  );
}

function quitarFotoLocal(evidencia = {}) {
  const { foto, ...resto } = evidencia;
  return resto;
}

async function procesarConLimite(items, limite, tarea) {
  const resultados = [];
  let indiceActual = 0;

  const trabajadores = Array.from(
    { length: Math.min(limite, items.length) },
    async () => {
      while (indiceActual < items.length) {
        const indice = indiceActual;
        indiceActual += 1;

        resultados[indice] = await tarea(items[indice], indice);
      }
    }
  );

  await Promise.all(trabajadores);

  return resultados;
}

function obtenerIdEvidencia(evidencia, index) {
  return (
    evidencia.id ||
    `${evidencia.ejecucionId || "ejecucion"}_${evidencia.puntoId || index}`
  );
}

function prepararEjecucion(ejecucion = {}, totalEvidencias = 0) {
  return limpiarObjeto({
    ...ejecucion,

    iniciadaEn: ejecucion.iniciadaEn || "",
    finalizadaEn: ejecucion.finalizadaEn || "",
    creadaEn: ejecucion.creadaEn || ejecucion.iniciadaEn || "",
    actualizadaEn: serverTimestamp(),
    sincronizadaEn: serverTimestamp(),

    estado: ejecucion.estado || "finalizado",
    pendienteSync: false,
    sincronizado: true,

    totalEvidencias,
    totalFotos: totalEvidencias,
  });
}

function prepararEvidencia({
  evidencia,
  ejecucion,
  resultadoFoto,
  evidenciaId,
}) {
  const evidenciaSinFotoLocal = quitarFotoLocal(evidencia);

  return limpiarObjeto({
    ...evidenciaSinFotoLocal,

    id: evidenciaId,
    ejecucionId: ejecucion.id,
    plantillaId: evidencia.plantillaId || ejecucion.plantillaId || "",
    plantillaNombre: evidencia.plantillaNombre || ejecucion.plantillaNombre || "",

    recorridoId: evidencia.recorridoId || ejecucion.recorridoId || ejecucion.plantillaId || "",
    recorridoNombre:
      evidencia.recorridoNombre ||
      ejecucion.recorridoNombre ||
      ejecucion.plantillaNombre ||
      "",

    propiedadId: evidencia.propiedadId || ejecucion.propiedadId || "",
    propiedadNombre: evidencia.propiedadNombre || ejecucion.propiedadNombre || "",

    guardiaId: evidencia.guardiaId || ejecucion.guardiaId || "",
    guardiaNombre: evidencia.guardiaNombre || ejecucion.guardiaNombre || "",

    dispositivoId: evidencia.dispositivoId || ejecucion.dispositivoId || "",
    dispositivoNombre:
      evidencia.dispositivoNombre || ejecucion.dispositivoNombre || "",

    puntoId: evidencia.puntoId || "",
    puntoNombre: evidencia.puntoNombre || "",
    puntoOrden: evidencia.puntoOrden || 0,

    comentario: evidencia.comentario || "",
    ubicacionDisponible: evidencia.ubicacionDisponible === true,
    latitud: evidencia.latitud ?? null,
    longitud: evidencia.longitud ?? null,
    precisionGps: evidencia.precisionGps ?? null,
    errorGps: evidencia.errorGps || "",

    capturadaEn: evidencia.capturadaEn || "",
    creadaEn: evidencia.creadaEn || evidencia.capturadaEn || "",
    actualizadaEn: serverTimestamp(),
    sincronizadaEn: serverTimestamp(),

    fotoSincronizada: resultadoFoto.fotoSincronizada === true,
    fotoUrl: resultadoFoto.fotoUrl || "",
    fotoStoragePath: resultadoFoto.fotoStoragePath || "",
    fotoThumbUrl: resultadoFoto.fotoThumbUrl || "",
    fotoThumbStoragePath: resultadoFoto.fotoThumbStoragePath || "",

    pendienteSync: false,
    sincronizado: true,
  });
}

export async function subirRecorridoConFotos({
  ejecucion,
  evidencias = [],
  onProgress,
}) {
  if (!ejecucion?.id) {
    throw new Error("No hay ejecución para sincronizar.");
  }

  const evidenciasValidas = Array.isArray(evidencias) ? evidencias : [];

  if (typeof onProgress === "function") {
    onProgress({
      actual: 0,
      total: evidenciasValidas.length,
      mensaje: "Preparando sincronización...",
    });
  }

  const ejecucionRef = doc(db, COLLECTION_EJECUCIONES, ejecucion.id);

  await setDoc(
    ejecucionRef,
    prepararEjecucion(ejecucion, evidenciasValidas.length),
    { merge: true }
  );

  let evidenciasProcesadas = 0;
  let fotosSincronizadas = 0;

  const evidenciasPreparadas = await procesarConLimite(
    evidenciasValidas,
    2,
    async (evidencia, index) => {
      const evidenciaId = obtenerIdEvidencia(evidencia, index);

      if (typeof onProgress === "function") {
        onProgress({
          actual: evidenciasProcesadas,
          total: evidenciasValidas.length,
          mensaje: `Subiendo fotografía ${evidenciasProcesadas + 1}/${
            evidenciasValidas.length
          }...`,
        });
      }

      const resultadoFoto = await subirFotoEvidencia({
        evidencia,
        ejecucion,
      });

      if (resultadoFoto.fotoSincronizada) {
        fotosSincronizadas += 1;
      }

      const evidenciaFirestore = prepararEvidencia({
        evidencia,
        ejecucion,
        resultadoFoto,
        evidenciaId,
      });

      evidenciasProcesadas += 1;

      if (typeof onProgress === "function") {
        onProgress({
          actual: evidenciasProcesadas,
          total: evidenciasValidas.length,
          mensaje: `Sincronizando ${evidenciasProcesadas}/${evidenciasValidas.length} evidencias...`,
        });
      }
      
      return {
        id: evidenciaId,
        data: evidenciaFirestore,
      };
    }
  );

  const batch = writeBatch(db);

  evidenciasPreparadas.forEach((evidenciaPreparada) => {
    const evidenciaRef = doc(
      db,
      COLLECTION_EVIDENCIAS,
      evidenciaPreparada.id
    );

    batch.set(evidenciaRef, evidenciaPreparada.data, { merge: true });
  });

  batch.set(
    ejecucionRef,
    {
      pendienteSync: false,
      sincronizado: true,
      totalEvidencias: evidenciasValidas.length,
      totalFotos: fotosSincronizadas,
      sincronizadaEn: serverTimestamp(),
      actualizadaEn: serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  if (typeof onProgress === "function") {
    onProgress({
      actual: evidenciasValidas.length,
      total: evidenciasValidas.length,
      mensaje: "Recorrido sincronizado correctamente.",
    });
  }

  return {
    ejecucionId: ejecucion.id,
    totalEvidencias: evidenciasValidas.length,
    totalFotos: fotosSincronizadas,
  };
}