import { ArrowLeft } from "lucide-react";
import ProgressBar from "../../../components/ProgressBar";
import { formatDate } from "../../../utils/formatters";

export default function ActiveRouteCard({
  selectedRoute,
  registeredDevice,
  activeExecution,
  completed,
  total,
  routeFinished,
  onBackToList,
}) {
  return (
    <section className="route-card">
      <div className="route-header">
        <div>
          <p className="eyebrow">Recorrido seleccionado</p>

          <h2>{selectedRoute.nombre}</h2>

          <p className="route-meta">
            Propiedad: {selectedRoute.propiedadNombre || selectedRoute.propiedadId}
          </p>

          {registeredDevice?.nombre && (
            <p className="route-meta">Equipo: {registeredDevice.nombre}</p>
          )}
        </div>

        <div className="route-actions">
          {routeFinished && (
            <button
              className="secondary-button"
              type="button"
              onClick={onBackToList}
            >
              <ArrowLeft size={17} />
              Elegir otro
            </button>
          )}
        </div>
      </div>

      <ProgressBar completed={completed} total={total} />

      {routeFinished && (
        <div className="finished-box">
          <strong>Recorrido finalizado localmente</strong>
          <span>
            Inicio: {formatDate(activeExecution?.iniciadaEn)} · Cierre:{" "}
            {formatDate(activeExecution?.finalizadaEn)}
          </span>
        </div>
      )}
    </section>
  );
}