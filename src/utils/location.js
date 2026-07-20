export async function getCurrentLocation() {
  if (!navigator.geolocation) {
    return {
      ubicacionDisponible: false,
      errorGps: "Este dispositivo no permite ubicación.",
    };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          ubicacionDisponible: true,
          latitud: position.coords.latitude,
          longitud: position.coords.longitude,
          precisionGps: position.coords.accuracy,
        });
      },
      (error) => {
        resolve({
          ubicacionDisponible: false,
          errorGps: error.message,
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  });
}
