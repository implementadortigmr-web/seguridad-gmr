import { useState } from "react";
import { Save } from "lucide-react";
import CatalogTable from "../../components/CatalogTable";
import { cambiarActivo, crearPropiedad } from "../../services/catalogService";

const INITIAL_FORM = { codigo: "", nombre: "" };

export default function PropiedadesPanel({ userId, propiedades, setMessage }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await crearPropiedad({ ...form, userId });
      setForm(INITIAL_FORM);
      setMessage("Propiedad guardada correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No fue posible guardar la propiedad. Revisa las reglas de Firestore.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(property) {
    try {
      await cambiarActivo({
        collectionName: "propiedades",
        id: property.id,
        activoActual: property.activo,
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
      <h2>Propiedades</h2>
      <p className="muted admin-intro">Registra las propiedades donde se realizarán los recorridos.</p>

      <form className="catalog-form" onSubmit={handleSubmit}>
        <div>
          <label className="field-label">Código</label>
          <input
            className="text-input"
            value={form.codigo}
            onChange={(event) => setForm({ ...form, codigo: event.target.value })}
            placeholder="hrm"
            required
          />
        </div>

        <div>
          <label className="field-label">Nombre</label>
          <input
            className="text-input"
            value={form.nombre}
            onChange={(event) => setForm({ ...form, nombre: event.target.value })}
            placeholder="Hotel Real de Minas"
            required
          />
        </div>

        <button className="primary-button" disabled={saving}>
          <Save size={17} />
          Guardar propiedad
        </button>
      </form>

      <CatalogTable
        columns={["Nombre", "Código", "Estado", "Acción"]}
        rows={propiedades.map((property) => [
          property.nombre,
          property.codigo,
          property.activo ? "Activo" : "Inactivo",
          <button className="mini-button" onClick={() => toggleActive(property)}>
            {property.activo ? "Desactivar" : "Activar"}
          </button>,
        ])}
      />
    </section>
  );
}
