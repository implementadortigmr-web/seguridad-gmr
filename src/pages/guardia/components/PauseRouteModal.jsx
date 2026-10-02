import { PauseCircle, Save, X } from "lucide-react";

export default function PauseRouteModal({
  open,
  motivo,
  comentario,
  saving,
  onChangeMotivo,
  onChangeComentario,
  onClose,
  onSave,
}) {
  if (!open) return null;

  return (
    <div className="capture-modal-overlay">
      <div className="capture-modal incident-modal">
        <div className="capture-modal-header">
          <div>
            <p className="eyebrow">Pausar recorrido</p>
            <h3>Motivo de pausa</h3>
          </div>

          <button type="button" className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="incident-warning-box">
          <PauseCircle size={20} />
          <span>
            Usa esta opción cuando el recorrido se interrumpa temporalmente,
            pero después se vaya a continuar.
          </span>
        </div>

        <label className="field-label">Motivo</label>
        <select
          className="text-input"
          value={motivo}
          onChange={(event) => onChangeMotivo(event.target.value)}
        >
          <option value="proveedor">Atención a proveedor</option>
          <option value="habitacion">Apoyo a habitación</option>
          <option value="emergencia">Emergencia</option>
          <option value="supervisor">Indicación de supervisor</option>
          <option value="otro">Otro</option>
        </select>

        <label className="field-label">Comentario</label>
        <textarea
          className="textarea-input"
          value={comentario}
          onChange={(event) => onChangeComentario(event.target.value)}
          placeholder="Ej. Se pausa recorrido por llegada de proveedor..."
        />

        <div className="capture-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={onSave}
            disabled={saving}
          >
            <Save size={16} />
            {saving ? "Guardando..." : "Pausar recorrido"}
          </button>
        </div>
      </div>
    </div>
  );
}