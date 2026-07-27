import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { LogOut, RefreshCcw } from "lucide-react";
import { db } from "../services/firebase";
import ReportesPanel from "./admin/reportes/ReportesPanel";
import "./supervisor.css";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizarPermisos(profile) {
  if (!profile) return [];

  if (
    Array.isArray(profile.propiedadesPermitidas) &&
    profile.propiedadesPermitidas.length > 0
  ) {
    return profile.propiedadesPermitidas.filter(Boolean);
  }

  if (
    Array.isArray(profile.propiedadesAsignadas) &&
    profile.propiedadesAsignadas.length > 0
  ) {
    return profile.propiedadesAsignadas.filter(Boolean);
  }

  if (profile.propiedadId === "todas") return ["*"];

  if (profile.propiedadId && profile.propiedadId !== "todas") {
    return [profile.propiedadId];
  }

  return [];
}

function puedeVerPropiedad(profile, propiedadId) {
  const permisos = normalizarPermisos(profile);

  if (permisos.includes("*")) return true;

  if (!permisos.length) return true;

  return permisos.includes(propiedadId);
}

function obtenerNombrePropiedad(propiedadId, propiedadNombre, propiedadesMap) {
  if (propiedadNombre && propiedadNombre !== propiedadId) {
    return propiedadNombre;
  }

  return propiedadesMap.get(propiedadId) || propiedadId || "Sin propiedad";
}

export default function SupervisorDashboard({ profile, logout }) {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [ejecuciones, setEjecuciones] = useState([]);
  const [evidencias, setEvidencias] = useState([]);
  const [propiedades, setPropiedades] = useState([]);

  const safeLogout =
    typeof logout === "function"
      ? logout
      : () => {
          window.location.hash = "#/";
          window.location.reload();
        };

  const permisosTexto = useMemo(() => {
    const permisos = normalizarPermisos(profile);

    if (permisos.includes("*")) return "Todas las propiedades";

    if (!permisos.length) return "Todas las propiedades";

    return `${permisos.length} propiedad(es)`;
  }, [profile]);

  async function loadData() {
    setLoading(true);
    setMessage("");

    try {
      const [propiedadesSnap, ejecucionesSnap, evidenciasSnap] =
        await Promise.all([
          getDocs(collection(db, "propiedades")),
          getDocs(collection(db, "ejecucionesRecorridos")),
          getDocs(collection(db, "evidenciasPuntos")),
        ]);

      const propiedadesData = propiedadesSnap.docs.map((documento) => ({
        id: documento.id,
        ...documento.data(),
      }));

      const propiedadesMap = new Map();

      propiedadesData.forEach((propiedad) => {
        propiedadesMap.set(
          propiedad.id,
          propiedad.nombre || propiedad.codigo || propiedad.id
        );
      });

      const ejecucionesData = ejecucionesSnap.docs
        .map((documento) => {
          const data = documento.data() || {};

          const propiedadNombre = obtenerNombrePropiedad(
            data.propiedadId,
            data.propiedadNombre,
            propiedadesMap
          );

          return {
            id: documento.id,
            ...data,
            propiedadNombre,
          };
        })
        .filter((ejecucion) =>
          puedeVerPropiedad(profile, ejecucion.propiedadId)
        );

      const ejecucionesIds = new Set(ejecucionesData.map((item) => item.id));

      const evidenciasData = evidenciasSnap.docs
        .map((documento) => ({
          id: documento.id,
          ...documento.data(),
        }))
        .filter((evidencia) => ejecucionesIds.has(evidencia.ejecucionId));

      setPropiedades(propiedadesData);
      setEjecuciones(ejecucionesData);
      setEvidencias(evidenciasData);
    } catch (error) {
      console.error("Error cargando supervisión:", error);

      setMessage(
        error?.code === "permission-denied"
          ? "No tienes permiso para consultar la información de supervisión."
          : error?.message || "No fue posible cargar la información."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="supervisor-page">
      <header className="supervisor-header">
        <div>
          <span className="supervisor-kicker">Panel de supervisión</span>
          <h1>Control de recorridos</h1>
          <p>
            {profile?.nombre || profile?.correo || "Supervisor"} ·{" "}
            {permisosTexto}
          </p>
        </div>

        <div className="supervisor-header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCcw size={16} />
            Actualizar
          </button>

          <button type="button" className="secondary-button" onClick={safeLogout}>
            <LogOut size={16} />
            Salir
          </button>
        </div>
      </header>

      {message && <div className="supervisor-message">{message}</div>}

      {loading ? (
        <section className="supervisor-loading">
          <div className="pdf-loading-spinner" />
          <p>Cargando recorridos...</p>
        </section>
      ) : (
     <div className="supervisor-report-wrapper">
        <ReportesPanel
          ejecuciones={safeArray(ejecuciones)}
          evidencias={safeArray(evidencias)}
          propiedades={safeArray(propiedades)}
        />
      </div>
      )}
    </main>
  );
}