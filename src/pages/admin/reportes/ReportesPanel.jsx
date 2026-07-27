import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ClipboardCheck,
  Clock3,
  Eye,
  Filter,
  MapPin,
  RotateCcw,
  User,
  FileText,
  X,
} from "lucide-react";
import CatalogTable from "../../../components/CatalogTable";
import { formatDate } from "../../../utils/formatters";
import { generarPdfRecorrido } from "../../../services/pdfReportService";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizarTexto(texto = "") {
  return String(texto || "").trim().toLowerCase();
}

function obtenerNombrePropiedad(ejecucion, propiedadesMap = new Map()) {
  if (!ejecucion) return "Sin propiedad";

  const propiedadId = ejecucion.propiedadId || "";

  if (
    ejecucion.propiedadNombre &&
    ejecucion.propiedadNombre !== propiedadId
  ) {
    return ejecucion.propiedadNombre;
  }

  if (ejecucion.propiedad && ejecucion.propiedad !== propiedadId) {
    return ejecucion.propiedad;
  }

  return propiedadesMap.get(propiedadId) || propiedadId || "Sin propiedad";
}

function obtenerIdPropiedad(ejecucion) {
  return ejecucion?.propiedadId || ejecucion?.propiedad || "sin_propiedad";
}

function obtenerFechaReporte(ejecucion) {
  return ejecucion?.finalizadaEn || ejecucion?.iniciadaEn || "";
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
    const limpio = valor.trim();

    if (!limpio || limpio.toLowerCase() === "invalid date") {
      return null;
    }

    const fecha = new Date(limpio);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  return null;
}

