import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";
import { createThumbnail } from "../utils/image";

function limpiarRuta(valor = "") {
  return String(valor || "")
    .trim()
    .replace(/[^\w.-]/g, "_")
    .slice(0, 100);
}

function obtenerExtensionDesdeTipo(tipo = "") {
  if (tipo.includes("png")) return "png";
  if (tipo.includes("webp")) return "webp";
  return "jpg";
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
  const extension = obtenerExtensionDesdeTipo(evidencia.foto.type);

  const archivoBase = `${String(evidencia.puntoOrden || 0).padStart(
    2,
    "0"
  )}_${puntoId}_${Date.now()}`;

  const fotoPath = `evidencias/${propiedadId}/${guardiaId}/${ejecucionId}/${archivoBase}.${extension}`;
  const thumbPath = `evidencias/${propiedadId}/${guardiaId}/${ejecucionId}/${archivoBase}_thumb.jpg`;

  const fotoRef = ref(storage, fotoPath);
  const thumbRef = ref(storage, thumbPath);

  const thumbnail = await createThumbnail(evidencia.foto);

  await uploadBytes(fotoRef, evidencia.foto, {
    contentType: evidencia.foto.type || "image/jpeg",
    customMetadata: {
      ejecucionId,
      puntoId,
      guardiaId,
      propiedadId,
      tipo: "foto_original",
    },
  });

  await uploadBytes(thumbRef, thumbnail, {
    contentType: "image/jpeg",
    customMetadata: {
      ejecucionId,
      puntoId,
      guardiaId,
      propiedadId,
      tipo: "thumbnail",
    },
  });

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