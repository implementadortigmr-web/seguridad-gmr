export default function ProgressBar({ completed, total }) {
  const percentage = total ? Math.round((completed / total) * 100) : 0;

  return (
    <>
      <div className="progress-info">
        <strong>
          {completed} de {total} puntos
        </strong>
        <span>{percentage}% completado</span>
      </div>

      <div className="progress-track">
        <div className="progress-value" style={{ width: `${percentage}%` }} />
      </div>
    </>
  );
}
