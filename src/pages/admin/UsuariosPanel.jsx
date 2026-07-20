import { useMemo, useState } from "react";
import { Edit3, Save, X } from "lucide-react";
import CatalogTable from "../../components/CatalogTable";
import { guardarPerfilUsuario } from "../../services/catalogService";

const INITIAL_FORM = {
  uid: "",
  nombre: "",
  correo: "",
  rol: "guardia",
  propiedadesPermitidas: [],
  activo: true,
};

const ROLES = [
  { value: "administrador", label: "Administrador" },
  { value: "supervisor", label: "Supervisor" },
  { value: "guardia", label: "Guardia" },
];

export default function UsuariosPanel({
  userId,
  usuarios,
  propiedades,
  setMessage,
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [editingUserId, setEditingUserId] = useState(null);
  const [saving, setSaving] = useState(false);

  const activeProperties = useMemo(
    () => propiedades.filter((property) => property.activo),
    [propiedades]
  );

  const isEditing = Boolean(editingUserId);
  const hasAllProperties = form.propiedadesPermitidas.includes("*");

  function getPropertyName(propertyId) {
    if (propertyId === "todas" || propertyId === "*") return "Todas";

    const property = propiedades.find((item) => item.id === propertyId);

    return property?.nombre || propertyId || "Sin propiedad";
  }

  function getAllowedPropertiesLabel(allowedProperties = []) {
    if (!Array.isArray(allowedProperties) || allowedProperties.length === 0) {
      return "Sin propiedades";
    }

    if (allowedProperties.includes("*")) {
      return "Todas";
    }

    return allowedProperties.map(getPropertyName).join(", ");
  }

  function resetForm() {
    setForm(INITIAL_FORM);
    setEditingUserId(null);
    setMessage("");
  }

  function normalizeUserForEdit(user) {
    return {
      uid: user.id,
      nombre: user.nombre || "",
      correo: user.correo || "",
      rol: user.rol || "guardia",
      propiedadesPermitidas: Array.isArray(user.propiedadesPermitidas)
        ? user.propiedadesPermitidas
        : [],
      activo: user.activo === true,
    };
  }

  function startEditing(user) {
    setForm(normalizeUserForEdit(user));
    setEditingUserId(user.id);
    setMessage("Editando usuario. El UID queda bloqueado por seguridad.");
  }

  function handleRoleChange(nextRole) {
    if (nextRole === "administrador") {
      setForm((current) => ({
        ...current,
        rol: nextRole,
        propiedadesPermitidas: ["*"],
      }));

      return;
    }

    setForm((current) => ({
      ...current,
      rol: nextRole,
      propiedadesPermitidas: current.propiedadesPermitidas.includes("*")
        ? []
        : current.propiedadesPermitidas,
    }));
  }

  function toggleAllProperties() {
    if (form.rol === "administrador") return;

    setForm((current) => {
      const nextHasAll = !current.propiedadesPermitidas.includes("*");

      if (nextHasAll) {
        return {
          ...current,
          propiedadesPermitidas: ["*"],
        };
      }

      return {
        ...current,
        propiedadesPermitidas: [],
      };
    });
  }

  function toggleAllowedProperty(propertyId) {
    if (form.rol === "administrador") return;

    setForm((current) => {
      const currentAllowed = Array.isArray(current.propiedadesPermitidas)
        ? current.propiedadesPermitidas
        : [];

      const allowedWithoutAll = currentAllowed.filter((id) => id !== "*");
      const alreadySelected = allowedWithoutAll.includes(propertyId);

      const nextAllowed = alreadySelected
        ? allowedWithoutAll.filter((id) => id !== propertyId)
        : [...allowedWithoutAll, propertyId];

      return {
        ...current,
        propiedadesPermitidas: nextAllowed,
      };
    });
  }

  function validateForm() {
    if (!form.uid.trim()) {
      return "Falta el UID de Authentication.";
    }

    if (!form.nombre.trim()) {
      return "Falta el nombre del usuario.";
    }

    if (!form.correo.trim()) {
      return "Falta el correo del usuario.";
    }

    if (form.rol === "administrador") {
      return "";
    }

    if (!form.propiedadesPermitidas.length) {
      return "Selecciona al menos una propiedad permitida o marca todas.";
    }

    return "";
  }

  function getAutomaticMainPropertyId() {
    if (form.rol === "administrador") {
      return "todas";
    }

    if (form.propiedadesPermitidas.includes("*")) {
      return "todas";
    }

    return form.propiedadesPermitidas[0] || "";
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationMessage = validateForm();

    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const propiedadesPermitidas =
        form.rol === "administrador" || form.propiedadesPermitidas.includes("*")
          ? ["*"]
          : form.propiedadesPermitidas;

      const propiedadId =
        form.rol === "administrador" || propiedadesPermitidas.includes("*")
          ? "todas"
          : getAutomaticMainPropertyId();

      await guardarPerfilUsuario({
        uid: form.uid,
        nombre: form.nombre,
        correo: form.correo,
        rol: form.rol,
        propiedadId,
        propiedadesPermitidas,
        activo: form.activo,
        userId,
      });

      setMessage(
        isEditing
          ? "Usuario actualizado correctamente."
          : "Perfil guardado correctamente. Recuerda que la cuenta debe existir en Firebase Authentication."
      );

      resetForm();
    } catch (error) {
      console.error(error);
      setMessage("No fue posible guardar el perfil del usuario.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>Usuarios</h2>

      <p className="muted admin-intro">
        Primero crea la cuenta en Firebase Authentication. Después registra o
        edita aquí su perfil, rol y propiedades permitidas.
      </p>

      <form className="catalog-form wide users-form" onSubmit={handleSubmit}>
        <div>
          <label className="field-label">UID de Authentication</label>
          <input
            className="text-input"
            value={form.uid}
            onChange={(event) =>
              setForm({ ...form, uid: event.target.value })
            }
            placeholder="UID del usuario"
            disabled={isEditing}
            required
          />

          {isEditing && (
            <p className="helper-text">
              El UID no se puede modificar al editar un usuario.
            </p>
          )}
        </div>

        <div>
          <label className="field-label">Nombre</label>
          <input
            className="text-input"
            value={form.nombre}
            onChange={(event) =>
              setForm({ ...form, nombre: event.target.value })
            }
            placeholder="Nombre del usuario"
            required
          />
        </div>

        <div>
          <label className="field-label">Correo</label>
          <input
            className="text-input"
            type="email"
            value={form.correo}
            onChange={(event) =>
              setForm({ ...form, correo: event.target.value })
            }
            placeholder="correo@seguridadgmr.com"
            required
          />
        </div>

        <div>
          <label className="field-label">Rol</label>
          <select
            className="text-input"
            value={form.rol}
            onChange={(event) => handleRoleChange(event.target.value)}
          >
            {ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label">Estado</label>
          <select
            className="text-input"
            value={form.activo ? "activo" : "inactivo"}
            onChange={(event) =>
              setForm({
                ...form,
                activo: event.target.value === "activo",
              })
            }
          >
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </select>
        </div>

        {form.rol !== "administrador" && (
          <div className="form-full">
            <label className="field-label">Propiedades permitidas</label>

            <div className="checkbox-grid">
              <label className="checkbox-card checkbox-card-all">
                <input
                  type="checkbox"
                  checked={hasAllProperties}
                  onChange={toggleAllProperties}
                />

                <span>
                  <strong>Todas las propiedades</strong>
                  <small>Permite acceso a todos los recorridos activos</small>
                </span>
              </label>

              {activeProperties.map((property) => {
                const checked =
                  hasAllProperties ||
                  form.propiedadesPermitidas.includes(property.id);

                return (
                  <label
                    className={`checkbox-card ${
                      hasAllProperties ? "is-disabled" : ""
                    }`}
                    key={property.id}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={hasAllProperties}
                      onChange={() => toggleAllowedProperty(property.id)}
                    />

                    <span>
                      <strong>{property.nombre}</strong>
                      <small>{property.codigo}</small>
                    </span>
                  </label>
                );
              })}
            </div>

            <p className="helper-text">
              Puedes seleccionar una, varias o todas las propiedades. El sistema
              asignará automáticamente la referencia principal.
            </p>
          </div>
        )}

        {form.rol === "administrador" && (
          <div className="form-full info-box">
            El administrador tendrá acceso a todas las propiedades.
          </div>
        )}

        <div className="form-actions">
          <button className="primary-button" disabled={saving}>
            <Save size={17} />
            {isEditing ? "Guardar cambios" : "Guardar perfil"}
          </button>

          {isEditing && (
            <button
              className="secondary-button"
              type="button"
              onClick={resetForm}
            >
              <X size={17} />
              Cancelar
            </button>
          )}
        </div>
      </form>

      <CatalogTable
        columns={[
          "Nombre",
          "Correo",
          "Rol",
          "Permitidas",
          "Estado",
          "Acción",
        ]}
        rows={usuarios.map((user) => [
          user.nombre,
          user.correo,
          user.rol,
          getAllowedPropertiesLabel(user.propiedadesPermitidas),
          user.activo ? "Activo" : "Inactivo",
          <button
            className="mini-button"
            type="button"
            onClick={() => startEditing(user)}
          >
            <Edit3 size={14} />
            Editar
          </button>,
        ])}
      />
    </section>
  );
}