function obtenerTimestamp(valor) {
  const fecha = convertirAFecha(valor);
  return fecha ? fecha.getTime() : 0;
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

function calcularDuracion(inicio, cierre) {
  const fechaInicio = convertirAFecha(inicio);
  const fechaCierre = convertirAFecha(cierre);

  if (!fechaInicio || !fechaCierre) {
    return "Sin duración";
  }

  const diferenciaMs = fechaCierre.getTime() - fechaInicio.getTime();

  if (diferenciaMs < 0) {
    return "Sin duración";
  }

  const totalMinutos = Math.max(1, Math.round(diferenciaMs / 60000));
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;

  if (horas > 0 && minutos > 0) return `${horas} h ${minutos} min`;
  if (horas > 0) return `${horas} h`;

  return `${minutos} min`;
}

function obtenerTotalPuntos(ejecucion, evidenciasCount = 0) {
  return Number(
    ejecucion?.puntosTotales ||
      ejecucion?.totalPuntos ||
      ejecucion?.puntosCompletados ||
      evidenciasCount ||
      0
  );
}

function tieneUbicacion(evidencia) {
  return (
    evidencia?.ubicacionDisponible &&
    evidencia?.latitud !== undefined &&
    evidencia?.latitud !== null &&
    evidencia?.longitud !== undefined &&
    evidencia?.longitud !== null
  );
}

function tieneFoto(evidencia) {
  return Boolean(evidencia?.fotoThumbUrl || evidencia?.fotoUrl);
}

export default function ReportesPanel({
  ejecuciones = [],
  evidencias = [],
  propiedades = [],
}) {
  const [selectedPropertyId, setSelectedPropertyId] = useState("todas");
  const [selectedGuardiaId, setSelectedGuardiaId] = useState("todos");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const ejecucionesSafe = safeArray(ejecuciones);
  const evidenciasSafe = safeArray(evidencias);
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

  const propiedadesDisponibles = useMemo(() => {
    const map = new Map();

    propiedadesSafe.forEach((propiedad) => {
      if (!propiedad?.id) return;

      map.set(propiedad.id, {
        id: propiedad.id,
        nombre: propiedad.nombre || propiedad.codigo || propiedad.id,
      });
    });

    ejecucionesSafe.forEach((ejecucion) => {
      const propiedadId = obtenerIdPropiedad(ejecucion);
      const propiedadNombre = obtenerNombrePropiedad(ejecucion, propiedadesMap);

      if (propiedadId) {
        map.set(propiedadId, {
          id: propiedadId,
          nombre: propiedadNombre,
        });
      }
    });

    return [...map.values()].sort((a, b) =>
      String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
    );
  }, [ejecucionesSafe, propiedadesSafe, propiedadesMap]);

  const guardiasDisponibles = useMemo(() => {
    const map = new Map();

    ejecucionesSafe.forEach((ejecucion) => {
      const guardiaId =
        ejecucion.guardiaId || normalizarTexto(ejecucion.guardiaNombre);

      if (guardiaId) {
        map.set(guardiaId, {
          id: guardiaId,
          nombre: ejecucion.guardiaNombre || guardiaId,
        });
      }
    });

    return [...map.values()].sort((a, b) =>
      String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
    );
  }, [ejecucionesSafe]);

  const ejecucionesFiltradas = useMemo(() => {
    const inicioFiltro = crearFechaInicio(fechaInicio);
    const finFiltro = crearFechaFin(fechaFin);

    const base = ejecucionesSafe.filter((ejecucion) => {
      const propiedadCoincide =
        selectedPropertyId === "todas" ||
        obtenerIdPropiedad(ejecucion) === selectedPropertyId;

      const guardiaId =
        ejecucion.guardiaId || normalizarTexto(ejecucion.guardiaNombre);

      const guardiaCoincide =
        selectedGuardiaId === "todos" || guardiaId === selectedGuardiaId;

      const fechaReporte = convertirAFecha(obtenerFechaReporte(ejecucion));

      const fechaCoincideInicio =
        !inicioFiltro || (fechaReporte && fechaReporte >= inicioFiltro);

      const fechaCoincideFin =
        !finFiltro || (fechaReporte && fechaReporte <= finFiltro);

      return (
        propiedadCoincide &&
        guardiaCoincide &&
        fechaCoincideInicio &&
        fechaCoincideFin
      );
    });

    return [...base].sort(
      (a, b) =>
        obtenerTimestamp(obtenerFechaReporte(b)) -
        obtenerTimestamp(obtenerFechaReporte(a))
    );
  }, [
    ejecucionesSafe,
    selectedPropertyId,
    selectedGuardiaId,
    fechaInicio,
    fechaFin,
  ]);

  const evidenciasPorEjecucion = useMemo(() => {
    const map = new Map();

    evidenciasSafe.forEach((evidencia) => {
      if (!evidencia?.ejecucionId) return;

      if (!map.has(evidencia.ejecucionId)) {
        map.set(evidencia.ejecucionId, []);
      }

      map.get(evidencia.ejecucionId).push(evidencia);
    });

    map.forEach((items) => {
      items.sort(
        (a, b) => Number(a?.puntoOrden || 0) - Number(b?.puntoOrden || 0)
      );
    });

    return map;
  }, [evidenciasSafe]);

  const ejecucionesSeguras = Array.isArray(ejecucionesFiltradas)
    ? ejecucionesFiltradas
    : [];

  const selectedExecution =
    ejecucionesSeguras.find((item) => item.id === selectedExecutionId) ||
    ejecucionesSeguras[0] ||
    null;

  const selectedEvidence = selectedExecution
    ? evidenciasPorEjecucion.get(selectedExecution.id) || []
    : [];

  const selectedEvidenceSafe = Array.isArray(selectedEvidence)
    ? selectedEvidence
    : [];

  const puntosCapturadosSeleccionado = selectedEvidenceSafe.length;

  const totalPuntosSeleccionado = obtenerTotalPuntos(
    selectedExecution,
    puntosCapturadosSeleccionado
  );

  useEffect(() => {
    if (!ejecucionesSeguras.length) {
      setSelectedExecutionId("");
      return;
    }

    const existeSeleccion = ejecucionesSeguras.some(
      (ejecucion) => ejecucion.id === selectedExecutionId
    );

    if (!existeSeleccion) {
      setSelectedExecutionId(ejecucionesSeguras[0].id);
    }
  }, [ejecucionesSeguras, selectedExecutionId]);

  function limpiarFiltros() {
    setSelectedPropertyId("todas");
    setSelectedGuardiaId("todos");
    setFechaInicio("");
    setFechaFin("");
    setSelectedExecutionId("");
  }

  function abrirFoto(evidencia) {
    const fotoPrincipal = evidencia?.fotoUrl || evidencia?.fotoThumbUrl;

    if (!fotoPrincipal) return;

    setPhotoLoading(true);

    const gpsDisponible = tieneUbicacion(evidencia);

    setSelectedPhoto({
      url: fotoPrincipal,
      previewUrl: evidencia.fotoThumbUrl || fotoPrincipal,
      punto: evidencia.puntoNombre || evidencia.puntoId || "Punto",
      fecha: evidencia.capturadaEn || evidencia.creadaEn,
      comentario: evidencia.comentario || "Sin comentario",
      tieneGps: gpsDisponible,
      latitud: gpsDisponible ? Number(evidencia.latitud) : null,
      longitud: gpsDisponible ? Number(evidencia.longitud) : null,
      gps: gpsDisponible
        ? `${Number(evidencia.latitud).toFixed(6)}, ${Number(
            evidencia.longitud
          ).toFixed(6)}`
        : "GPS no disponible",
    });
  }

  async function handleGeneratePdf() {
    if (!selectedExecution) return;

    setGeneratingPdf(true);

    try {
      await generarPdfRecorrido({
        ejecucion: selectedExecution,
        evidencias: selectedEvidenceSafe,
      });
    } catch (error) {
      console.error("Error generando PDF:", error);
      alert(
        `No fue posible generar el PDF. ${
          error?.message || "Intenta nuevamente."
        }`
      );
    } finally {
      setGeneratingPdf(false);
    }
  }

  return (
    <section>
      <h2>Reportes de recorridos</h2>

      <p className="muted admin-intro">
        Consulta recorridos finalizados por propiedad, guardia, fechas, equipo,
        duración, puntos capturados y fotografías.
      </p>

      <div className="report-filters compact-report-filters">
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
            <User size={15} />
            Empleado
          </label>

          <select
            className="text-input"
            value={selectedGuardiaId}
            onChange={(event) => setSelectedGuardiaId(event.target.value)}
          >
            <option value="todos">Todos los empleados</option>

            {guardiasDisponibles.map((guardia) => (
              <option key={guardia.id} value={guardia.id}>
                {guardia.nombre}
              </option>
            ))}
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

        <div className="report-filter-summary">
          <strong>{ejecucionesSeguras.length}</strong>
          <span>
            {ejecucionesSeguras.length === 1
              ? "recorrido encontrado"
              : "recorridos encontrados"}
          </span>
        </div>
      </div>

      <div className="reports-grid">
        <div className="reports-list">
          {ejecucionesSeguras.length ? (
            ejecucionesSeguras.map((ejecucion) => {
              const activa = selectedExecution?.id === ejecucion.id;

              const evidenciasCount =
                evidenciasPorEjecucion.get(ejecucion.id)?.length || 0;

              const totalPuntosCard = obtenerTotalPuntos(
                ejecucion,
                evidenciasCount
              );

              const duracion = calcularDuracion(
                ejecucion.iniciadaEn,
                ejecucion.finalizadaEn
              );

              return (
                <button
                  type="button"
                  className={`report-card ${activa ? "active" : ""}`}
                  key={ejecucion.id}
                  onClick={() => setSelectedExecutionId(ejecucion.id)}
                >
                  <div>
                    <strong>
                      {ejecucion.plantillaNombre ||
                        ejecucion.recorridoNombre ||
                        "Recorrido"}
                    </strong>

                    <span>{obtenerNombrePropiedad(ejecucion, propiedadesMap)}</span>

                    <small>{ejecucion.guardiaNombre || "Sin guardia"}</small>
                  </div>

                  <div className="report-card-meta">
                    <span>
                      {evidenciasCount}/{totalPuntosCard} puntos
                    </span>

                    <small>
                      {formatDate(ejecucion.finalizadaEn || ejecucion.iniciadaEn)}
                    </small>

                    <small className="duration-small">{duracion}</small>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="empty-state">
              No hay recorridos con los filtros seleccionados.
            </div>
          )}
        </div>

        <div className="report-detail">
          {selectedExecution ? (
            <>
              <div className="report-detail-header">
                <div>
                  <p className="eyebrow">Detalle del recorrido</p>

                  <h3>
                    {selectedExecution.plantillaNombre ||
                      selectedExecution.recorridoNombre ||
                      "Recorrido"}
                  </h3>

                  <p className="muted">
                    {obtenerNombrePropiedad(selectedExecution, propiedadesMap)}
                  </p>
                </div>

                <div className="report-detail-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleGeneratePdf}
                    disabled={generatingPdf}
                  >
                    <FileText size={16} />
                    {generatingPdf ? "Generando..." : "Generar PDF"}
                  </button>

                  <span className="admin-role-badge">
                    <ClipboardCheck size={16} />
                    {selectedExecution.estado || "finalizado"}
                  </span>
                </div>
              </div>

              <div className="report-summary report-summary-clean">
                <div>
                  <strong>Guardia</strong>
                  <span>{selectedExecution.guardiaNombre || "Sin guardia"}</span>
                </div>

                <div>
                  <strong>Equipo</strong>
                  <span>{selectedExecution.dispositivoNombre || "—"}</span>
                </div>

                <div>
                  <strong>Inicio</strong>
                  <span>{formatDate(selectedExecution.iniciadaEn)}</span>
                </div>

                <div>
                  <strong>Cierre</strong>
                  <span>{formatDate(selectedExecution.finalizadaEn)}</span>
                </div>

                <div>
                  <strong>Duración</strong>
                  <span className="duration-inline">
                    <Clock3 size={15} />
                    {calcularDuracion(
                      selectedExecution.iniciadaEn,
                      selectedExecution.finalizadaEn
                    )}
                  </span>
                </div>

                <div>
                  <strong>Puntos</strong>
                  <span>
                    {puntosCapturadosSeleccionado}/{totalPuntosSeleccionado}
                  </span>
                </div>
              </div>

              <CatalogTable
                columns={["Punto", "Comentario", "Hora", "GPS", "Foto"]}
                rows={[...selectedEvidenceSafe]
                  .sort(
                    (a, b) =>
                      Number(a?.puntoOrden || 0) -
                      Number(b?.puntoOrden || 0)
                  )
                  .map((evidencia, index) => {
                    const puntoOrden = Number(
                      evidencia?.puntoOrden || index + 1
                    );

                    const puntoNombre =
                      evidencia?.puntoNombre ||
                      evidencia?.puntoId ||
                      `Punto ${puntoOrden}`;

                    const gpsDisponible = tieneUbicacion(evidencia);
                    const fotoDisponible = tieneFoto(evidencia);

                    return [
                      `${puntoOrden}. ${puntoNombre}`,
                      evidencia?.comentario || "Sin comentario",
                      formatDate(evidencia?.capturadaEn || evidencia?.creadaEn),
                      gpsDisponible ? (
                        <span className="gps-inline">
                          <MapPin size={14} />
                          {Number(evidencia.latitud).toFixed(5)},{" "}
                          {Number(evidencia.longitud).toFixed(5)}
                        </span>
                      ) : (
                        "No disponible"
                      ),
                      fotoDisponible ? (
                        <button
                          type="button"
                          className="mini-button"
                          onClick={() => abrirFoto(evidencia)}
                        >
                          <Eye size={14} />
                          Ver foto
                        </button>
                      ) : (
                        "Sin foto"
                      ),
                    ];
                  })}
              />
            </>
          ) : (
            <div className="empty-state">
              Selecciona un recorrido para ver el detalle.
            </div>
          )}
        </div>
      </div>

      {selectedPhoto && (
        <div className="photo-modal-overlay">
          <div className="photo-modal">
            <div className="photo-modal-header">
              <div>
                <p className="eyebrow">Evidencia fotográfica</p>
                <h3>{selectedPhoto.punto}</h3>
                <span>{formatDate(selectedPhoto.fecha)}</span>
              </div>

              <button type="button" onClick={() => setSelectedPhoto(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="photo-modal-content">
              <div className="photo-preview-box">
                <div className="photo-image-loader">
                  {photoLoading && (
                    <div className="photo-loading-box">
                      Cargando fotografía...
                    </div>
                  )}

                  <img
                    src={selectedPhoto.previewUrl || selectedPhoto.url}
                    alt={selectedPhoto.punto}
                    loading="lazy"
                    onLoad={() => setPhotoLoading(false)}
                    onError={() => setPhotoLoading(false)}
                  />
                </div>
              </div>

              <div className="photo-info-box">
                <div>
                  <strong>Comentario</strong>
                  <span>{selectedPhoto.comentario}</span>
                </div>

                <div>
                  <strong>Ubicación</strong>
                  <span>
                    <MapPin size={14} />
                    {selectedPhoto.gps}
                  </span>
                </div>

                {selectedPhoto.tieneGps ? (
                  <>
                    <div className="photo-map-box">
                      <iframe
                        title={`Mapa ${selectedPhoto.punto}`}
                        src={`https://maps.google.com/maps?q=${selectedPhoto.latitud},${selectedPhoto.longitud}&z=18&output=embed`}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                      />
                    </div>

                    <a
                      className="map-open-link"
                      href={`https://www.google.com/maps?q=${selectedPhoto.latitud},${selectedPhoto.longitud}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir ubicación en Google Maps
                    </a>
                  </>
                ) : (
                  <div className="no-map-box">
                    No hay ubicación GPS disponible para esta evidencia.
                  </div>
                )}
              </div>
            </div>

            <div className="photo-modal-footer">
              <a href={selectedPhoto.url} target="_blank" rel="noreferrer">
                Abrir foto en pestaña nueva
              </a>
            </div>
          </div>
        </div>
      )}

      {generatingPdf && (
        <div className="pdf-loading-overlay">
          <div className="pdf-loading-modal">
            <div className="pdf-loading-spinner" />

            <h3>Generando PDF</h3>

            <p>
              Estamos preparando el reporte con fotografías, comentarios y
              ubicación. Esto puede tardar unos segundos.
            </p>

            <span>No cierres esta ventana.</span>
          </div>
        </div>
      )}
    </section>
  );
}