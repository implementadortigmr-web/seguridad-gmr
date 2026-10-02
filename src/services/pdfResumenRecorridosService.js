import { jsPDF } from "jspdf";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
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

    if (!limpio || limpio.toLowerCase() === "invalid date") return null;

    const fecha = new Date(limpio);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  return null;
}

function formatFecha(valor) {
  const fecha = convertirAFecha(valor);

  if (!fecha) return "-";

  return fecha.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatFechaLarga(valor) {
  const fecha = convertirAFecha(valor);

  if (!fecha) return "-";

  return fecha.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatHora(valor) {
  const fecha = convertirAFecha(valor);

  if (!fecha) return "-";

  return fecha.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calcularDuracion(inicio, fin) {
  const fechaInicio = convertirAFecha(inicio);
  const fechaFin = convertirAFecha(fin);

  if (!fechaInicio || !fechaFin) return "-";

  const diferencia = fechaFin.getTime() - fechaInicio.getTime();

  if (diferencia < 0) return "-";

  const minutosTotales = Math.max(1, Math.round(diferencia / 60000));
  const horas = Math.floor(minutosTotales / 60);
  const minutos = minutosTotales % 60;

  if (horas > 0 && minutos > 0) return `${horas} h ${minutos} min`;
  if (horas > 0) return `${horas} h`;

  return `${minutos} min`;
}

function obtenerNombreRecorrido(ejecucion) {
  return (
    ejecucion?.plantillaNombre ||
    ejecucion?.recorridoNombre ||
    ejecucion?.nombre ||
    "Recorrido"
  );
}

function obtenerNombrePropiedad(ejecucion, propiedadesMap = new Map()) {
  const propiedadId = ejecucion?.propiedadId || "";

  if (
    ejecucion?.propiedadNombre &&
    ejecucion.propiedadNombre !== propiedadId
  ) {
    return ejecucion.propiedadNombre;
  }

  if (ejecucion?.propiedad && ejecucion.propiedad !== propiedadId) {
    return ejecucion.propiedad;
  }

  return propiedadesMap.get(propiedadId) || propiedadId || "Sin propiedad";
}

function obtenerTotalPuntos(ejecucion, evidenciasCount) {
  return Number(
    ejecucion?.puntosTotales ||
      ejecucion?.totalPuntos ||
      ejecucion?.puntosCompletados ||
      evidenciasCount ||
      0
  );
}

function limpiarNombreArchivo(texto = "") {
  return String(texto || "reporte")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 90);
}

function obtenerFechaReporte(ejecucion) {
  return ejecucion?.finalizadaEn || ejecucion?.iniciadaEn || "";
}

function ordenarPorFechaDesc(a, b) {
  const fechaA = convertirAFecha(obtenerFechaReporte(a))?.getTime() || 0;
  const fechaB = convertirAFecha(obtenerFechaReporte(b))?.getTime() || 0;

  return fechaB - fechaA;
}

function agruparPorPropiedad(ejecuciones, propiedadesMap) {
  const map = new Map();

  safeArray(ejecuciones).forEach((ejecucion) => {
    const propiedadId = ejecucion?.propiedadId || "sin_propiedad";
    const propiedadNombre = obtenerNombrePropiedad(ejecucion, propiedadesMap);

    if (!map.has(propiedadId)) {
      map.set(propiedadId, {
        propiedadId,
        propiedadNombre,
        ejecuciones: [],
      });
    }

    map.get(propiedadId).ejecuciones.push(ejecucion);
  });

  return [...map.values()].sort((a, b) =>
    String(a.propiedadNombre || "").localeCompare(
      String(b.propiedadNombre || ""),
      "es"
    )
  );
}

function agregarNuevaPaginaSiHaceFalta(doc, y, espacioNecesario = 20) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginBottom = 34;

  if (y + espacioNecesario <= pageHeight - marginBottom) {
    return y;
  }

  doc.addPage();
  return 42;
}

function dibujarEncabezadoPagina(doc, pageNumber, totalPages) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text("Sistema de Rondines Seguridad GMR", 36, 24);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Pagina ${pageNumber} de ${totalPages}`, pageWidth - 36, pageHeight - 18, {
    align: "right",
  });
}

function dibujarInfoBox(doc, { empresa, fechaInicio, fechaFin }) {
  const x = 36;
  let y = 74;
  const tableWidth = 720;
  const rowHeight = 25;
  const col1 = 145;
  const col2 = 250;
  const col3 = 120;
  const col4 = tableWidth - col1 - col2 - col3;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.7);
  doc.rect(x, y, tableWidth, rowHeight * 2);

  doc.line(x + col1, y, x + col1, y + rowHeight * 2);
  doc.line(x + col1 + col2, y, x + col1 + col2, y + rowHeight * 2);
  doc.line(x + col1 + col2 + col3, y, x + col1 + col2 + col3, y + rowHeight * 2);
  doc.line(x, y + rowHeight, x + tableWidth, y + rowHeight);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  doc.setFont("helvetica", "bold");
  doc.text("Nombre de empresa:", x + 6, y + 16);
  doc.text("Eventos:", x + 6, y + rowHeight + 16);
  doc.text("Fecha inicio:", x + col1 + col2 + 6, y + 16);
  doc.text("Fecha fin:", x + col1 + col2 + 6, y + rowHeight + 16);

  doc.setFont("helvetica", "normal");
  doc.text(empresa || "Todas las propiedades", x + col1 + 6, y + 16);
  doc.text("Rondines", x + col1 + 6, y + rowHeight + 16);
  doc.text(fechaInicio || "-", x + col1 + col2 + col3 + 6, y + 16);
  doc.text(fechaFin || "-", x + col1 + col2 + col3 + 6, y + rowHeight + 16);

  return y + rowHeight * 2 + 18;
}

function dibujarTitulo(doc, titulo) {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(0, 0, 0);
  doc.text(titulo, pageWidth / 2, 52, { align: "center" });
}

function dibujarSitio(doc, y, sitio) {
  const x = 36;
  const width = 720;
  const height = 28;

  y = agregarNuevaPaginaSiHaceFalta(doc, y, 48);

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(x, y, width, height);
  doc.line(x + 145, y, x + 145, y + height);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  doc.setFont("helvetica", "bold");
  doc.text("Nombre de sitio:", x + 6, y + 17);

  doc.setFont("helvetica", "normal");
  doc.text(sitio || "Sin propiedad", x + 155, y + 17);

  return y + height;
}

function dibujarHeaderTabla(doc, y) {
  const x = 36;
  const widths = [150, 180, 76, 78, 78, 74, 84];
  const headers = [
    "Nombre del empleado",
    "Evento",
    "Fecha",
    "Hora inicio",
    "Hora fin",
    "Duracion",
    "Puntos",
  ];

  const height = 22;

  y = agregarNuevaPaginaSiHaceFalta(doc, y, 40);

  doc.setFillColor(0, 0, 0);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);

  let currentX = x;

  headers.forEach((header, index) => {
    doc.rect(currentX, y, widths[index], height, "F");
    doc.text(header, currentX + widths[index] / 2, y + 14, {
      align: "center",
    });
    currentX += widths[index];
  });

  return y + height;
}

function dibujarFila(doc, y, values) {
  const x = 36;
  const widths = [150, 180, 76, 78, 78, 74, 84];
  const minHeight = 24;
  const paddingX = 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);

  const wrapped = values.map((value, index) => {
    const text = String(value ?? "-");
    return doc.splitTextToSize(text, widths[index] - paddingX * 2);
  });

  const maxLines = Math.max(...wrapped.map((lines) => lines.length));
  const rowHeight = Math.max(minHeight, maxLines * 9 + 8);

  y = agregarNuevaPaginaSiHaceFalta(doc, y, rowHeight + 8);

  let currentX = x;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.35);

  wrapped.forEach((lines, index) => {
    doc.rect(currentX, y, widths[index], rowHeight);

    const isCentered = index >= 2;
    const textX = isCentered ? currentX + widths[index] / 2 : currentX + paddingX;
    const textY = y + 10;

    doc.text(lines, textX, textY, {
      align: isCentered ? "center" : "left",
      maxWidth: widths[index] - paddingX * 2,
    });

    currentX += widths[index];
  });

  return y + rowHeight;
}

export function generarPdfResumenRecorridos({
  ejecuciones = [],
  evidenciasPorEjecucion,
  propiedadesMap = new Map(),
  filtros = {},
}) {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "letter",
  });

  const ejecucionesSafe = safeArray(ejecuciones).sort(ordenarPorFechaDesc);

  const fechaInicioTexto = filtros?.fechaInicio
    ? formatFechaLarga(`${filtros.fechaInicio}T00:00:00`)
    : "-";

  const fechaFinTexto = filtros?.fechaFin
    ? formatFechaLarga(`${filtros.fechaFin}T00:00:00`)
    : "-";

  const propiedadTexto =
    filtros?.propiedadNombre && filtros.propiedadNombre !== "Todas las propiedades"
      ? filtros.propiedadNombre
      : "Todas las propiedades";

  dibujarTitulo(doc, "Reporte general de recorridos");

  let y = dibujarInfoBox(doc, {
    empresa: propiedadTexto,
    fechaInicio: fechaInicioTexto,
    fechaFin: fechaFinTexto,
  });

  if (!ejecucionesSafe.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("No hay recorridos con los filtros seleccionados.", 36, y + 20);
  } else {
    const grupos = agruparPorPropiedad(ejecucionesSafe, propiedadesMap);

    grupos.forEach((grupo) => {
      y = dibujarSitio(doc, y, grupo.propiedadNombre);
      y = dibujarHeaderTabla(doc, y);

      grupo.ejecuciones.forEach((ejecucion) => {
        const evidencias = evidenciasPorEjecucion?.get
          ? evidenciasPorEjecucion.get(ejecucion.id) || []
          : [];

        const evidenciasCount = evidencias.length;
        const totalPuntos = obtenerTotalPuntos(ejecucion, evidenciasCount);

        y = dibujarFila(doc, y, [
          ejecucion.guardiaNombre || "Sin guardia",
          `Rondin ${obtenerNombreRecorrido(ejecucion)}`,
          formatFecha(ejecucion.iniciadaEn || ejecucion.finalizadaEn),
          formatHora(ejecucion.iniciadaEn),
          formatHora(ejecucion.finalizadaEn),
          calcularDuracion(ejecucion.iniciadaEn, ejecucion.finalizadaEn),
          `${evidenciasCount}/${totalPuntos}`,
        ]);
      });

      y += 18;
    });
  }

  const totalPages = doc.internal.getNumberOfPages();

  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    dibujarEncabezadoPagina(doc, page, totalPages);
  }

  const nombreArchivo = limpiarNombreArchivo(
    `reporte_general_rondines_${new Date().toISOString().slice(0, 10)}`
  );

  doc.save(`${nombreArchivo}.pdf`);
}