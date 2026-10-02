import { FileText, PackageCheck } from "lucide-react";

const INCIDENT_TYPES = [
  {
    value: "proveedor",
    label: "Proveedor",
    description: "Registrar entrada o visita de proveedor con firma y fotos.",
    icon: PackageCheck,
  },
  {
    value: "hechos_relevantes",
    label: "Informe de hechos relevantes",
    description: "Registrar un incidente, hecho relevante o situación operativa.",
    icon: FileText,
  },
];

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizarGrupos(groupedRoutes) {
  if (!groupedRoutes) return [];

  if (Array.isArray(groupedRoutes)) {
    return groupedRoutes
      .map((grupo, index) => {
        const rutas =
          grupo.rutas ||
          grupo.routes ||
          grupo.recorridos ||
          grupo.items ||
          [];

        const primeraRuta = safeArray(rutas)[0];

        return {
          id:
            grupo.id ||
            grupo.propiedadId ||
            primeraRuta?.propiedadId ||
            `grupo_${index}`,
          propiedadId: grupo.propiedadId || primeraRuta?.propiedadId || "",
          propiedadNombre:
            grupo.propiedadNombre ||
            grupo.nombre ||
            grupo.propiedad ||
            grupo.titulo ||
            primeraRuta?.propiedadNombre ||
            primeraRuta?.propiedad ||
            "Propiedad",
          rutas: safeArray(rutas),
        };
      })
      .filter((grupo) => grupo.propiedadNombre);
  }

  if (typeof groupedRoutes === "object") {
    return Object.entries(groupedRoutes).map(
      ([propiedadNombre, rutas], index) => {
        const primeraRuta = safeArray(rutas)[0];

        return {
          id: primeraRuta?.propiedadId || `grupo_${index}_${propiedadNombre}`,
          propiedadId: primeraRuta?.propiedadId || "",
          propiedadNombre,
          rutas: safeArray(rutas),
        };
      }
    );
  }

  return [];
}

export default function IncidentTypeList({ groupedRoutes = [], onOpenIncident }) {
  const grupos = normalizarGrupos(groupedRoutes);

  if (!grupos.length) {
    return (
      <div className="guardia-empty-card">
        <h3>No hay propiedades disponibles</h3>
        <p>No se encontraron propiedades asignadas para registrar incidencias.</p>
      </div>
    );
  }

  function handleOpenIncident(grupo, tipo) {
    onOpenIncident?.({
      tipo: tipo.value,
      tipoNombre: tipo.label,
      propiedadId: grupo.propiedadId,
      propiedadNombre: grupo.propiedadNombre,
    });
  }

  return (
    <div className="incident-section-list">
      {grupos.map((grupo) => (
        <section className="property-routes-card" key={grupo.id}>
          <p className="eyebrow">Incidencias</p>
          <h2>{grupo.propiedadNombre}</h2>

          <div className="incident-type-grid">
            {INCIDENT_TYPES.map((tipo) => {
              const Icon = tipo.icon;

              return (
                <article className="incident-type-card" key={tipo.value}>
                  <div className="incident-type-icon">
                    <Icon size={22} />
                  </div>

                  <div>
                    <h3>{tipo.label}</h3>
                    <p>{tipo.description}</p>
                  </div>

                  <button
                    type="button"
                    className="primary-button incident-type-button"
                    onClick={() => handleOpenIncident(grupo, tipo)}
                  >
                    Registrar
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}