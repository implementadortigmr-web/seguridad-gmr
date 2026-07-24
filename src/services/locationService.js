import { Geolocation } from "@capacitor/geolocation";

export async function getCurrentLocation() {
  const ubicacionDefault = {
    ubicacionDisponible: false,
    latitud: null,
    longitud: null,
    precisionGps: null,
    errorGps: "",
  };

  try {
    if (!navigator.geolocation) {
      return {
        ...ubicacionDefault,
        errorGps: "El navegador no soporta geolocalización.",
      };
    }

    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0,
      });
    });

    return {
      ubicacionDisponible: true,
      latitud: position.coords.latitude,
      longitud: position.coords.longitude,
      precisionGps: position.coords.accuracy || null,
      errorGps: "",
    };
  } catch (error) {
    return {
      ...ubicacionDefault,
      errorGps: error?.message || "No fue posible obtener la ubicación.",
    };
  }
}

export async function obtenerUbicacionNativa() {
  const ubicacionDefault = {
    ubicacionDisponible: false,
    latitud: null,
    longitud: null,
    precisionGps: null,
    errorGps: "",
  };

  try {
    try {
      await Geolocation.requestPermissions();
    } catch (permissionError) {
      console.warn("Permisos de ubicación:", permissionError);
    }

    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0,
    });

    return {
      ubicacionDisponible: true,
      latitud: position.coords.latitude,
      longitud: position.coords.longitude,
      precisionGps: position.coords.accuracy || null,
      errorGps: "",
    };
  } catch (error) {
    return {
      ...ubicacionDefault,
      errorGps: error?.message || "No fue posible obtener la ubicación.",
    };
  }
}