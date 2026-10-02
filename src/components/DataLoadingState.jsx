import { LoaderCircle } from 'lucide-react';

export default function DataLoadingState({
  title = 'Cargando información...',
  detail = 'Estamos consultando los datos. Esto puede tardar unos segundos.',
  compact = false,
}) {
  return (
    <div
      className={`data-loading-state ${compact ? 'compact' : ''}`}
      role="status"
      aria-live="polite"
    >
      <LoaderCircle className="spinner" size={compact ? 22 : 30} />
      <div>
        <strong>{title}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
    </div>
  );
}
