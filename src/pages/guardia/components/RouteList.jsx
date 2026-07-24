import { PlayCircle } from "lucide-react";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizarGrupos(groupedRoutes) {
  if (Array.isArray(groupedRoutes)) {
    return groupedRoutes;
  }

  if (groupedRoutes && typeof groupedRoutes === "object") {
    return Object.values(groupedRoutes);
  }

  return [];
}

export default function RouteList({ groupedRoutes = [], onStartRoute }) {
  const grupos = normalizarGrupos(groupedRoutes);

  if (grupos.length === 0) {
    return (
      <div className="empty-state-card">
        <h3>No hay recorridos disponibles</h3>
        <p>
          No se encontraron recorridos activos para las propiedades asignadas a
          este usuario.
        </p>
      </div>
    );
  }

  return (
    <div className="route-list-wrapper">
      {grupos.map((grupo, groupIndex) => {
        const recorridos = safeArray(grupo?.recorridos);

        return (
          <div
            key={grupo?.propiedadId || grupo?.propiedadNombre || groupIndex}
            className="route-property-group"
          >
            <div className="route-property-header">
              <span>Propiedad</span>
              <h2>{grupo?.propiedadNombre || "Propiedad"}</h2>
            </div>

            {recorridos.length === 0 ? (
              <div className="empty-state-card">
                <p>No hay recorridos activos en esta propiedad.</p>
              </div>
            ) : (
              <div className="route-cards-grid">
                {recorridos.map((route, routeIndex) => {
                  const puntos = safeArray(route?.puntos);

                  return (
                    <article
                      key={route?.id || `${groupIndex}-${routeIndex}`}
                      className="route-card"
                    >
                      <div>
                        <h3>{route?.nombre || "Recorrido"}</h3>

                        <p>
                          {route?.propiedadNombre ||
                            grupo?.propiedadNombre ||
                            "Propiedad"}
                        </p>

                        <span>{puntos.length} punto(s)</span>
                      </div>

                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => {
                          if (typeof onStartRoute === "function") {
                            onStartRoute(route);
                          }
                        }}
                      >
                        <PlayCircle size={18} />
                        Iniciar
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}