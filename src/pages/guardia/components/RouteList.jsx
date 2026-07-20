import { PlayCircle, RefreshCw } from "lucide-react";

export default function RouteList({
  selectedProperty,
  propertyGroups,
  selectedPropertyId,
  routesForSelectedProperty,
  registeredDevice,
  loadingRoutes,
  onRefresh,
  onPropertyChange,
  onStartRoute,
}) {
  return (
    <section className="route-card">
      <div className="route-header">
        <div>
          <p className="eyebrow">Propiedad seleccionada</p>

          <h2>{selectedProperty?.nombre || "Sin propiedad seleccionada"}</h2>

          {registeredDevice?.nombre && (
            <p className="route-meta">Equipo: {registeredDevice.nombre}</p>
          )}
        </div>

        <div className="route-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={onRefresh}
            disabled={loadingRoutes}
          >
            <RefreshCw size={17} />
            Actualizar
          </button>
        </div>
      </div>

      {propertyGroups.length > 1 && (
        <div className="assignment-selector compact-selector">
          <label className="field-label">Seleccionar propiedad</label>

          <select
            className="text-input"
            value={selectedPropertyId}
            onChange={(event) => onPropertyChange(event.target.value)}
          >
            {propertyGroups.map((property) => (
              <option key={property.id} value={property.id}>
                {property.nombre} · {property.recorridos.length} recorrido(s)
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="guard-route-list">
        <h3>Recorridos disponibles</h3>

        {routesForSelectedProperty.length > 0 ? (
          routesForSelectedProperty.map((route) => (
            <article className="guard-route-option" key={route.id}>
              <div>
                <strong>{route.nombre}</strong>
                <span>{route.totalPuntos || route.puntos?.length || 0} puntos de revisión</span>
              </div>

              <button
                className="primary-button"
                type="button"
                onClick={() => onStartRoute(route)}
              >
                <PlayCircle size={18} />
                Iniciar
              </button>
            </article>
          ))
        ) : (
          <div className="empty-state guard-empty-state">
            No hay recorridos activos para esta propiedad.
          </div>
        )}
      </div>
    </section>
  );
}