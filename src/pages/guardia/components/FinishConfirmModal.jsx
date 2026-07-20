import { ClipboardCheck } from "lucide-react";

export default function FinishConfirmModal({
  open,
  completed,
  missing,
  saving,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  return (
    <div className="finish-confirm-overlay">
      <div className="finish-confirm-modal">
        <div className="finish-confirm-icon">
          <ClipboardCheck size={30} />
        </div>

        <h3>¿Finalizar recorrido?</h3>

        <p>
          Se cerrará el recorrido. Si hay internet, se subirán las fotos y el reporte.
          Si no hay conexión, quedará pendiente por sincronizar.
        </p>

        <div className="finish-confirm-summary">
          <span>
            <strong>{completed}</strong> puntos completados
          </span>

          <span>
            <strong>{missing}</strong> pendientes
          </span>
        </div>

        <div className="finish-confirm-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </button>

      <button
          type="button"
          className="primary-button"
          onClick={onConfirm}
          disabled={saving}
        >
          {saving ? "Finalizando..." : "Sí, finalizar"}
        </button>
        </div>
      </div>
    </div>
  );
}