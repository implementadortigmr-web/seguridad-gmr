import {
  Camera,
  CheckCircle2,
  Clock3,
  HardDriveDownload,
  MapPin,
} from "lucide-react";
import { formatBytes, formatDate } from "../../../utils/formatters";

export default function PointCard({
  point,
  evidence,
  routeInProgress,
  processingPointId,
  onOpenCapture,
}) {
  const isCompleted = Boolean(evidence);
  const isProcessing = processingPointId === point.id;

  return (
    <article className={`point-card ${isCompleted ? "completed" : ""}`}>
      <div className="point-number">{point.orden}</div>

      <div className="point-content">
        <h3>{point.nombre}</h3>

        {isCompleted ? (
          <>
            <p className="status-complete">
              <CheckCircle2 size={16} />
              Evidencia guardada localmente
            </p>

            {evidence.comentario && (
              <p className="point-comment">
                <strong>Comentario:</strong> {evidence.comentario}
              </p>
            )}

            <div className="evidence-meta">
              <span>
                <Clock3 size={14} />
                {formatDate(evidence.capturadaEn)}
              </span>

              <span>
                <MapPin size={14} />
                {evidence.ubicacionDisponible
                  ? `GPS ±${Math.round(evidence.precisionGps)} m`
                  : "GPS no disponible"}
              </span>

              <span>
                <HardDriveDownload size={14} />
                {formatBytes(evidence.pesoOptimizado)}
              </span>
            </div>
          </>
        ) : (
          <p className="pending-text">Fotografía obligatoria pendiente</p>
        )}
      </div>

      {routeInProgress && (
        <button
          className={`camera-button ${isProcessing ? "disabled" : ""}`}
          type="button"
          disabled={isProcessing}
          onClick={() => onOpenCapture(point)}
        >
          <Camera size={18} />
          {isCompleted ? "Repetir foto" : "Tomar foto"}
        </button>
      )}
    </article>
  );
}