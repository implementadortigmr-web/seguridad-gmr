import { PlayCircle } from "lucide-react";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizarGrupos(groupedRoutes) {
  if (!groupedRoutes) return [];

  if (Array.isArray(groupedRoutes)) {
    return groupedRoutes
      .map((grupo, index) => {
        const rutas =
          grupo.rutas ||
          grupo.routes ||
          grupo.recorridos ||
          grupo.items ||
          [];

        return {
          id: grupo.id || grupo.propiedadId || `grupo_${index}`,
          propiedadNombre:
            grupo.propiedadNombre ||
            grupo.nombre ||
            grupo.propiedad ||
            grupo.titulo ||
            "Propiedad",
          rutas: safeArray(rutas),
        };
      })
      .filter((grupo) => grupo.rutas.length > 0);
  }

  if (typeof groupedRoutes === "object") {
    return Object.entries(groupedRoutes)
      .map(([propiedadNombre, rutas], index) => ({
        id: `grupo_${index}_${propiedadNombre}`,
        propiedadNombre,
        rutas: safeArray(rutas),
      }))
      .filter((grupo) => grupo.rutas.length > 0);
  }

  return [];
}

export default function RouteList({ groupedRoutes = [], onStartRoute }) {
  const grupos = normalizarGrupos(groupedRoutes);

  if (!grupos.length) {
    return (
      <div className="guardia-empty-card">
        <h3>No hay recorridos disponibles</h3>
        <p>
          No se encontraron recorridos activos para las propiedades asignadas.
        </p>
      </div>
    );
  }

  function handleStart(route) {
    if (!route?.id) {
      alert("Este recorrido no tiene ID. Revisa la plantilla del recorrido.");
      return;
    }

    if (typeof onStartRoute !== "function") {
      alert("No se encontró la función para iniciar recorrido.");
      return;
    }

    onStartRoute(route);
  }

  return (
    <div className="route-list">
      {grupos.map((grupo) => (
        <section className="property-routes-card" key={grupo.id}>
          <p className="eyebrow">Propiedad</p>
          <h2>{grupo.propiedadNombre}</h2>

          <div className="route-cards-list">
            {grupo.rutas.map((route) => {
              const puntos =
                route.puntosTotales ||
                route.totalPuntos ||
                safeArray(route.puntos).length ||
                0;

              return (
                <article className="route-card" key={route.id}>
                  <div className="route-card-info">
                    <h3>{route.nombre || route.recorridoNombre || "Recorrido"}</h3>

                    <p>
                      {route.propiedadNombre ||
                        route.propiedad ||
                        grupo.propiedadNombre}
                    </p>

                    <strong>{puntos} punto(s)</strong>
                  </div>

                  <button
                    type="button"
                    className="primary-button route-start-button"
                    onClick={() => handleStart(route)}
                  >
                    <PlayCircle size={18} />
                    Iniciar
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}