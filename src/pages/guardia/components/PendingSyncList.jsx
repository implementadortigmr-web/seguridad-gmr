import {
  RefreshCw,
  UploadCloud,
  Wifi,
  WifiOff,
} from "lucide-react";
import { formatDate } from "../../../utils/formatters";

export default function PendingSyncList({
  pendientes,
  isOnline,
  syncingId,
  onRefresh,
  onSync,
}) {
  if (!pendientes.length) return null;

  return (
    <section className="pending-sync-card">
      <div className="pending-sync-header">
        <div>
          <p className="eyebrow">Sincronización pendiente</p>
          <h2>Recorridos pendientes por subir</h2>
        </div>

        <div className={`sync-status-pill ${isOnline ? "online" : "offline"}`}>
          {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
          {isOnline ? "Con internet" : "Sin internet"}
        </div>
      </div>

      <div className="pending-sync-list">
        {pendientes.map((ejecucion) => {
          const syncing = syncingId === ejecucion.id;

          return (
            <article className="pending-sync-item" key={ejecucion.id}>
              <div>
                <strong>
                  {ejecucion.plantillaNombre || "Recorrido sin nombre"}
                </strong>

                <span>
                  {ejecucion.propiedadNombre ||
                    ejecucion.propiedad ||
                    ejecucion.propiedadId ||
                    "Sin propiedad"}
                </span>

                <small>
                  Finalizado: {formatDate(ejecucion.finalizadaEn)}
                </small>
              </div>

              <div className="pending-sync-meta">
                <span>
                  {ejecucion.puntosCompletados || 0}/
                  {ejecucion.totalPuntos || 0} puntos
                </span>

                <button
                  type="button"
                  className="primary-button"
                  disabled={!isOnline || syncing}
                  onClick={() => onSync(ejecucion)}
                >
                  <UploadCloud size={17} />
                  {syncing ? "Subiendo..." : "Subir ahora"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <button
        type="button"
        className="secondary-button pending-refresh-button"
        onClick={onRefresh}
      >
        <RefreshCw size={16} />
        Actualizar pendientes
      </button>
    </section>
  );
}