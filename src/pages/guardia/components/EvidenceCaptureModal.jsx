import { Camera, CheckCircle2, ImageOff, RotateCcw, Save, X } from "lucide-react";
import { isNativeApp } from "../../../services/nativeCaptureService";

export default function EvidenceCaptureModal({
  point,
  comment,
  photoPreview,
  hasPhoto,
  saving,
  onChangeComment,
  onClose,
  onNativePhoto,
  onWebPhoto,
  onClearPhoto,
  onSave,
}) {
  if (!point) return null;

  const commentIsEmpty = !comment.trim();
  const canSave = hasPhoto && !commentIsEmpty && !saving;

  return (
    <div className="capture-modal-overlay">
      <div className="capture-modal evidence-flow-modal">
        <div className="capture-modal-header">
          <div>
            <p className="eyebrow">Evidencia del punto</p>
            <h3>{point.nombre}</h3>
          </div>

          <button type="button" onClick={onClose} disabled={saving}>
            <X size={18} />
          </button>
        </div>

        <div className="evidence-step-box">
          <div className="evidence-step-title">
            <span>1</span>
            <strong>Fotografía obligatoria</strong>
          </div>

          {hasPhoto ? (
            <div className="loaded-photo-box">
              {photoPreview ? (
                <img src={photoPreview} alt={`Evidencia ${point.nombre}`} />
              ) : (
                <div className="photo-loaded-placeholder">
                  <CheckCircle2 size={26} />
                  Foto cargada correctamente
                </div>
              )}

              <div className="photo-loaded-status">
                <CheckCircle2 size={17} />
                <span>Foto cargada</span>
              </div>

              <button
                type="button"
                className="secondary-button retake-photo-button"
                onClick={onClearPhoto}
                disabled={saving}
              >
                <RotateCcw size={16} />
                Tomar otra foto
              </button>
            </div>
          ) : (
            <div className="empty-photo-box">
              <ImageOff size={34} />
              <strong>Sin foto cargada</strong>
              <span>Primero toma o selecciona la foto del punto.</span>

              {isNativeApp() ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={onNativePhoto}
                  disabled={saving}
                >
                  <Camera size={17} />
                  Tomar foto
                </button>
              ) : (
                <label className="primary-button file-primary-button">
                  <Camera size={17} />
                  Seleccionar foto

                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={saving}
                    onChange={(event) => {
                      const file = event.target.files?.[0];

                      if (file) {
                        onWebPhoto(file);
                      }

                      event.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          )}
        </div>

        <div className="evidence-step-box">
          <div className="evidence-step-title">
            <span>2</span>
            <strong>Comentario obligatorio</strong>
          </div>

          <textarea
            className="textarea-input"
            rows={4}
            value={comment}
            onChange={(event) => onChangeComment(event.target.value)}
            placeholder="Ejemplo: área revisada sin novedad, puerta cerrada, pasillo despejado..."
            disabled={saving}
          />

          <p className="helper-text">
            La evidencia se guardará con foto, comentario, hora y ubicación.
          </p>
        </div>

        <div className="capture-modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={onSave}
            disabled={!canSave}
          >
            <Save size={17} />
            {saving ? "Guardando..." : "Guardar evidencia"}
          </button>
        </div>
      </div>
    </div>
  );
}