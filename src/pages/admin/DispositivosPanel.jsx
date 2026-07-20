import { useEffect, useState } from "react";
import { Save, Smartphone, X } from "lucide-react";
import CatalogTable from "../../components/CatalogTable";
import { guardarDispositivo } from "../../services/catalogService";
import { obtenerDeviceId } from "../../services/deviceService";

const INITIAL_FORM = {
  deviceId: "",
  nombre: "",
  propiedadesPermitidas: [],
  activo: true,
  notas: "",
};

export default function DispositivosPanel({
  userId,
  dispositivos,
  propiedades,
  setMessage,
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [editingDeviceId, setEditingDeviceId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState("");

  const activeProperties = propiedades.filter((propiedad) => propiedad.activo);
  const isEditing = Boolean(editingDeviceId);
  const hasAllProperties = form.propiedadesPermitidas.includes("*");

  useEffect(() => {
    async function loadDeviceId() {
      try {
        const id = await obtenerDeviceId();
        setCurrentDeviceId(id);
      } catch (error) {
        console.error(error);
      }
    }

    loadDeviceId();
  }, []);

  function getPropertyName(propertyId) {
    if (propertyId === "*" || propertyId === "todas") return "Todas";

    const property = propiedades.find((item) => item.id === propertyId);
    return property?.nombre || propertyId || "Sin propiedad";
  }

  function getAllowedLabel(allowed = []) {
    if (!Array.isArray(allowed) || !allowed.length) return "Sin propiedades";
    if (allowed.includes("*")) return "Todas";

    return allowed.map(getPropertyName).join(", ");
  }

  function resetForm() {
    setForm(INITIAL_FORM);
    setEditingDeviceId(null);
    setMessage("");
  }

  function startEditing(device) {
    setForm({
      deviceId: device.id,
      nombre: device.nombre || "",
      propiedadesPermitidas: Array.isArray(device.propiedadesPermitidas)
        ? device.propiedadesPermitidas
        : [],
      activo: device.activo === true,
      notas: device.notas || "",
    });

    setEditingDeviceId(device.id);
    setMessage("Editando dispositivo. El ID queda bloqueado.");
  }

  function useCurrentDeviceId() {
    setForm((current) => ({
      ...current,
      deviceId: currentDeviceId,
    }));
  }

  function toggleAllProperties() {
    setForm((current) => {
      if (current.propiedadesPermitidas.includes("*")) {
        return {
          ...current,
          propiedadesPermitidas: [],
        };
      }

      return {
        ...current,
        propiedadesPermitidas: ["*"],
      };
    });
  }

  function toggleProperty(propertyId) {
    setForm((current) => {
      const withoutAll = current.propiedadesPermitidas.filter(
        (item) => item !== "*"
      );

      const exists = withoutAll.includes(propertyId);

      const next = exists
        ? withoutAll.filter((item) => item !== propertyId)
        : [...withoutAll, propertyId];

      return {
        ...current,
        propiedadesPermitidas: next,
      };
    });
  }

  function validateForm() {
    if (!form.deviceId.trim()) return "Falta el ID del dispositivo.";
    if (!form.nombre.trim()) return "Falta el nombre del dispositivo.";

    if (!form.propiedadesPermitidas.length) {
      return "Selecciona al menos una propiedad para el dispositivo.";
    }

    return "";
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const error = validateForm();

    if (error) {
      setMessage(error);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await guardarDispositivo({
        deviceId: form.deviceId,
        nombre: form.nombre,
        propiedadesPermitidas: form.propiedadesPermitidas.includes("*")
          ? ["*"]
          : form.propiedadesPermitidas,
        activo: form.activo,
        notas: form.notas,
        userId,
      });

      setMessage(
        isEditing
          ? "Dispositivo actualizado correctamente."
          : "Dispositivo registrado correctamente."
      );

      resetForm();
    } catch (error) {
      console.error(error);
      setMessage("No fue posible guardar el dispositivo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>Dispositivos</h2>

      <p className="muted admin-intro">
        Registra los celulares autorizados y asígnalos a una o varias
        propiedades. El guardia solo verá recorridos donde coincidan sus permisos
        y los permisos del celular.
      </p>

      {currentDeviceId && (
        <div className="info-box device-id-box">
          <strong>ID de este dispositivo:</strong>
          <span>{currentDeviceId}</span>
        </div>
      )}

      <form className="catalog-form wide users-form" onSubmit={handleSubmit}>
        <div>
          <label className="field-label">ID del dispositivo</label>
          <input
            className="text-input"
            value={form.deviceId}
            onChange={(event) =>
              setForm({ ...form, deviceId: event.target.value })
            }
            placeholder="ID generado por la app"
            disabled={isEditing}
            required
          />

          {!isEditing && currentDeviceId && (
            <button
              className="mini-button"
              type="button"
              onClick={useCurrentDeviceId}
            >
              <Smartphone size={14} />
              Usar este dispositivo
            </button>
          )}
        </div>

        <div>
          <label className="field-label">Nombre del equipo</label>
          <input
            className="text-input"
            value={form.nombre}
            onChange={(event) =>
              setForm({ ...form, nombre: event.target.value })
            }
            placeholder="Celular Seguridad HRM 01"
            required
          />
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
                <small>Autoriza este celular para todos los hoteles</small>
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
                    onChange={() => toggleProperty(property.id)}
                  />

                  <span>
                    <strong>{property.nombre}</strong>
                    <small>{property.codigo}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="form-full">
          <label className="field-label">Notas</label>
          <textarea
            className="textarea-input"
            value={form.notas}
            onChange={(event) => setForm({ ...form, notas: event.target.value })}
            rows={3}
            placeholder="Ejemplo: equipo de caseta principal, turno nocturno, etc."
          />
        </div>

        <div className="form-actions">
          <button className="primary-button" disabled={saving}>
            <Save size={17} />
            {isEditing ? "Guardar cambios" : "Guardar dispositivo"}
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
        columns={["Nombre", "ID", "Propiedades", "Estado", "Notas", "Acción"]}
        rows={dispositivos.map((device) => [
          device.nombre,
          device.id,
          getAllowedLabel(device.propiedadesPermitidas),
          device.activo ? "Activo" : "Inactivo",
          device.notas || "—",
          <button
            className="mini-button"
            type="button"
            onClick={() => startEditing(device)}
          >
            Editar
          </button>,
        ])}
      />
    </section>
  );
}