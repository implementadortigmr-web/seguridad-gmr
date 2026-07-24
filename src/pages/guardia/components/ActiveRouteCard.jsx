import { ShieldCheck } from "lucide-react";

function safeText(value, fallback = "No disponible") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function safeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export default function ActiveRouteCard({
  route = {},
  execution = {},
  completed = 0,
  total = 0,
}) {
  const routeName = safeText(
    route?.nombre || route?.recorridoNombre || execution?.plantillaNombre,
    "Recorrido"
  );

  const propertyName = safeText(
    route?.propiedadNombre ||
      execution?.propiedadNombre ||
      route?.propiedad ||
      route?.propiedadId,
    "Propiedad"
  );

  const completedSafe = safeNumber(completed);
  const totalSafe = safeNumber(total);

  const porcentaje =
    totalSafe > 0 ? Math.min(100, Math.round((completedSafe / totalSafe) * 100)) : 0;

  return (
    <article className="active-route-card compact-active-route">
      <div className="active-route-header">
        <div>
          <span className="guardia-kicker">Recorrido activo</span>
          <h2>{routeName}</h2>
          <p>{propertyName}</p>
        </div>

        <div className="active-route-status">
          <ShieldCheck size={18} />
          <span>
            {completedSafe}/{totalSafe} puntos
          </span>
        </div>
      </div>

      <div className="active-route-progress">
        <div className="active-route-progress-info">
          <span>Avance del recorrido</span>
          <strong>{porcentaje}%</strong>
        </div>

        <div className="active-route-progress-bar">
          <div style={{ width: `${porcentaje}%` }} />
        </div>
      </div>
    </article>
  );
}