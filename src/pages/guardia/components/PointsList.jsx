import { Camera, CheckCircle2, Circle, Flag, MapPin } from "lucide-react";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function obtenerEvidencia(evidenceMap, pointId) {
  if (!evidenceMap || !pointId) return null;

  if (evidenceMap instanceof Map) {
    return evidenceMap.get(pointId) || null;
  }

  if (typeof evidenceMap === "object") {
    return evidenceMap[pointId] || null;
  }

  return null;
}

function formatHora(valor) {
  if (!valor) return "";

  try {
    const fecha = new Date(valor);

    if (Number.isNaN(fecha.getTime())) return "";

    return fecha.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function PointsList({
  points = [],
  evidenceMap = {},
  completed = 0,
  missing = 0,
  savingFinish = false,
  onCapture,
  onOpenFinish,
}) {
  const safePoints = safeArray(points);
  const completedSafe = Number(completed || 0);
  const missingSafe = Number(missing || 0);
  const totalSafe = safePoints.length;

  return (
    <section className="points-section">
      <div className="points-header clean-points-header">
        <div>
          <span className="guardia-kicker">Puntos del recorrido</span>
          <h2>Revisión de puntos</h2>
          <p>
            {completedSafe}/{totalSafe} puntos completados · {missingSafe}{" "}
            pendiente(s)
          </p>
        </div>
      </div>

      {safePoints.length === 0 ? (
        <div className="empty-state-card">
          <h3>No hay puntos en este recorrido</h3>
          <p>Este recorrido no tiene puntos configurados.</p>
        </div>
      ) : (
        <div className="points-list">
          {safePoints.map((point, index) => {
            const puntoId = point?.id || point?.puntoId || `punto_${index + 1}`;
            const puntoNombre =
              point?.nombre || point?.puntoNombre || `Punto ${index + 1}`;

            const evidencia = obtenerEvidencia(evidenceMap, puntoId);
            const completado = Boolean(evidencia);
            const hora = formatHora(
              evidencia?.capturadaEn || evidencia?.creadaEn || ""
            );

            return (
              <article
                key={puntoId}
                className={`point-card ${completado ? "completed" : ""}`}
              >
                <div className="point-status-icon">
                  {completado ? (
                    <CheckCircle2 size={22} />
                  ) : (
                    <Circle size={22} />
                  )}
                </div>

                <div className="point-content">
                  <div className="point-title-row">
                    <h3>
                      {index + 1}. {puntoNombre}
                    </h3>

                    <span
                      className={`point-badge ${
                        completado ? "success" : "pending"
                      }`}
                    >
                      {completado ? "Completado" : "Pendiente"}
                    </span>
                  </div>

                  {completado ? (
                    <div className="point-evidence-summary">
                      {evidencia?.comentario && (
                        <p>
                          <strong>Comentario:</strong> {evidencia.comentario}
                        </p>
                      )}

                      {hora && (
                        <p>
                          <strong>Hora:</strong> {hora}
                        </p>
                      )}

                      {evidencia?.latitud && evidencia?.longitud && (
                        <p className="point-gps">
                          <MapPin size={14} />
                          {Number(evidencia.latitud).toFixed(6)},{" "}
                          {Number(evidencia.longitud).toFixed(6)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="point-helper">
                      Toma una fotografía y agrega comentario para completar
                      este punto.
                    </p>
                  )}
                </div>

                <div className="point-actions">
                  <button
                    type="button"
                    className={completado ? "secondary-button" : "primary-button"}
                    onClick={() => {
                      if (typeof onCapture === "function") {
                        onCapture(point);
                      }
                    }}
                    disabled={savingFinish}
                  >
                    <Camera size={16} />
                    {completado ? "Actualizar" : "Tomar foto"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="points-finish-footer">
        <button
          type="button"
          className="primary-button finish-route-button"
          onClick={onOpenFinish}
          disabled={savingFinish || totalSafe === 0}
        >
          <Flag size={18} />
          {savingFinish ? "Finalizando..." : "Finalizar recorrido"}
        </button>
      </div>
    </section>
  );
}