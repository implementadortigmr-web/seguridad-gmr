import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Eye,
  FileText,
  Filter,
  ImageIcon,
  MapPin,
  PackageCheck,
  RefreshCcw,
  RotateCcw,
  Signature,
  User,
  X,
  FileDown,
} from "lucide-react";
import { formatDate } from "../../../utils/formatters";
import MessageBox from '../../../components/MessageBox';
import {
  actualizarEstadoIncidencia,
  listarIncidenciasAdmin,
} from "../../../services/incidenciasAdminService";



function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizarTexto(texto = "") {
  return String(texto || "").trim().toLowerCase();
}

function convertirAFecha(valor) {
  if (!valor) return null;

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }

  if (typeof valor?.toDate === "function") {
    const fecha = valor.toDate();
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  if (typeof valor === "object" && typeof valor.seconds === "number") {
    const fecha = new Date(valor.seconds * 1000);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  if (typeof valor === "number") {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  if (typeof valor === "string") {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  return null;
}

function crearFechaInicio(fechaTexto) {
  if (!fechaTexto) return null;

  const fecha = new Date(`${fechaTexto}T00:00:00`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function crearFechaFin(fechaTexto) {
  if (!fechaTexto) return null;

  const fecha = new Date(`${fechaTexto}T23:59:59`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function obtenerFechaIncidencia(incidencia) {
  return (
    incidencia?.creadaEn ||
    incidencia?.sincronizadaEn ||
    incidencia?.actualizadoEn ||
    ""
  );
}

function obtenerTimestamp(valor) {
  const fecha = convertirAFecha(valor);
  return fecha ? fecha.getTime() : 0;
}

function obtenerIdPropiedad(incidencia) {
  return incidencia?.propiedadId || "sin_propiedad";
}

function obtenerNombrePropiedad(incidencia, propiedadesMap = new Map()) {
  const propiedadId = obtenerIdPropiedad(incidencia);

  if (
    incidencia?.propiedadNombre &&
    incidencia.propiedadNombre !== propiedadId
  ) {
    return incidencia.propiedadNombre;
  }

  return propiedadesMap.get(propiedadId) || propiedadId || "Sin propiedad";
}

function obtenerTipoNombre(tipo) {
  const tipos = {
    proveedor: "Proveedor",
    hechos_relevantes: "Hechos relevantes",
  };

  return tipos[tipo] || "Incidencia";
}

function obtenerEstadoNombre(estado = "") {
  const estados = {
    abierta: "Abierta",
    en_revision: "En revisión",
    resuelta: "Resuelta",
    cancelada: "Cancelada",
  };

  return estados[estado] || estado || "Abierta";
}

function obtenerEstadoClass(estado = "") {
  if (estado === "resuelta") return "success";
  if (estado === "en_revision") return "warning";
  if (estado === "cancelada") return "danger";

  return "neutral";
}

function obtenerFotos(incidencia) {
  const fotos = safeArray(incidencia?.fotos).filter(
    (foto) => foto?.fotoUrl || foto?.fotoThumbUrl || foto?.url
  );

  if (!fotos.length && incidencia?.fotoUrl) {
    return [
      {
        id: "foto_principal",
        orden: 1,
        fotoUrl: incidencia.fotoUrl,
        fotoThumbUrl: incidencia.fotoThumbUrl || incidencia.fotoUrl,
      },
    ];
  }

  return fotos;
}

function obtenerFirmas(incidencia) {
  const firmas = [];

  const firmasObj = incidencia?.firmas || {};

  if (firmasObj.proveedor?.url || incidencia?.firmaProveedorUrl) {
    firmas.push({
      id: "proveedor",
      label: "Firma proveedor",
      url: firmasObj.proveedor?.url || incidencia.firmaProveedorUrl,
    });
  }

  if (firmasObj.guardia?.url || incidencia?.firmaGuardiaUrl) {
    firmas.push({
      id: "guardia",
      label: "Firma guardia",
      url: firmasObj.guardia?.url || incidencia.firmaGuardiaUrl,
    });
  }

  if (
    firmasObj.responsableTestigo?.url ||
    incidencia?.firmaResponsableTestigoUrl
  ) {
    firmas.push({
      id: "responsableTestigo",
      label: "Firma responsable/testigo",
      url:
        firmasObj.responsableTestigo?.url ||
        incidencia.firmaResponsableTestigoUrl,
    });
  }

  return firmas;
}

function CampoDetalle({ label, value }) {
  return (
    <div className="inc-detail-field">
      <strong>{label}</strong>
      <span>{value || "—"}</span>
    </div>
  );
}

function renderCamposIncidencia(incidencia) {
  const campos = incidencia?.campos || {};

  if (incidencia?.tipo === "proveedor") {
    return (
      <>
        <CampoDetalle label="Nombre proveedor" value={campos.nombreProveedor} />
        <CampoDetalle label="Compañía" value={campos.compania} />
        <CampoDetalle
          label="Persona que visita"
          value={campos.personaQueVisita}
        />
        <CampoDetalle label="Motivo" value={campos.motivo} />
      </>
    );
  }

  if (incidencia?.tipo === "hechos_relevantes") {
    return (
      <>
        <CampoDetalle
          label="Guardia que reporta"
          value={campos.nombreGuardiaReporta}
        />
        <CampoDetalle label="Tipo de incidente" value={campos.tipoIncidente} />
        <CampoDetalle
          label="Descripción de los hechos"
          value={campos.descripcionHechos}
        />
        <CampoDetalle
          label="Acción realizada por seguridad"
          value={campos.accionRealizadaSeguridad}
        />
        <CampoDetalle
          label="Comentarios de los involucrados"
          value={campos.comentariosInvolucrados}
        />
        <CampoDetalle
          label="Responsable o testigo"
          value={campos.nombreResponsableTestigo}
        />
      </>
    );
  }

  return <CampoDetalle label="Descripción" value={incidencia?.descripcion} />;
}

export default function IncidenciasRevisionPanel({
  profile,
  propiedades = [],
  permisosPropiedades = [],
}) {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [incidencias, setIncidencias] = useState([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("todas");
  const [selectedType, setSelectedType] = useState("todos");
  const [selectedStatus, setSelectedStatus] = useState("todos");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);
  const [actionLoading, setActionLoading] = useState("");
  const [comentarioResolucion, setComentarioResolucion] = useState("");

  const [generatingIncidentPdf, setGeneratingIncidentPdf] = useState(false);

  const propiedadesSafe = safeArray(propiedades);

  const propiedadesMap = useMemo(() => {
    const map = new Map();

    propiedadesSafe.forEach((propiedad) => {
      if (!propiedad?.id) return;

      map.set(
        propiedad.id,
        propiedad.nombre || propiedad.codigo || propiedad.id
      );
    });

    return map;
  }, [propiedadesSafe]);

  const permisosSafe = safeArray(permisosPropiedades).filter(Boolean);

  const incidenciasPermitidas = useMemo(() => {
    if (!permisosSafe.length || permisosSafe.includes("*")) {
      return safeArray(incidencias);
    }

    return safeArray(incidencias).filter((incidencia) =>
      permisosSafe.includes(incidencia.propiedadId)
    );
  }, [incidencias, permisosSafe]);

  const propiedadesDisponibles = useMemo(() => {
    const map = new Map();

    propiedadesSafe.forEach((propiedad) => {
      if (!propiedad?.id) return;

      if (
        permisosSafe.length &&
        !permisosSafe.includes("*") &&
        !permisosSafe.includes(propiedad.id)
      ) {
        return;
      }

      map.set(propiedad.id, {
        id: propiedad.id,
        nombre: propiedad.nombre || propiedad.codigo || propiedad.id,
      });
    });

    incidenciasPermitidas.forEach((incidencia) => {
      const propiedadId = obtenerIdPropiedad(incidencia);

      map.set(propiedadId, {
        id: propiedadId,
        nombre: obtenerNombrePropiedad(incidencia, propiedadesMap),
      });
    });

    return [...map.values()].sort((a, b) =>
      String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
    );
  }, [incidenciasPermitidas, propiedadesSafe, propiedadesMap, permisosSafe]);

  const incidenciasFiltradas = useMemo(() => {
    const inicioFiltro = crearFechaInicio(fechaInicio);
    const finFiltro = crearFechaFin(fechaFin);

    const base = incidenciasPermitidas.filter((incidencia) => {
      const propiedadCoincide =
        selectedPropertyId === "todas" ||
        obtenerIdPropiedad(incidencia) === selectedPropertyId;

      const tipoCoincide =
        selectedType === "todos" || incidencia.tipo === selectedType;

      const estadoActual = incidencia.estado || "abierta";

      const estadoCoincide =
        selectedStatus === "todos" || estadoActual === selectedStatus;

      const fechaIncidencia = convertirAFecha(obtenerFechaIncidencia(incidencia));

      const fechaCoincideInicio =
        !inicioFiltro || (fechaIncidencia && fechaIncidencia >= inicioFiltro);

      const fechaCoincideFin =
        !finFiltro || (fechaIncidencia && fechaIncidencia <= finFiltro);

      return (
        propiedadCoincide &&
        tipoCoincide &&
        estadoCoincide &&
        fechaCoincideInicio &&
        fechaCoincideFin
      );
    });

    return [...base].sort(
      (a, b) =>
        obtenerTimestamp(obtenerFechaIncidencia(b)) -
        obtenerTimestamp(obtenerFechaIncidencia(a))
    );
  }, [
    incidenciasPermitidas,
    selectedPropertyId,
    selectedType,
    selectedStatus,
    fechaInicio,
    fechaFin,
  ]);

  const selectedIncident =
    incidenciasFiltradas.find((item) => item.id === selectedIncidentId) ||
    incidenciasFiltradas[0] ||
    null;

  const fotosSeleccionadas = obtenerFotos(selectedIncident);
  const firmasSeleccionadas = obtenerFirmas(selectedIncident);

  const stats = useMemo(() => {
    const abiertas = incidenciasPermitidas.filter(
      (item) => (item.estado || "abierta") === "abierta"
    ).length;

    const revision = incidenciasPermitidas.filter(
      (item) => item.estado === "en_revision"
    ).length;

    const resueltas = incidenciasPermitidas.filter(
      (item) => item.estado === "resuelta"
    ).length;

    return {
      total: incidenciasPermitidas.length,
      abiertas,
      revision,
      resueltas,
    };
  }, [incidenciasPermitidas]);

  async function loadData() {
    setLoading(true);
    setMessage("");

    try {
      const data = await listarIncidenciasAdmin();
      setIncidencias(data);
    } catch (error) {
      console.error("Error cargando incidencias:", error);

      setMessage(
        error?.code === "permission-denied"
          ? "No tienes permiso para consultar incidencias."
          : error?.message || "No fue posible cargar las incidencias."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!incidenciasFiltradas.length) {
      setSelectedIncidentId("");
      return;
    }

    const existeSeleccion = incidenciasFiltradas.some(
      (incidencia) => incidencia.id === selectedIncidentId
    );

    if (!existeSeleccion) {
      setSelectedIncidentId(incidenciasFiltradas[0].id);
    }
  }, [incidenciasFiltradas, selectedIncidentId]);

  function limpiarFiltros() {
    setSelectedPropertyId("todas");
    setSelectedType("todos");
    setSelectedStatus("todos");
    setFechaInicio("");
    setFechaFin("");
    setSelectedIncidentId("");
  }
  
  async function handleGenerateIncidentPdf() {
  if (!selectedIncident) return;

  setGeneratingIncidentPdf(true);
  setMessage("");

  try {
    const { generarPdfIncidencia } = await import("../../../services/pdfIncidenciaService");
      await generarPdfIncidencia({
      incidencia: selectedIncident,
    });
  } catch (error) {
    console.error("Error generando PDF de incidencia:", error);
    setMessage(
      error?.message || "No fue posible generar el PDF de la incidencia."
    );
  } finally {
    setGeneratingIncidentPdf(false);
  }
}


  async function cambiarEstado(estado) {
    if (!selectedIncident) return;

    setActionLoading(estado);
    setMessage("");

    try {
      await actualizarEstadoIncidencia({
        incidenciaId: selectedIncident.id,
        estado,
        usuarioId: profile?.id || profile?.uid || "",
        usuarioNombre: profile?.nombre || profile?.correo || "",
        comentarioResolucion,
      });

      setIncidencias((current) =>
        safeArray(current).map((incidencia) =>
          incidencia.id === selectedIncident.id
            ? {
                ...incidencia,
                estado,
                comentarioResolucion:
                  estado === "resuelta"
                    ? comentarioResolucion
                    : incidencia.comentarioResolucion,
              }
            : incidencia
        )
      );

      if (estado === "resuelta") {
        setComentarioResolucion("");
      }

      setMessage(`Incidencia marcada como ${obtenerEstadoNombre(estado)}.`);
    } catch (error) {
      console.error("Error actualizando incidencia:", error);

      setMessage(
        error?.code === "permission-denied"
          ? "No tienes permiso para actualizar esta incidencia."
          : error?.message || "No fue posible actualizar la incidencia."
      );
    } finally {
      setActionLoading("");
    }
  }

  return (
    <section className="incidencias-panel">
      <div className="inc-panel-header">
        <div>
          <h2>Incidencias</h2>
          <p className="muted admin-intro">
            Consulta incidencias por propiedad, tipo, estado y fecha. Puedes
            revisar fotos, firmas y marcar incidencias como resueltas.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={loadData}
          disabled={loading}
        >
          <RefreshCcw size={16} />
          Actualizar
        </button>
      </div>

      {message && <MessageBox>{message}</MessageBox>}

      <div className="inc-stats-grid">
        <article>
          <span>Total</span>
          <strong>{stats.total}</strong>
        </article>

        <article>
          <span>Abiertas</span>
          <strong>{stats.abiertas}</strong>
        </article>

        <article>
          <span>En revisión</span>
          <strong>{stats.revision}</strong>
        </article>

        <article>
          <span>Resueltas</span>
          <strong>{stats.resueltas}</strong>
        </article>
      </div>

      <div className="report-filters inc-filters">
        <div>
          <label className="field-label">
            <Filter size={15} />
            Propiedad
          </label>

          <select
            className="text-input"
            value={selectedPropertyId}
            onChange={(event) => setSelectedPropertyId(event.target.value)}
          >
            <option value="todas">Todas las propiedades</option>

            {propiedadesDisponibles.map((propiedad) => (
              <option key={propiedad.id} value={propiedad.id}>
                {propiedad.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label">
            <FileText size={15} />
            Tipo
          </label>

          <select
            className="text-input"
            value={selectedType}
            onChange={(event) => setSelectedType(event.target.value)}
          >
            <option value="todos">Todos</option>
            <option value="proveedor">Proveedor</option>
            <option value="hechos_relevantes">Hechos relevantes</option>
          </select>
        </div>

        <div>
          <label className="field-label">
            <AlertCircle size={15} />
            Estado
          </label>

          <select
            className="text-input"
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value)}
          >
            <option value="todos">Todos</option>
            <option value="abierta">Abierta</option>
            <option value="en_revision">En revisión</option>
            <option value="resuelta">Resuelta</option>
          </select>
        </div>

        <div>
          <label className="field-label">
            <CalendarDays size={15} />
            Desde
          </label>

          <input
            className="text-input"
            type="date"
            value={fechaInicio}
            onChange={(event) => setFechaInicio(event.target.value)}
          />
        </div>

        <div>
          <label className="field-label">
            <CalendarDays size={15} />
            Hasta
          </label>

          <input
            className="text-input"
            type="date"
            value={fechaFin}
            onChange={(event) => setFechaFin(event.target.value)}
          />
        </div>

        <button
          type="button"
          className="secondary-button report-clear-button"
          onClick={limpiarFiltros}
        >
          <RotateCcw size={16} />
          Limpiar
        </button>
      </div>

      {loading ? (
        <section className="supervisor-loading">
          <div className="pdf-loading-spinner" />
          <p>Cargando incidencias...</p>
        </section>
      ) : (
        <div className="inc-layout">
          <div className="inc-list">
            {incidenciasFiltradas.length ? (
              incidenciasFiltradas.map((incidencia) => {
                const activa = selectedIncident?.id === incidencia.id;
                const fotos = obtenerFotos(incidencia);
                const icono =
                  incidencia.tipo === "proveedor" ? (
                    <PackageCheck size={18} />
                  ) : (
                    <FileText size={18} />
                  );

                return (
                  <button
                    type="button"
                    className={`inc-card ${activa ? "active" : ""}`}
                    key={incidencia.id}
                    onClick={() => setSelectedIncidentId(incidencia.id)}
                  >
                    <div className="inc-card-icon">{icono}</div>

                    <div>
                      <strong>
                        {incidencia.tipoNombre ||
                          obtenerTipoNombre(incidencia.tipo)}
                      </strong>

                      <span>
                        {obtenerNombrePropiedad(incidencia, propiedadesMap)}
                      </span>

                      <small>
                        {incidencia.guardiaNombre || "Sin guardia"} ·{" "}
                        {formatDate(obtenerFechaIncidencia(incidencia))}
                      </small>
                    </div>

                    <div className="inc-card-meta">
                      <span
                        className={`inc-status ${obtenerEstadoClass(
                          incidencia.estado || "abierta"
                        )}`}
                      >
                        {obtenerEstadoNombre(incidencia.estado || "abierta")}
                      </span>

                      <small>{fotos.length} foto(s)</small>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="empty-state">
                No hay incidencias con los filtros seleccionados.
              </div>
            )}
          </div>

          <div className="inc-detail">
            {selectedIncident ? (
              <>
                <div className="inc-detail-header">
                  <div>
                    <p className="eyebrow">Detalle de incidencia</p>

                    <h3>
                      {selectedIncident.tipoNombre ||
                        obtenerTipoNombre(selectedIncident.tipo)}
                    </h3>

                    <p className="muted">
                      {obtenerNombrePropiedad(selectedIncident, propiedadesMap)}
                    </p>
                  </div>

                 <div className="inc-detail-header-actions">
                    <button
                        type="button"
                        className="secondary-button"
                        onClick={handleGenerateIncidentPdf}
                        disabled={generatingIncidentPdf}
                    >
                        <FileDown size={16} />
                        {generatingIncidentPdf ? "Generando..." : "PDF"}
                    </button>

                    <span
                        className={`inc-status large ${obtenerEstadoClass(
                        selectedIncident.estado || "abierta"
                        )}`}
                    >
                        {obtenerEstadoNombre(selectedIncident.estado || "abierta")}
                    </span>
                    </div>
                </div>

                <div className="inc-summary-grid">
                  <CampoDetalle
                    label="Guardia"
                    value={selectedIncident.guardiaNombre}
                  />

                  <CampoDetalle
                    label="Fecha"
                    value={formatDate(obtenerFechaIncidencia(selectedIncident))}
                  />

                  <CampoDetalle
                    label="Prioridad"
                    value={selectedIncident.prioridad || "media"}
                  />

                  <CampoDetalle
                    label="Fotos"
                    value={`${fotosSeleccionadas.length} archivo(s)`}
                  />
                </div>

                <div className="inc-section-box">
                  <h4>Campos del formato</h4>

                  <div className="inc-detail-grid">
                    {renderCamposIncidencia(selectedIncident)}
                  </div>
                </div>

                <div className="inc-section-box">
                  <h4>Fotografías</h4>

                  {fotosSeleccionadas.length ? (
                    <div className="inc-photo-grid">
                      {fotosSeleccionadas.map((foto, index) => {
                        const url = foto.fotoUrl || foto.url;
                        const thumb = foto.fotoThumbUrl || url;

                        return (
                          <button
                            type="button"
                            className="inc-photo-card"
                            key={foto.id || `${url}_${index}`}
                            onClick={() =>
                              setSelectedImage({
                                title: `Foto ${index + 1}`,
                                url,
                                previewUrl: thumb,
                              })
                            }
                          >
                            <img src={thumb} alt={`Foto ${index + 1}`} />
                            <span>
                              <ImageIcon size={14} />
                              Foto {index + 1}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-state">Sin fotografías.</div>
                  )}
                </div>

                <div className="inc-section-box">
                  <h4>Firmas</h4>

                  {firmasSeleccionadas.length ? (
                    <div className="inc-signature-grid">
                      {firmasSeleccionadas.map((firma) => (
                        <button
                          type="button"
                          className="inc-signature-card"
                          key={firma.id}
                          onClick={() =>
                            setSelectedImage({
                              title: firma.label,
                              url: firma.url,
                              previewUrl: firma.url,
                            })
                          }
                        >
                          <div>
                            <Signature size={18} />
                            <strong>{firma.label}</strong>
                          </div>

                          <img src={firma.url} alt={firma.label} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">Sin firmas.</div>
                  )}
                </div>

                {selectedIncident.ubicacionDisponible && (
                  <div className="inc-section-box">
                    <h4>Ubicación</h4>

                    <a
                      className="map-open-link"
                      href={`https://www.google.com/maps?q=${selectedIncident.latitud},${selectedIncident.longitud}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MapPin size={15} />
                      Abrir ubicación en Google Maps
                    </a>
                  </div>
                )}

                <div className="inc-section-box">
                  <h4>Seguimiento</h4>

                  <label className="field-label">
                    Comentario de resolución
                  </label>

                  <textarea
                    className="textarea-input"
                    value={comentarioResolucion}
                    onChange={(event) =>
                      setComentarioResolucion(event.target.value)
                    }
                    placeholder="Ej. Se revisó con supervisor y queda atendido."
                  />

                  <div className="inc-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => cambiarEstado("en_revision")}
                      disabled={Boolean(actionLoading)}
                    >
                      <Eye size={16} />
                      {actionLoading === "en_revision"
                        ? "Guardando..."
                        : "En revisión"}
                    </button>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => cambiarEstado("resuelta")}
                      disabled={Boolean(actionLoading)}
                    >
                      <CheckCircle2 size={16} />
                      {actionLoading === "resuelta"
                        ? "Guardando..."
                        : "Marcar resuelta"}
                    </button>

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => cambiarEstado("abierta")}
                      disabled={Boolean(actionLoading)}
                    >
                      Reabrir
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                Selecciona una incidencia para ver el detalle.
              </div>
            )}
          </div>
        </div>
      )}

      {selectedImage && (
        <div className="photo-modal-overlay">
          <div className="photo-modal">
            <div className="photo-modal-header">
              <div>
                <p className="eyebrow">Archivo de incidencia</p>
                <h3>{selectedImage.title}</h3>
              </div>

              <button type="button" onClick={() => setSelectedImage(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="photo-preview-box">
              <img
                src={selectedImage.previewUrl || selectedImage.url}
                alt={selectedImage.title}
              />
            </div>

            <div className="photo-modal-footer">
              <a href={selectedImage.url} target="_blank" rel="noreferrer">
                Abrir archivo en pestaña nueva
              </a>
            </div>
          </div>
        </div>
      )}

      {generatingIncidentPdf && (
        <div className="pdf-loading-overlay">
            <div className="pdf-loading-modal">
            <div className="pdf-loading-spinner" />

            <h3>Generando PDF</h3>

            <p>
                Estamos preparando el reporte de incidencia con fotografías, firmas y
                datos capturados.
            </p>

            <span>No cierres esta ventana.</span>
            </div>
        </div>
        )}
    </section>
  );
}