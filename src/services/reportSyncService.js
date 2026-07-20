import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { subirFotoEvidencia } from "./storageService";

function limpiarTexto(valor = "") {
  return String(valor || "")
    .trim()
    .replace(/[^\w.-]/g, "_")
    .slice(0, 80);
}

function limpiarEvidenciaParaFirestore(evidencia, resultadoFoto) {
  return {
    ejecucionId: evidencia.ejecucionId,
    plantillaId: evidencia.plantillaId,
    plantillaNombre: evidencia.plantillaNombre || "",
    recorridoId: evidencia.recorridoId || evidencia.plantillaId,

    puntoId: evidencia.puntoId,
    puntoNombre: evidencia.puntoNombre,
    puntoOrden: evidencia.puntoOrden || 0,
    comentario: evidencia.comentario || "",

    guardiaId: evidencia.guardiaId,
    guardiaNombre: evidencia.guardiaNombre || "",

    propiedadId: evidencia.propiedadId,
    propiedad: evidencia.propiedad || "",

    dispositivoId: evidencia.dispositivoId || "",
    dispositivoNombre: evidencia.dispositivoNombre || "",

    capturadaEn: evidencia.capturadaEn,

    ubicacionDisponible: evidencia.ubicacionDisponible === true,
    latitud: evidencia.latitud || null,
    longitud: evidencia.longitud || null,
    precisionGps: evidencia.precisionGps || null,
    errorGps: evidencia.errorGps || "",

    fotoLocal: true,
    fotoSincronizada: resultadoFoto.fotoSincronizada,
    fotoUrl: resultadoFoto.fotoUrl,
    fotoStoragePath: resultadoFoto.fotoStoragePath,
    fotoThumbUrl: resultadoFoto.fotoThumbUrl || "",
    fotoThumbStoragePath: resultadoFoto.fotoThumbStoragePath || "",
    fotoNombre: evidencia.fotoNombre || "",
    pesoOriginal: evidencia.pesoOriginal || 0,
    pesoOptimizado: evidencia.pesoOptimizado || 0,

    estado: resultadoFoto.fotoSincronizada
      ? "sincronizada_con_foto"
      : "sincronizada_sin_foto",

    sincronizadaEn: serverTimestamp(),
  };
}

export async function subirRecorridoConFotos({ ejecucion, evidencias }) {
  if (!ejecucion?.id) {
    throw new Error("No se recibió la ejecución local.");
  }

  const evidenciasConFoto = [];

  for (const evidencia of evidencias) {
    const resultadoFoto = await subirFotoEvidencia({
      evidencia,
      ejecucion,
    });

    evidenciasConFoto.push({
      evidencia,
      resultadoFoto,
    });
  }

  const fotosSincronizadas = evidenciasConFoto.every(
    (item) => item.resultadoFoto.fotoSincronizada
  );

  const ejecucionRef = doc(db, "ejecucionesRecorridos", ejecucion.id);

  await setDoc(ejecucionRef, {
    idLocal: ejecucion.id,

    plantillaId: ejecucion.plantillaId,
    plantillaNombre: ejecucion.plantillaNombre || "",

    propiedadId: ejecucion.propiedadId,
    propiedadNombre: ejecucion.propiedadNombre || ejecucion.propiedadId,

    guardiaId: ejecucion.guardiaId,
    guardiaNombre: ejecucion.guardiaNombre || "",

    dispositivoId: ejecucion.dispositivoId || "",
    dispositivoNombre: ejecucion.dispositivoNombre || "",

    estado: ejecucion.estado || "finalizado",

    totalPuntos: ejecucion.totalPuntos || evidencias.length || 0,
    puntosCompletados: ejecucion.puntosCompletados || evidencias.length || 0,
    puntosPendientes: ejecucion.puntosPendientes || 0,

    iniciadaEn: ejecucion.iniciadaEn,
    finalizadaEn: ejecucion.finalizadaEn || new Date().toISOString(),

    fotosSincronizadas,
    totalFotos: evidenciasConFoto.filter(
      (item) => item.resultadoFoto.fotoSincronizada
    ).length,

    reporteSincronizado: true,
    sincronizadoEn: serverTimestamp(),
  });

  await Promise.all(
    evidenciasConFoto.map(({ evidencia, resultadoFoto }) => {
      const evidenciaId = `${ejecucion.id}_${limpiarTexto(evidencia.puntoId)}`;

      return setDoc(
        doc(db, "evidenciasPuntos", evidenciaId),
        limpiarEvidenciaParaFirestore(evidencia, resultadoFoto)
      );
    })
  );

  return {
    ejecucionId: ejecucion.id,
    totalEvidencias: evidencias.length,
    totalFotos: evidenciasConFoto.filter(
      (item) => item.resultadoFoto.fotoSincronizada
    ).length,
  };
}