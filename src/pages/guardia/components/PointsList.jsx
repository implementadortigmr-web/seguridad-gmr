import { ArrowLeft, ClipboardCheck } from "lucide-react";
import PointCard from "./PointCard";

export default function PointsList({
  points,
  evidenceByPoint,
  missing,
  routeInProgress,
  routeFinished,
  processingPointId,
  onOpenCapture,
  onRequestFinish,
  onBackToList,
}) {
  return (
    <section className="points-section">
      <div className="section-title">
        <h2>Puntos de revisión</h2>
        <span>{missing} pendientes</span>
      </div>

      <div className="points-list">
        {points.map((point) => (
          <PointCard
            key={point.id}
            point={point}
            evidence={evidenceByPoint.get(point.id)}
            routeInProgress={routeInProgress}
            processingPointId={processingPointId}
            onOpenCapture={onOpenCapture}
          />
        ))}
      </div>

      {routeInProgress && (
        <button className="finish-button" type="button" onClick={onRequestFinish}>
          <ClipboardCheck size={19} />
          Finalizar recorrido
        </button>
      )}

      {routeFinished && (
        <button className="finish-button" type="button" onClick={onBackToList}>
          <ArrowLeft size={19} />
          Volver a recorridos
        </button>
      )}
    </section>
  );
}