import { useState } from "react";
import { Plus } from "lucide-react";
import CatalogTable from "../../components/CatalogTable";
import { cambiarActivo, crearRol } from "../../services/catalogService";

const INITIAL_FORM = { nombre: "", descripcion: "" };

export default function RolesPanel({ userId, roles, setMessage }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await crearRol({ ...form, userId });
      setForm(INITIAL_FORM);
      setMessage("Rol guardado correctamente.");
    } catch (error) {
      console.error(error);
      setMessage("No fue posible guardar el rol.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(role) {
    try {
      await cambiarActivo({
        collectionName: "roles",
        id: role.id,
        activoActual: role.activo,
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
      <h2>Roles</h2>
      <p className="muted admin-intro">
        Catálogo informativo de perfiles. Los permisos reales se controlan por reglas y módulos del sistema.
      </p>

      <form className="catalog-form" onSubmit={handleSubmit}>
        <div>
          <label className="field-label">Nombre del rol</label>
          <input
            className="text-input"
            value={form.nombre}
            onChange={(event) => setForm({ ...form, nombre: event.target.value })}
            placeholder="Administrador"
            required
          />
        </div>

        <div>
          <label className="field-label">Descripción</label>
          <input
            className="text-input"
            value={form.descripcion}
            onChange={(event) => setForm({ ...form, descripcion: event.target.value })}
            placeholder="Acceso total al sistema"
          />
        </div>

        <button className="primary-button" disabled={saving}>
          <Plus size={17} />
          Guardar rol
        </button>
      </form>

      <CatalogTable
        columns={["Rol", "Descripción", "Estado", "Acción"]}
        rows={roles.map((role) => [
          role.nombre,
          role.descripcion || "Sin descripción",
          role.activo ? "Activo" : "Inactivo",
          <button className="mini-button" onClick={() => toggleActive(role)}>
            {role.activo ? "Desactivar" : "Activar"}
          </button>,
        ])}
      />
    </section>
  );
}
