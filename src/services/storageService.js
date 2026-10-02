import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";
import { compressImage, createThumbnail } from "../utils/image";

function limpiarRuta(valor = "") {
  return String(valor || "")
    .trim()
    .replace(/[^\w.-]/g, "_")
    .slice(0, 100);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function dataUrlToBlob(dataUrl = "") {
  if (!dataUrl || typeof dataUrl !== "string") {
    throw new Error("Firma inválida.");
  }

  const partes = dataUrl.split(",");
  const encabezado = partes[0] || "";
  const base64 = partes[1] || "";

  const mimeMatch = encabezado.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] || "image/png";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
}

export async function subirFotoEvidencia({ evidencia, ejecucion }) {
  if (!evidencia?.foto) {
    return {
      fotoSincronizada: false,
      fotoUrl: "",
      fotoStoragePath: "",
      fotoThumbUrl: "",
      fotoThumbStoragePath: "",
    };
  }

  const propiedadId = limpiarRuta(
    evidencia.propiedadId || ejecucion.propiedadId
  );
  const guardiaId = limpiarRuta(evidencia.guardiaId || ejecucion.guardiaId);
  const ejecucionId = limpiarRuta(ejecucion.id || evidencia.ejecucionId);
  const puntoId = limpiarRuta(evidencia.puntoId);

  const archivoBase = `${String(evidencia.puntoOrden || 0).padStart(
    2,
    "0"
  )}_${puntoId}_${Date.now()}`;

  const fotoPath = `evidencias/${propiedadId}/${guardiaId}/${ejecucionId}/${archivoBase}.jpg`;
  const thumbPath = `evidencias/${propiedadId}/${guardiaId}/${ejecucionId}/${archivoBase}_thumb.jpg`;

  const fotoRef = ref(storage, fotoPath);
  const thumbRef = ref(storage, thumbPath);

  const fotoOptimizada = await compressImage(evidencia.foto);
  const thumbnail = await createThumbnail(fotoOptimizada);

  await Promise.all([
    uploadBytes(fotoRef, fotoOptimizada, {
      contentType: "image/jpeg",
      customMetadata: {
        ejecucionId,
        puntoId,
        guardiaId,
        propiedadId,
        tipo: "foto_original",
      },
    }),

    uploadBytes(thumbRef, thumbnail, {
      contentType: "image/jpeg",
      customMetadata: {
        ejecucionId,
        puntoId,
        guardiaId,
        propiedadId,
        tipo: "thumbnail",
      },
    }),
  ]);

  const [fotoUrl, fotoThumbUrl] = await Promise.all([
    getDownloadURL(fotoRef),
    getDownloadURL(thumbRef),
  ]);

  return {
    fotoSincronizada: true,
    fotoUrl,
    fotoStoragePath: fotoPath,
    fotoThumbUrl,
    fotoThumbStoragePath: thumbPath,
  };
}

