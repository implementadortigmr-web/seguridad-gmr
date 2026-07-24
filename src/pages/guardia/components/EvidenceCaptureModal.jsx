import { Camera as CameraIcon, ImageOff, Save, X } from "lucide-react";
import {
  Camera,
  CameraResultType,
  CameraSource,
} from "@capacitor/camera";

export default function EvidenceCaptureModal({
  point,
  comment,
  photoPreview,
  hasPhoto,
  saving,
  onChangeComment,
  onClose,
  onNativePhoto,
  onClearPhoto,
  onSave,
}) {
  if (!point) return null;

  async function handleTakePhoto() {
    if (saving) return;

    try {
      try {
        await Camera.requestPermissions({
          permissions: ["camera"],
        });
      } catch (permissionError) {
        console.warn("Permiso de cámara:", permissionError);
      }

      const photo = await Camera.getPhoto({
        quality: 65,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        saveToGallery: false,
        correctOrientation: true,
        width: 1200,
        height: 1200,
      });

      if (typeof onNativePhoto === "function") {
        await onNativePhoto(photo);
      }
    } catch (error) {
      console.error("Error abriendo cámara:", error);

      if (
        String(error?.message || "")
          .toLowerCase()
          .includes("cancel")
      ) {
        return;
      }

      alert(
        "No fue posible abrir la cámara. Revisa que la app tenga permiso de cámara en el teléfono."
      );
    }
  }

  return (
    <div className="capture-modal-overlay">
      <div className="capture-modal evidence-flow-modal">
        <div className="capture-modal-header">
          <div>
            <span className="guardia-kicker">Evidencia del punto</span>
            <h3>{point?.nombre || point?.puntoNombre || "Punto"}</h3>
          </div>

          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </div>

        <div className="evidence-step-box">
          <div className="evidence-step-title">
            <span>1</span>
            <strong>Fotografía obligatoria</strong>
          </div>

          <div className="loaded-photo-box">
            {hasPhoto && photoPreview ? (
              <>
                <img src={photoPreview} alt="Evidencia del punto" />

                <button
                  type="button"
                  className="secondary-button"
                  onClick={onClearPhoto}
                  disabled={saving}
                >
                  Quitar foto
                </button>
              </>
            ) : (
              <div className="photo-placeholder-box">
                <ImageOff size={38} />

                <strong>Sin foto cargada</strong>

                <p>Primero toma o selecciona la foto del punto.</p>

                <button
                  type="button"
                  className="primary-button"
                  onClick={handleTakePhoto}
                  disabled={saving}
                >
                  <CameraIcon size={16} />
                  Tomar foto
                </button>

               
              </div>
            )}
          </div>

          {hasPhoto && (
            <button
              type="button"
              className="primary-button"
              onClick={handleTakePhoto}
              disabled={saving}
            >
              <CameraIcon size={16} />
              Tomar otra foto
            </button>
          )}
        </div>

        <div className="evidence-step-box">
          <div className="evidence-step-title">
            <span>2</span>
            <strong>Comentario obligatorio</strong>
          </div>

          <textarea
            className="textarea-input"
            value={comment}
            onChange={(event) => onChangeComment(event.target.value)}
            placeholder="Describe brevemente la revisión del punto..."
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
            disabled={saving || !hasPhoto || !comment?.trim()}
          >
            <Save size={16} />
            {saving ? "Guardando..." : "Guardar evidencia"}
          </button>
        </div>
      </div>
    </div>
  );
}