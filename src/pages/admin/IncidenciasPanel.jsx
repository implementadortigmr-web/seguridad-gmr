import { useState } from "react";
import { Plus } from "lucide-react";
import CatalogTable from "../../components/CatalogTable";
import { cambiarActivo, crearTipoIncidencia } from "../../services/catalogService";

const INITIAL_FORM = { nombre: "", prioridadDefault: "media" };

export default function IncidenciasPanel({ userId, tiposIncidencia, setMessage }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await crearTipoIncidencia({ ...form, userId });
      setForm(INITIAL_FORM);
      setMessage("Tipo de incidencia guardado correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No fue posible guardar el tipo de incidencia.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(type) {
    try {
      await cambiarActivo({
        collectionName: "tiposIncidencia",
        id: type.id,
        activoActual: type.activo,
        userId,
      });
      setMessage("Estado actualizado correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No fue posible actualizar el estado.");
    }
  }

  return (
    <section>
      <h2>Tipos de incidencias</h2>
      <p className="muted admin-intro">
        Define las incidencias que el guardia podrá reportar durante sus recorridos.
      </p>

      <form className="catalog-form" onSubmit={handleSubmit}>
        <div>
          <label className="field-label">Nombre</label>
          <input
            className="text-input"
            value={form.nombre}
            onChange={(event) => setForm({ ...form, nombre: event.target.value })}
            placeholder="Puerta abierta"
            required
          />
        </div>

        <div>
          <label className="field-label">Prioridad</label>
          <select
            className="text-input"
            value={form.prioridadDefault}
            onChange={(event) => setForm({ ...form, prioridadDefault: event.target.value })}
          >
            <option value="baja">Baja</option>
            <option value="media">Media</option>
            <option value="alta">Alta</option>
          </select>
        </div>

        <button className="primary-button" disabled={saving}>
          <Plus size={17} />
          Guardar incidencia
        </button>
      </form>

      <CatalogTable
        columns={["Incidencia", "Prioridad", "Estado", "Acción"]}
        rows={tiposIncidencia.map((type) => [
          type.nombre,
          type.prioridadDefault,
          type.activo ? "Activo" : "Inactivo",
          <button className="mini-button" onClick={() => toggleActive(type)}>
            {type.activo ? "Desactivar" : "Activar"}
          </button>,
        ])}
      />
    </section>
  );
}
