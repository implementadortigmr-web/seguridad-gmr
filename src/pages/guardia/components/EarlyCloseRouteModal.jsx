import { AlertTriangle, Camera, Save, X } from "lucide-react";

const MOTIVOS_CIERRE = [
  { value: "comida", label: "Salida a comer" },
  { value: "proveedor", label: "Llegó proveedor" },
  { value: "fin_turno", label: "Terminó turno" },
  { value: "emergencia", label: "Emergencia" },
  { value: "operacion", label: "Apoyo a operación" },
  { value: "supervisor", label: "Indicación de supervisor" },
  { value: "otro", label: "Otro" },
];

export default function EarlyCloseRouteModal({
  open,
  motivo,
  comentario,
  photoPreview,
  hasPhoto,
  saving,
  completed,
  missing,
  total,
  onChangeMotivo,
  onChangeComentario,
  onPhotoChange,
  onClearPhoto,
  onClose,
  onSave,
}) {
  if (!open) return null;

  return (
    <div className="capture-modal-overlay">
      <div className="capture-modal incident-modal">
        <div className="capture-modal-header">
          <div>
            <p className="eyebrow">Cerrar recorrido</p>
            <h3>Terminar antes</h3>
          </div>

          <button type="button" className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="early-close-warning">
          <AlertTriangle size={20} />
          <span>
            El recorrido quedará como cerrado incompleto. Debes dejar motivo,
            comentario y fotografía como evidencia.
          </span>
        </div>

        <div className="early-close-summary">
          <strong>
            {completed}/{total} puntos completados
          </strong>
          <span>{missing} punto(s) pendiente(s)</span>
        </div>

        <label className="field-label">Motivo</label>
        <select
          className="text-input"
          value={motivo}
          onChange={(event) => onChangeMotivo(event.target.value)}
        >
          {MOTIVOS_CIERRE.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>

        <label className="field-label">Comentario</label>
        <textarea
          className="textarea-input"
          value={comentario}
          onChange={(event) => onChangeComentario(event.target.value)}
          placeholder="Ej. Se termina antes el recorrido porque llegó proveedor y se requiere apoyo en acceso..."
        />

        <label className="field-label">Fotografía obligatoria</label>

        {photoPreview ? (
          <div className="early-close-photo-preview">
            <img src={photoPreview} alt="Evidencia de cierre anticipado" />

            <button
              type="button"
              className="secondary-button"
              onClick={onClearPhoto}
            >
              Quitar foto
            </button>
          </div>
        ) : (
          <label className="early-close-photo-button">
            <Camera size={20} />
            Tomar foto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPhotoChange}
              hidden
            />
          </label>
        )}

        <div className="capture-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>

          <button
            type="button"
            className="danger-button"
            onClick={onSave}
            disabled={saving || !hasPhoto}
          >
            <Save size={16} />
            {saving ? "Cerrando..." : "Terminar antes"}
          </button>
        </div>
      </div>
    </div>
  );
}