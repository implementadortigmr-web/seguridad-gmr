import { useMemo, useState } from "react";
import { ClipboardList, Save } from "lucide-react";
import CatalogTable from "../../components/CatalogTable";
import { crearAsignacionRecorrido, cambiarActivo } from "../../services/catalogService";

const INITIAL_FORM = {
  plantillaId: "",
  guardiaId: "",
  fechaProgramada: "",
};

function formatDateForTable(value) {
  if (!value) return "Sin fecha";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export default function AsignacionesPanel({
  userId,
  usuarios,
  plantillas,
  propiedades,
  asignaciones,
  setMessage,
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  const guardias = useMemo(() => {
    return usuarios
      .filter((usuario) => usuario.activo && usuario.rol === "guardia")
      .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  }, [usuarios]);

  const plantillasActivas = useMemo(() => {
    return plantillas
      .filter((plantilla) => plantilla.activo)
      .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  }, [plantillas]);

  function getPropertyName(propertyId) {
    const property = propiedades.find((item) => item.id === propertyId);
    return property?.nombre || propertyId || "Sin propiedad";
  }

  function getTemplateName(templateId) {
    const template = plantillas.find((item) => item.id === templateId);
    return template?.nombre || templateId || "Sin plantilla";
  }

  function getGuardName(guardId) {
    const guard = usuarios.find((item) => item.id === guardId);
    return guard?.nombre || guardId || "Sin guardia";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    const plantilla = plantillas.find((item) => item.id === form.plantillaId);
    const guardia = usuarios.find((item) => item.id === form.guardiaId);

    if (!plantilla || !guardia) {
      setMessage("Selecciona una plantilla y un guardia válidos.");
      setSaving(false);
      return;
    }

    try {
      await crearAsignacionRecorrido({
        plantilla,
        guardia,
        fechaProgramada: form.fechaProgramada,
        userId,
      });

      setForm(INITIAL_FORM);
      setMessage("Recorrido asignado correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No fue posible asignar el recorrido. Revisa reglas de Firestore.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAssignment(id, activoActual) {
    try {
      await cambiarActivo({
        collectionName: "asignacionesRecorridos",
        id,
        activoActual,
        userId,
      });
      setMessage("Asignación actualizada correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No fue posible actualizar la asignación.");
    }
  }

  return (
    <section>
      <h2>Asignaciones de recorridos</h2>
      <p className="muted admin-intro">
        Asigna una plantilla de recorrido a un guardia y fecha. La app copia los puntos de la plantilla para que el recorrido quede fijo aunque después se edite la plantilla.
      </p>

      <form className="catalog-form wide" onSubmit={handleSubmit}>
        <div>
          <label className="field-label">Plantilla de recorrido</label>
          <select
            className="text-input"
            value={form.plantillaId}
            onChange={(event) => setForm({ ...form, plantillaId: event.target.value })}
            required
          >
            <option value="">Selecciona un recorrido</option>
            {plantillasActivas.map((plantilla) => (
              <option key={plantilla.id} value={plantilla.id}>
                {plantilla.nombre} · {getPropertyName(plantilla.propiedadId)} · {plantilla.totalPuntos} puntos
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label">Guardia</label>
          <select
            className="text-input"
            value={form.guardiaId}
            onChange={(event) => setForm({ ...form, guardiaId: event.target.value })}
            required
          >
            <option value="">Selecciona un guardia</option>
            {guardias.map((guardia) => (
              <option key={guardia.id} value={guardia.id}>
                {guardia.nombre} · {getPropertyName(guardia.propiedadId)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label">Fecha programada</label>
          <input
            className="text-input"
            type="date"
            value={form.fechaProgramada}
            onChange={(event) => setForm({ ...form, fechaProgramada: event.target.value })}
            required
          />
        </div>

        <button className="primary-button" disabled={saving}>
          <Save size={17} />
          Asignar recorrido
        </button>
      </form>

      <CatalogTable
        columns={["Fecha", "Recorrido", "Guardia", "Propiedad", "Estado", "Acción"]}
        rows={asignaciones.map((asignacion) => [
          formatDateForTable(asignacion.fechaProgramada),
          asignacion.plantillaNombre || getTemplateName(asignacion.plantillaId),
          asignacion.guardiaNombre || getGuardName(asignacion.guardiaId),
          asignacion.propiedadNombre || getPropertyName(asignacion.propiedadId),
          asignacion.activo ? asignacion.estado || "asignado" : "Inactiva",
          <button
            className="mini-button"
            onClick={() => toggleAssignment(asignacion.id, asignacion.activo)}
          >
            {asignacion.activo ? "Desactivar" : "Activar"}
          </button>,
        ])}
      />

      {plantillasActivas.length === 0 && (
        <div className="local-warning assignment-warning">
          Primero crea al menos una plantilla activa en la pestaña Recorridos.
        </div>
      )}

      {guardias.length === 0 && (
        <div className="local-warning assignment-warning">
          Primero registra al menos un usuario con rol Guardia.
        </div>
      )}
    </section>
  );
}
