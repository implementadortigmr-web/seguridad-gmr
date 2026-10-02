import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { subirArchivosIncidencia } from "./storageService";

function isBlobLike(value) {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function limpiarParaFirestore(value) {
  if (value === undefined) return null;

  if (value === null) return null;

  if (isBlobLike(value)) return null;

  if (Array.isArray(value)) {
    return value.map((item) => limpiarParaFirestore(item));
  }

  if (typeof value === "object") {
    const limpio = {};

    Object.entries(value).forEach(([key, item]) => {
      if (
        key === "foto" ||
        key === "file" ||
        key === "archivo" ||
        key === "photo"
      ) {
        return;
      }

      limpio[key] = limpiarParaFirestore(item);
    });

    return limpio;
  }

  return value;
}

function construirDatosFirestore(incidencia, archivos) {
  const {
    fotos: fotosLocales,
    firmas: firmasLocales,
    foto,
    file,
    archivo,
    photo,
    ...resto
  } = incidencia;

  const firmas = archivos.firmas || {};

  return limpiarParaFirestore({
    ...resto,

    fotos: archivos.fotos || [],
    firmas,

    cantidadFotos: archivos.totalFotos || 0,
    cantidadFirmas: archivos.totalFirmas || 0,

    firmaProveedorUrl: firmas.proveedor?.url || "",
    firmaProveedorStoragePath: firmas.proveedor?.storagePath || "",

    firmaGuardiaUrl: firmas.guardia?.url || "",
    firmaGuardiaStoragePath: firmas.guardia?.storagePath || "",

    firmaResponsableTestigoUrl: firmas.responsableTestigo?.url || "",
    firmaResponsableTestigoStoragePath:
      firmas.responsableTestigo?.storagePath || "",

    sincronizado: true,
    pendienteSync: false,

    actualizadoEn: serverTimestamp(),
    sincronizadaEn: serverTimestamp(),
  });
}

export async function subirIncidenciaFirestore(incidencia, options = {}) {
  if (!incidencia?.id) {
    throw new Error("La incidencia no tiene ID.");
  }

  if (!incidencia?.propiedadId) {
    throw new Error("La incidencia no tiene propiedad.");
  }

  if (!incidencia?.guardiaId) {
    throw new Error("La incidencia no tiene guardia.");
  }

  const ref = doc(collection(db, "incidencias"), incidencia.id);

  options.onProgress?.({
    mensaje: "Preparando archivos de incidencia...",
  });

  const archivos = await subirArchivosIncidencia({
    incidencia,
    onProgress: options.onProgress,
  });

  options.onProgress?.({
    mensaje: "Guardando incidencia en Firestore...",
  });

  const datosFirestore = construirDatosFirestore(incidencia, archivos);

  await setDoc(
    ref,
    {
      ...datosFirestore,
      creadaEnServidor: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    id: incidencia.id,
    ...datosFirestore,
  };
}