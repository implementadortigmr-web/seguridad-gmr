export function normalizePoints(points = []) {
  if (!Array.isArray(points)) return [];

  return points
    .filter(Boolean)
    .map((point, index) => {
      if (typeof point === "string") {
        return {
          id: `punto_${index + 1}`,
          nombre: point,
          orden: index + 1,
        };
      }

      return {
        id: point.id || point.puntoId || `punto_${index + 1}`,
        nombre: point.nombre || point.puntoNombre || `Punto ${index + 1}`,
        orden: Number(point.orden || point.puntoOrden || index + 1),
        ...point,
      };
    })
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0));
}

export function sortByName(items = []) {
  if (!Array.isArray(items)) return [];

  return [...items].sort((a, b) =>
    String(a?.nombre || "").localeCompare(String(b?.nombre || ""))
  );
}

export function mapSnapshotRoutes(snapshot) {
  if (!snapshot?.docs || !Array.isArray(snapshot.docs)) return [];

  return snapshot.docs.map((documento) => {
    const data = documento.data() || {};

    return {
      id: documento.id,
      ...data,
      nombre: data.nombre || "Recorrido sin nombre",
      propiedadId: data.propiedadId || "",
      propiedadNombre: data.propiedadNombre || data.propiedad || "",
      puntos: normalizePoints(data.puntos || []),
    };
  });
}

export function groupRoutesByProperty(routes = []) {
  if (!Array.isArray(routes)) return [];

  const grupos = new Map();

  routes.forEach((route) => {
    if (!route) return;

    const propiedadId = route.propiedadId || "sin_propiedad";
    const propiedadNombre =
      route.propiedadNombre || route.propiedad || propiedadId;

    if (!grupos.has(propiedadId)) {
      grupos.set(propiedadId, {
        propiedadId,
        propiedadNombre,
        recorridos: [],
      });
    }

    grupos.get(propiedadId).recorridos.push(route);
  });

  return Array.from(grupos.values()).map((grupo) => ({
    ...grupo,
    recorridos: sortByName(grupo.recorridos || []),
  }));
}

export function chunkArray(items = [], size = 2) {
  if (!Array.isArray(items)) return [];

  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}