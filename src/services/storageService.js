import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";
import { compressImage, createThumbnail } from "../utils/image";

function limpiarRuta(valor = "") {
  return String(valor || "")
    .trim()
    .replace(/[^\w.-]/g, "_")
    .slice(0, 100);
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

  /*
    IMPORTANTE:
    Aunque la foto ya venga comprimida desde el recorrido,
    aquí la comprimimos otra vez para evitar fotos grandes
    guardadas en pendientes antiguos.
  */
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