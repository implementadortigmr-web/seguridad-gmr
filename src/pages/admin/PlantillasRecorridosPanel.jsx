import { useMemo, useState } from "react";
import { Edit3, Save, Trash2, X } from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import CatalogTable from "../../components/CatalogTable";
import { db } from "../../services/firebase";
import { useFeedback } from "../../context/FeedbackContext";

const INITIAL_FORM = {
  nombre: "",
  propiedadId: "",
  puntosTexto: "",
  activo: true,
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export default function PlantillasRecorridosPanel({
  userId,
  plantillas = [],
  propiedades = [],
  setMessage,
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [guardando, setGuardando] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState("");
  const feedback = useFeedback();

  const isEditing = Boolean(editingId);

  const propiedadesSafe = safeArray(propiedades);
  const plantillasSafe = safeArray(plantillas);

  const propiedadesActivas = propiedadesSafe.filter(
    (propiedad) => propiedad.activo === true
  );

  const recorridosActivos = useMemo(() => {
    return plantillasSafe
      .filter((plantilla) => plantilla.activo !== false)
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
  }, [plantillasSafe]);

  const recorridosInactivos = useMemo(() => {
    return plantillasSafe
      .filter((plantilla) => plantilla.activo === false)
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
  }, [plantillasSafe]);

  function getPropertyName(propiedadId) {
    const propiedad = propiedadesSafe.find((item) => item.id === propiedadId);
    return propiedad?.nombre || propiedadId || "Sin propiedad";
  }

  function limpiarFormulario() {
    setForm(INITIAL_FORM);
    setEditingId(null);
    setMessage("");
  }

  function normalizarPuntosParaTexto(puntos = []) {
    return safeArray(puntos)
      .map((punto) => {
        if (typeof punto === "string") return punto;
        return punto?.nombre || "";
      })
      .filter(Boolean)
      .join("\n");
  }

  function obtenerPuntos() {
    return form.puntosTexto
      .split("\n")
      .map((punto) => punto.trim())
      .filter(Boolean);
  }

  function iniciarEdicion(plantilla) {
    setEditingId(plantilla.id);

    setForm({
      nombre: plantilla.nombre || "",
      propiedadId: plantilla.propiedadId || "",
      puntosTexto: normalizarPuntosParaTexto(plantilla.puntos),
      activo: plantilla.activo === true,
    });

    setMessage("Editando recorrido. Puedes agregar, quitar o cambiar puntos.");
  }

  async function guardarRecorrido(evento) {
    evento.preventDefault();

    setGuardando(true);
    setMessage("");

    const puntos = obtenerPuntos();

    if (!form.nombre.trim()) {
      setMessage("Agrega el nombre del recorrido.");
      setGuardando(false);
      return;
    }

    if (!form.propiedadId) {
      setMessage("Selecciona una propiedad.");
      setGuardando(false);
      return;
    }

    if (!puntos.length) {
      setMessage("Agrega al menos un punto de revisión.");
      setGuardando(false);
      return;
    }

    const data = {
      nombre: form.nombre.trim(),
      propiedadId: form.propiedadId,
      puntos,
      totalPuntos: puntos.length,
      activo: form.activo,
      actualizadoEn: serverTimestamp(),
      actualizadoPor: userId,
    };

    try {
      if (isEditing) {
        await updateDoc(doc(db, "plantillasRecorridos", editingId), data);
        setMessage("Recorrido actualizado correctamente.");
      } else {
        await addDoc(collection(db, "plantillasRecorridos"), {
          ...data,
          creadoEn: serverTimestamp(),
          creadoPor: userId,
        });

        setMessage("Recorrido guardado correctamente.");
      }

      limpiarFormulario();
    } catch (error) {
      console.error("Error guardando recorrido:", error);
      setMessage("No fue posible guardar el recorrido. Revisa permisos.");
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarActivo(plantilla) {
    setMessage("");

    try {
      await updateDoc(doc(db, "plantillasRecorridos", plantilla.id), {
        activo: !plantilla.activo,
        actualizadoEn: serverTimestamp(),
        actualizadoPor: userId,
      });

      setMessage("Estado del recorrido actualizado correctamente.");
    } catch (error) {
      console.error("Error actualizando recorrido:", error);
      setMessage("No fue posible actualizar el recorrido.");
    }
  }

  async function eliminarRecorrido(plantilla) {
    if (plantilla.activo !== false) {
      setMessage("Solo se pueden eliminar recorridos inactivos.");
      return;
    }

    const confirmar = await feedback.confirm({
      title: "Eliminar recorrido",
      message: `¿Seguro que deseas eliminar el recorrido "${plantilla.nombre}"? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      type: "danger",
    });

    if (!confirmar) return;

    setDeletingId(plantilla.id);
    setMessage("");

    try {
      await deleteDoc(doc(db, "plantillasRecorridos", plantilla.id));

      if (editingId === plantilla.id) {
        limpiarFormulario();
      }

      setMessage("Recorrido eliminado correctamente.");
    } catch (error) {
      console.error("Error eliminando recorrido:", error);
      setMessage(
        error?.code === "permission-denied"
          ? "No tienes permisos para eliminar recorridos."
          : "No fue posible eliminar el recorrido."
      );
    } finally {
      setDeletingId("");
    }
  }

  function crearFilasTabla(lista, mostrarEliminar = false) {
    return safeArray(lista).map((plantilla) => [
      plantilla.nombre,
      getPropertyName(plantilla.propiedadId),
      plantilla.totalPuntos || plantilla.puntos?.length || 0,
      plantilla.activo ? "Activo" : "Inactivo",
      <div className="table-actions">
        <button
          className="mini-button"
          type="button"
          onClick={() => iniciarEdicion(plantilla)}
        >
          <Edit3 size={14} />
          Editar
        </button>

        <button
          className="mini-button"
          type="button"
          onClick={() => cambiarActivo(plantilla)}
        >
          {plantilla.activo ? "Desactivar" : "Activar"}
        </button>

        {mostrarEliminar && (
          <button
            className="mini-button danger-mini-button"
            type="button"
            onClick={() => eliminarRecorrido(plantilla)}
            disabled={deletingId === plantilla.id}
          >
            <Trash2 size={14} />
            {deletingId === plantilla.id ? "Eliminando..." : "Eliminar"}
          </button>
        )}
      </div>,
    ]);
  }

  return (
    <section>
      <h2>Recorridos</h2>

      <p className="muted admin-intro">
        Crea y edita los recorridos base por propiedad. Cada punto debe ir en
        una línea diferente.
      </p>

      <form className="catalog-form wide" onSubmit={guardarRecorrido}>
        <div>
          <label className="field-label">Nombre del recorrido</label>
          <input
            className="text-input"
            value={form.nombre}
            onChange={(evento) =>
              setForm({
                ...form,
                nombre: evento.target.value,
              })
            }
            placeholder="Rondín General"
            required
          />
        </div>

        <div>
          <label className="field-label">Propiedad</label>
          <select
            className="text-input"
            value={form.propiedadId}
            onChange={(evento) =>
              setForm({
                ...form,
                propiedadId: evento.target.value,
              })
            }
            required
          >
            <option value="">Selecciona una propiedad</option>

            {propiedadesActivas.map((propiedad) => (
              <option key={propiedad.id} value={propiedad.id}>
                {propiedad.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label">Estado</label>
          <select
            className="text-input"
            value={form.activo ? "activo" : "inactivo"}
            onChange={(evento) =>
              setForm({
                ...form,
                activo: evento.target.value === "activo",
              })
            }
          >
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </select>
        </div>

        <div className="form-full">
          <label className="field-label">
            Puntos del recorrido, uno por línea
          </label>

          <textarea
            className="textarea-input"
            value={form.puntosTexto}
            onChange={(evento) =>
              setForm({
                ...form,
                puntosTexto: evento.target.value,
              })
            }
            placeholder={`Caseta\nEstacionamiento\nLobby\nAlberca`}
            rows={8}
            required
          />

          <p className="helper-text">
            Para agregar puntos nuevos, escríbelos en una línea nueva. Para
            quitar puntos, borra la línea correspondiente.
          </p>
        </div>

        <div className="form-actions">
          <button className="primary-button" disabled={guardando}>
            <Save size={17} />
            {isEditing ? "Guardar cambios" : "Guardar recorrido"}
          </button>

          {isEditing && (
            <button
              type="button"
              className="secondary-button"
              onClick={limpiarFormulario}
            >
              <X size={17} />
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="routes-status-summary">
        <article>
          <span>Activos</span>
          <strong>{recorridosActivos.length}</strong>
        </article>

        <article>
          <span>Inactivos</span>
          <strong>{recorridosInactivos.length}</strong>
        </article>
      </div>

      <section className="route-table-section">
        <div className="route-table-section-header">
          <div>
            <h3>Recorridos activos</h3>
            <p>
              Estos son los recorridos que puede ver el guardia en la aplicación.
            </p>
          </div>
        </div>

        <CatalogTable
          columns={[
            "Recorrido",
            "Propiedad",
            "Puntos",
            "Estado",
            "Acciones",
          ]}
          rows={crearFilasTabla(recorridosActivos, false)}
        />
      </section>

      <section className="route-table-section route-table-section-muted">
        <div className="route-table-section-header">
          <div>
            <h3>Recorridos inactivos</h3>
            <p>
              Estos recorridos no aparecen en la app del guardia. Desde aquí
              puedes activarlos o eliminarlos.
            </p>
          </div>
        </div>

        <CatalogTable
          columns={[
            "Recorrido",
            "Propiedad",
            "Puntos",
            "Estado",
            "Acciones",
          ]}
          rows={crearFilasTabla(recorridosInactivos, true)}
        />
      </section>
    </section>
  );
}