async function subirFotoIncidencia({ incidencia, foto, index }) {
  const propiedadId = limpiarRuta(incidencia.propiedadId);
  const guardiaId = limpiarRuta(incidencia.guardiaId);
  const incidenciaId = limpiarRuta(incidencia.id);
  const tipo = limpiarRuta(incidencia.tipo || "incidencia");

  const fotoLocal = foto?.foto || foto?.file || foto?.archivo || foto;

  if (!fotoLocal) {
    return null;
  }

  const orden = foto?.orden || index + 1;

  const archivoBase = `${String(orden).padStart(
    2,
    "0"
  )}_${tipo}_${Date.now()}`;

  const fotoPath = `incidencias/${propiedadId}/${guardiaId}/${incidenciaId}/fotos/${archivoBase}.jpg`;
  const thumbPath = `incidencias/${propiedadId}/${guardiaId}/${incidenciaId}/fotos/${archivoBase}_thumb.jpg`;

  const fotoRef = ref(storage, fotoPath);
  const thumbRef = ref(storage, thumbPath);

  const fotoOptimizada = await compressImage(fotoLocal);
  const thumbnail = await createThumbnail(fotoOptimizada);

  await Promise.all([
    uploadBytes(fotoRef, fotoOptimizada, {
      contentType: "image/jpeg",
      customMetadata: {
        incidenciaId,
        guardiaId,
        propiedadId,
        tipo: "incidencia_foto",
        orden: String(orden),
      },
    }),

    uploadBytes(thumbRef, thumbnail, {
      contentType: "image/jpeg",
      customMetadata: {
        incidenciaId,
        guardiaId,
        propiedadId,
        tipo: "incidencia_thumbnail",
        orden: String(orden),
      },
    }),
  ]);

  const [fotoUrl, fotoThumbUrl] = await Promise.all([
    getDownloadURL(fotoRef),
    getDownloadURL(thumbRef),
  ]);

  return {
    id: foto?.id || `${incidenciaId}_foto_${orden}`,
    orden,
    nombreArchivo: foto?.nombreArchivo || `foto_${orden}.jpg`,
    fotoSincronizada: true,
    fotoUrl,
    fotoStoragePath: fotoPath,
    fotoThumbUrl,
    fotoThumbStoragePath: thumbPath,
  };
}

async function subirFirmaIncidencia({ incidencia, nombreFirma, firmaDataUrl }) {
  if (!firmaDataUrl || typeof firmaDataUrl !== "string") {
    return null;
  }

  if (firmaDataUrl.startsWith("http")) {
    return {
      url: firmaDataUrl,
      storagePath: "",
      sincronizada: true,
    };
  }

  const propiedadId = limpiarRuta(incidencia.propiedadId);
  const guardiaId = limpiarRuta(incidencia.guardiaId);
  const incidenciaId = limpiarRuta(incidencia.id);
  const firmaNombreLimpio = limpiarRuta(nombreFirma);

  const firmaBlob = dataUrlToBlob(firmaDataUrl);

  const firmaPath = `incidencias/${propiedadId}/${guardiaId}/${incidenciaId}/firmas/${firmaNombreLimpio}_${Date.now()}.png`;
  const firmaRef = ref(storage, firmaPath);

  await uploadBytes(firmaRef, firmaBlob, {
    contentType: "image/png",
    customMetadata: {
      incidenciaId,
      guardiaId,
      propiedadId,
      tipo: `firma_${firmaNombreLimpio}`,
    },
  });

  const url = await getDownloadURL(firmaRef);

  return {
    url,
    storagePath: firmaPath,
    sincronizada: true,
  };
}

export async function subirArchivosIncidencia({ incidencia, onProgress }) {
  if (!incidencia?.id) {
    throw new Error("La incidencia no tiene ID.");
  }

  const fotosLocales = safeArray(incidencia.fotos);
  const firmasLocales = incidencia.firmas || {};

  const fotos = [];

  for (let index = 0; index < fotosLocales.length; index += 1) {
    onProgress?.({
      mensaje: `Subiendo foto ${index + 1} de ${fotosLocales.length}...`,
    });

    const fotoSubida = await subirFotoIncidencia({
      incidencia,
      foto: fotosLocales[index],
      index,
    });

    if (fotoSubida) {
      fotos.push(fotoSubida);
    }
  }

  const firmas = {};

  const nombresFirmas = Object.keys(firmasLocales).filter(
    (nombre) => firmasLocales[nombre]
  );

  for (let index = 0; index < nombresFirmas.length; index += 1) {
    const nombreFirma = nombresFirmas[index];

    onProgress?.({
      mensaje: `Subiendo firma ${index + 1} de ${nombresFirmas.length}...`,
    });

    const firmaSubida = await subirFirmaIncidencia({
      incidencia,
      nombreFirma,
      firmaDataUrl: firmasLocales[nombreFirma],
    });

    if (firmaSubida) {
      firmas[nombreFirma] = firmaSubida;
    }
  }

  return {
    fotos,
    firmas,
    totalFotos: fotos.length,
    totalFirmas: Object.keys(firmas).length,
  };
}