import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Geolocation } from "@capacitor/geolocation";

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] || "image/jpeg";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
}

export async function tomarFotoNativa() {
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.DataUrl,
    quality: 72,
    allowEditing: false,
    correctOrientation: true,
    saveToGallery: false,
  });

  if (!photo.dataUrl) {
    throw new Error("No se pudo obtener la fotografía.");
  }

  const blob = dataUrlToBlob(photo.dataUrl);
  const extension = photo.format === "jpeg" ? "jpg" : photo.format || "jpg";

  return new File([blob], `evidencia_${Date.now()}.${extension}`, {
    type: blob.type || "image/jpeg",
  });
}

export async function obtenerUbicacionNativa() {
  try {
    await Geolocation.requestPermissions();

    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });

    return {
      ubicacionDisponible: true,
      latitud: position.coords.latitude,
      longitud: position.coords.longitude,
      precisionGps: position.coords.accuracy,
    };
  } catch (error) {
    return {
      ubicacionDisponible: false,
      errorGps: error?.message || "No fue posible obtener ubicación.",
    };
  }
}