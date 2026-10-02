import { useEffect, useRef, useState } from "react";
import { Camera, Save, Trash2, X } from "lucide-react";
import MessageBox from "../../../components/MessageBox";

function getFechaHoraActual() {
  const ahora = new Date();

  return {
    fecha: ahora.toLocaleDateString("es-MX", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    hora: ahora.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function SignaturePad({ label, value, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.strokeStyle = "#111827";

    context.clearRect(0, 0, canvas.width, canvas.height);

    if (value) {
      const image = new Image();
      image.onload = () => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      };
      image.src = value;
    }
  }, [value]);

  function getPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(event) {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const point = getPoint(event);

    drawingRef.current = true;
    canvas.setPointerCapture?.(event.pointerId);

    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function handlePointerMove(event) {
    if (!drawingRef.current) return;

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const point = getPoint(event);

    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function finishDrawing(event) {
    if (!drawingRef.current) return;

    const canvas = canvasRef.current;
    drawingRef.current = false;
    canvas.releasePointerCapture?.(event.pointerId);

    onChange?.(canvas.toDataURL("image/png"));
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    context.clearRect(0, 0, canvas.width, canvas.height);
    onChange?.("");
  }

  return (
    <div className="signature-box">
      <div className="signature-header">
        <strong>{label}</strong>

        <button type="button" className="mini-clear-button" onClick={clearSignature}>
          Limpiar
        </button>
      </div>

      <canvas
        ref={canvasRef}
        width={700}
        height={240}
        className="signature-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrawing}
        onPointerCancel={finishDrawing}
      />

      <span className="signature-help">Firma dentro del recuadro.</span>
    </div>
  );
}

function emptyProveedorForm() {
  return {
    nombreProveedor: "",
    compania: "",
    personaQueVisita: "",
    motivo: "",
  };
}

function emptyHechosForm(guardiaNombre = "") {
  return {
    nombreGuardiaReporta: guardiaNombre,
    tipoIncidente: "",
    descripcionHechos: "",
    accionRealizadaSeguridad: "",
    comentariosInvolucrados: "",
    nombreResponsableTestigo: "",
  };
}

export default function IncidentModal({
  open,
  tipo,
  context,
  guardiaNombre = "",
  saving,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState(emptyProveedorForm());
  const [photos, setPhotos] = useState([]);
  const [firmaProveedor, setFirmaProveedor] = useState("");
  const [firmaGuardia, setFirmaGuardia] = useState("");
  const [firmaResponsable, setFirmaResponsable] = useState("");
  const [error, setError] = useState("");

  const { fecha, hora } = getFechaHoraActual();

  const isProveedor = tipo === "proveedor";
  const isHechos = tipo === "hechos_relevantes";

  useEffect(() => {
    if (!open) return;

    setError("");
    setPhotos([]);
    setFirmaProveedor("");
    setFirmaGuardia("");
    setFirmaResponsable("");

    if (tipo === "hechos_relevantes") {
      setForm(emptyHechosForm(guardiaNombre));
    } else {
      setForm(emptyProveedorForm());
    }
  }, [open, tipo, guardiaNombre]);

  if (!open) return null;

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleAddPhotos(event) {
    const selected = Array.from(event.target.files || []).filter((file) =>
      file.type?.startsWith("image/")
    );

    if (!selected.length) return;

    const maxFotos = isProveedor ? 3 : 2;

    setPhotos((current) => {
      const merged = [...current, ...selected];
      return merged.slice(0, maxFotos);
    });

    event.target.value = "";
  }

  function removePhoto(indexToRemove) {
    setPhotos((current) =>
      current.filter((_, index) => index !== indexToRemove)
    );
  }

  function validateProveedor() {
    if (!form.nombreProveedor.trim()) return "Ingresa el nombre del proveedor.";
    if (!form.compania.trim()) return "Ingresa la compañía.";
    if (!form.personaQueVisita.trim()) return "Ingresa la persona que visita.";
    if (!form.motivo.trim()) return "Ingresa el motivo.";
    if (!firmaProveedor) return "La firma del proveedor es obligatoria.";
    if (photos.length < 2) return "Agrega mínimo 2 fotografías.";
    if (photos.length > 3) return "Solo se permiten máximo 3 fotografías.";

    return "";
  }

  function validateHechos() {
    if (!form.nombreGuardiaReporta.trim()) {
      return "Ingresa el nombre del guardia que reporta.";
    }

    if (!firmaGuardia) return "La firma del guardia es obligatoria.";
    if (!form.tipoIncidente.trim()) return "Ingresa el tipo de incidente.";
    if (!form.descripcionHechos.trim()) {
      return "Ingresa la descripción de los hechos.";
    }

    if (!form.accionRealizadaSeguridad.trim()) {
      return "Ingresa la acción realizada por seguridad.";
    }

    if (!form.nombreResponsableTestigo.trim()) {
      return "Ingresa el nombre del responsable o testigo.";
    }

    if (!firmaResponsable) {
      return "La firma del responsable o testigo es obligatoria.";
    }

    if (photos.length !== 2) return "Agrega exactamente 2 fotografías.";

    return "";
  }

  function handleSave() {
    const validationError = isProveedor
      ? validateProveedor()
      : validateHechos();

    if (validationError) {
      setError(validationError);
      return;
    }

    const payload = {
      tipo,
      tipoNombre: isProveedor ? "Proveedor" : "Informe de hechos relevantes",
      propiedadId: context?.propiedadId || "",
      propiedadNombre: context?.propiedadNombre || "",
      fecha,
      hora,
      campos: form,
      fotos: photos,
      firmas: {
        proveedor: firmaProveedor,
        guardia: firmaGuardia,
        responsableTestigo: firmaResponsable,
      },
      descripcion: isProveedor
        ? `${form.compania} - ${form.motivo}`
        : form.descripcionHechos,
    };

    onSave?.(payload);
  }

  return (
    <div className="capture-modal-overlay">
      <div className="capture-modal incident-modal incident-form-modal">
        <div className="capture-modal-header">
          <div>
            <p className="eyebrow">
              {context?.propiedadNombre || "Incidencia"}
            </p>
            <h3>{isProveedor ? "Registro de proveedor" : "Hechos relevantes"}</h3>
          </div>

          <button type="button" className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {error && <MessageBox type="error">{error}</MessageBox>}

        <div className="incident-date-grid">
          <div>
            <span>Fecha</span>
            <strong>{fecha}</strong>
          </div>

          <div>
            <span>Hora</span>
            <strong>{hora}</strong>
          </div>
        </div>

        {isProveedor && (
          <>
            <label className="field-label">Nombre proveedor</label>
            <input
              className="text-input"
              value={form.nombreProveedor}
              onChange={(event) =>
                updateField("nombreProveedor", event.target.value)
              }
              placeholder="Nombre completo del proveedor"
            />

            <label className="field-label">Compañía</label>
            <input
              className="text-input"
              value={form.compania}
              onChange={(event) => updateField("compania", event.target.value)}
              placeholder="Ej. Coca Cola, lavandería, mantenimiento..."
            />

            <label className="field-label">Persona que visita</label>
            <input
              className="text-input"
              value={form.personaQueVisita}
              onChange={(event) =>
                updateField("personaQueVisita", event.target.value)
              }
              placeholder="Nombre o área que visita"
            />

            <label className="field-label">Motivo</label>
            <textarea
              className="textarea-input"
              value={form.motivo}
              onChange={(event) => updateField("motivo", event.target.value)}
              placeholder="Motivo de visita o entrega"
            />

            <SignaturePad
              label="Firma proveedor"
              value={firmaProveedor}
              onChange={setFirmaProveedor}
            />
          </>
        )}

        {isHechos && (
          <>
            <label className="field-label">Nombre de guardia que reporta</label>
            <input
              className="text-input"
              value={form.nombreGuardiaReporta}
              onChange={(event) =>
                updateField("nombreGuardiaReporta", event.target.value)
              }
              placeholder="Nombre del guardia"
            />

            <SignaturePad
              label="Firma guardia"
              value={firmaGuardia}
              onChange={setFirmaGuardia}
            />

            <label className="field-label">Tipo de incidente</label>
            <input
              className="text-input"
              value={form.tipoIncidente}
              onChange={(event) =>
                updateField("tipoIncidente", event.target.value)
              }
              placeholder="Libre: robo, daño, discusión, apoyo, emergencia..."
            />

            <label className="field-label">Descripción de los hechos</label>
            <textarea
              className="textarea-input"
              value={form.descripcionHechos}
              onChange={(event) =>
                updateField("descripcionHechos", event.target.value)
              }
              placeholder="Describe los hechos de forma clara..."
            />

            <label className="field-label">Acción realizada por seguridad</label>
            <textarea
              className="textarea-input"
              value={form.accionRealizadaSeguridad}
              onChange={(event) =>
                updateField("accionRealizadaSeguridad", event.target.value)
              }
              placeholder="Ej. Se reporta a supervisor, se acompaña al área..."
            />

            <label className="field-label">Comentarios de los involucrados</label>
            <textarea
              className="textarea-input"
              value={form.comentariosInvolucrados}
              onChange={(event) =>
                updateField("comentariosInvolucrados", event.target.value)
              }
              placeholder="Comentarios de huéspedes, colaboradores o testigos"
            />

            <label className="field-label">Nombre responsable o testigo</label>
            <input
              className="text-input"
              value={form.nombreResponsableTestigo}
              onChange={(event) =>
                updateField("nombreResponsableTestigo", event.target.value)
              }
              placeholder="Nombre completo"
            />

            <SignaturePad
              label="Firma responsable o testigo"
              value={firmaResponsable}
              onChange={setFirmaResponsable}
            />
          </>
        )}

        <label className="field-label">
          Fotografías {isProveedor ? "(mínimo 2, máximo 3)" : "(exactamente 2)"}
        </label>

        <label className="incident-photo-picker">
          <Camera size={20} />
          Agregar fotografía
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={handleAddPhotos}
            hidden
          />
        </label>

        {photos.length > 0 && (
          <div className="incident-photo-list">
            {photos.map((photo, index) => (
              <div className="incident-photo-item" key={`${photo.name}_${index}`}>
                <span>
                  Foto {index + 1}: {photo.name || "imagen.jpg"}
                </span>

                <button
                  type="button"
                  className="mini-clear-button"
                  onClick={() => removePhoto(index)}
                >
                  <Trash2 size={14} />
                  Quitar
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="capture-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={handleSave}
            disabled={saving}
          >
            <Save size={16} />
            {saving ? "Guardando..." : "Guardar incidencia"}
          </button>
        </div>
      </div>
    </div>
  );
}