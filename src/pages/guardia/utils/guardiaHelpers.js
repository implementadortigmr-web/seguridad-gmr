export function normalizePoints(points = []) {
  return points.map((point, index) => {
    if (typeof point === "string") {
      return {
        id: `p${index + 1}`,
        orden: index + 1,
        nombre: point,
      };
    }

    return {
      id: point.id || `p${index + 1}`,
      orden: point.orden || index + 1,
      nombre: point.nombre || `Punto ${index + 1}`,
    };
  });
}

export function sortByName(items) {
  return [...items].sort((a, b) =>
    String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
  );
}

export function mapSnapshotRoutes(snapshot) {
  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export function chunkArray(array, size = 10) {
  const chunks = [];

  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }

  return chunks;
}

export function groupRoutesByProperty(routes) {
  const map = new Map();

  routes.forEach((route) => {
    const propertyId = route.propiedadId || "sin_propiedad";
    const propertyName = route.propiedadNombre || propertyId;

    if (!map.has(propertyId)) {
      map.set(propertyId, {
        id: propertyId,
        nombre: propertyName,
        recorridos: [],
      });
    }

    map.get(propertyId).recorridos.push(route);
  });

  return [...map.values()]
    .map((property) => ({
      ...property,
      recorridos: sortByName(property.recorridos),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function getDeviceMessage(status, deviceId) {
  if (status === "loading") return "Validando dispositivo...";

  if (status === "not_registered") {
    return `Este celular no está registrado. Solicita al administrador registrarlo con este ID: ${deviceId}`;
  }

  if (status === "inactive") {
    return "Este dispositivo está inactivo. Solicita al administrador activarlo.";
  }

  if (status === "no_properties") {
    return "Este dispositivo no tiene propiedades asignadas.";
  }

  if (status === "no_match") {
    return "El usuario y el celular no tienen propiedades en común.";
  }

  return "";
}