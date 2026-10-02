import jsPDF from "jspdf";

const COLORS = {
  navy: [17, 43, 60],
  blue: [31, 93, 117],
  muted: [105, 117, 134],
  border: [220, 228, 235],
  light: [246, 249, 251],
  green: [22, 133, 101],
  red: [198, 66, 66],
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function texto(value, fallback = "-") {
  const limpio = String(value || "").trim();
  return limpio || fallback;
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

  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function formatDateTime(valor) {
  const fecha = convertirAFecha(valor);

  if (!fecha) return texto(valor);

  return fecha.toLocaleString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function obtenerFechaIncidencia(incidencia) {
  return (
    incidencia?.creadaEn ||
    incidencia?.sincronizadaEn ||
    incidencia?.actualizadoEn ||
    ""
  );
}

function obtenerTipoNombre(incidencia) {
  if (incidencia?.tipoNombre) return incidencia.tipoNombre;
  if (incidencia?.tipo === "proveedor") return "Proveedor";
  if (incidencia?.tipo === "hechos_relevantes") {
    return "Informe de hechos relevantes";
  }

  return "Incidencia";
}

function obtenerFotos(incidencia) {
  const fotos = safeArray(incidencia?.fotos).filter(
    (foto) => foto?.fotoUrl || foto?.url || foto?.fotoThumbUrl
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
      label: "Firma proveedor",
      url: firmasObj.proveedor?.url || incidencia.firmaProveedorUrl,
    });
  }

  if (firmasObj.guardia?.url || incidencia?.firmaGuardiaUrl) {
    firmas.push({
      label: "Firma guardia",
      url: firmasObj.guardia?.url || incidencia.firmaGuardiaUrl,
    });
  }

  if (
    firmasObj.responsableTestigo?.url ||
    incidencia?.firmaResponsableTestigoUrl
  ) {
    firmas.push({
      label: "Firma responsable/testigo",
      url:
        firmasObj.responsableTestigo?.url ||
        incidencia.firmaResponsableTestigoUrl,
    });
  }

  return firmas;
}

function limpiarNombreArchivo(valor = "") {
  return String(valor || "incidencia")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

async function urlToDataUrl(url) {
  if (!url) return "";

  const response = await fetch(url, { mode: "cors" });

  if (!response.ok) {
    throw new Error("No fue posible cargar imagen del PDF.");
  }

  const blob = await response.blob();

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function imageFormat(dataUrl = "") {
  if (String(dataUrl).includes("image/png")) return "PNG";
  return "JPEG";
}

function addPageFooter(doc) {
  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(`Página ${page} de ${pageCount}`, 105, 286, { align: "center" });
  }
}

function ensureSpace(doc, y, neededHeight) {
  if (y + neededHeight <= 275) return y;

  doc.addPage();
  return 20;
}

function drawHeader(doc, incidencia) {
  doc.setFillColor(...COLORS.navy);
  doc.rect(0, 0, 210, 32, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Reporte de incidencia", 14, 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(obtenerTipoNombre(incidencia), 14, 23);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`Folio: ${texto(incidencia?.id)}`, 196, 15, { align: "right" });
}

function drawSectionTitle(doc, title, y) {
  y = ensureSpace(doc, y, 12);

  doc.setFillColor(...COLORS.blue);
  doc.roundedRect(14, y, 182, 9, 2, 2, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(title, 18, y + 6.2);

  return y + 15;
}

function drawField(doc, label, value, x, y, w) {
  doc.setFillColor(...COLORS.light);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(x, y, w, 18, 2, 2, "FD");

  doc.setTextColor(...COLORS.muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.text(label.toUpperCase(), x + 3, y + 6);

  doc.setTextColor(...COLORS.navy);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  const lines = doc.splitTextToSize(texto(value), w - 6).slice(0, 2);
  doc.text(lines, x + 3, y + 12);

  return y + 22;
}

function drawTextBlock(doc, label, value, y) {
  const width = 182;
  const x = 14;
  const lines = doc.splitTextToSize(texto(value), width - 8);
  const height = Math.max(24, lines.length * 5 + 15);

  y = ensureSpace(doc, y, height + 4);

  doc.setFillColor(...COLORS.light);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");

  doc.setTextColor(...COLORS.muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.text(label.toUpperCase(), x + 4, y + 7);

  doc.setTextColor(...COLORS.navy);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(lines, x + 4, y + 14);

  return y + height + 5;
}

function drawGeneralInfo(doc, incidencia, y) {
  const fecha =
    incidencia?.fecha && incidencia?.hora
      ? `${incidencia.fecha} ${incidencia.hora}`
      : formatDateTime(obtenerFechaIncidencia(incidencia));

  y = drawSectionTitle(doc, "Información general", y);

  drawField(doc, "Propiedad", incidencia?.propiedadNombre, 14, y, 88);
  drawField(doc, "Fecha y hora", fecha, 108, y, 88);
  y += 22;

  drawField(doc, "Guardia", incidencia?.guardiaNombre, 14, y, 88);
  drawField(doc, "Estado", incidencia?.estado || "abierta", 108, y, 42);
  drawField(doc, "Prioridad", incidencia?.prioridad || "media", 154, y, 42);
  y += 25;

  return y;
}

function drawCamposProveedor(doc, incidencia, y) {
  const campos = incidencia?.campos || {};

  y = drawSectionTitle(doc, "Datos de proveedor", y);

  drawField(doc, "Nombre proveedor", campos.nombreProveedor, 14, y, 88);
  drawField(doc, "Compañía", campos.compania, 108, y, 88);
  y += 22;

  drawField(doc, "Persona que visita", campos.personaQueVisita, 14, y, 88);
  drawField(doc, "Motivo", campos.motivo, 108, y, 88);
  y += 25;

  return y;
}

function drawCamposHechos(doc, incidencia, y) {
  const campos = incidencia?.campos || {};

  y = drawSectionTitle(doc, "Informe de hechos relevantes", y);

  drawField(doc, "Guardia que reporta", campos.nombreGuardiaReporta, 14, y, 88);
  drawField(doc, "Tipo de incidente", campos.tipoIncidente, 108, y, 88);
  y += 24;

  y = drawTextBlock(doc, "Descripción de los hechos", campos.descripcionHechos, y);
  y = drawTextBlock(
    doc,
    "Acción realizada por seguridad",
    campos.accionRealizadaSeguridad,
    y
  );
  y = drawTextBlock(
    doc,
    "Comentarios de los involucrados",
    campos.comentariosInvolucrados,
    y
  );

  drawField(
    doc,
    "Responsable o testigo",
    campos.nombreResponsableTestigo,
    14,
    y,
    182
  );
  y += 25;

  return y;
}

async function drawFirmas(doc, incidencia, y) {
  const firmas = obtenerFirmas(incidencia);

  y = drawSectionTitle(doc, "Firmas", y);

  if (!firmas.length) {
    return drawTextBlock(doc, "Firmas", "Sin firmas registradas.", y);
  }

  for (const firma of firmas) {
    y = ensureSpace(doc, y, 48);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...COLORS.border);
    doc.roundedRect(14, y, 182, 42, 2, 2, "FD");

    doc.setTextColor(...COLORS.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(firma.label, 18, y + 8);

    try {
      const dataUrl = await urlToDataUrl(firma.url);
      doc.addImage(dataUrl, imageFormat(dataUrl), 18, y + 12, 74, 24);
    } catch (error) {
      doc.setTextColor(...COLORS.red);
      doc.setFont("helvetica", "normal");
      doc.text("No fue posible cargar la firma.", 18, y + 22);
    }

    y += 48;
  }

  return y;
}

async function drawFotos(doc, incidencia, y) {
  const fotos = obtenerFotos(incidencia);

  y = drawSectionTitle(doc, "Fotografías", y);

  if (!fotos.length) {
    return drawTextBlock(doc, "Fotografías", "Sin fotografías registradas.", y);
  }

  for (let index = 0; index < fotos.length; index += 1) {
    const foto = fotos[index];
    const url = foto.fotoUrl || foto.url || foto.fotoThumbUrl;

    y = ensureSpace(doc, y, 78);

    const x = index % 2 === 0 ? 14 : 108;

    if (index % 2 === 0 && index > 0) {
      y += 4;
    }

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...COLORS.border);
    doc.roundedRect(x, y, 88, 70, 2, 2, "FD");

    doc.setTextColor(...COLORS.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`Foto ${index + 1}`, x + 4, y + 7);

    try {
      const dataUrl = await urlToDataUrl(url);
      doc.addImage(dataUrl, imageFormat(dataUrl), x + 4, y + 11, 80, 52);
    } catch (error) {
      doc.setTextColor(...COLORS.red);
      doc.setFont("helvetica", "normal");
      doc.text("No fue posible cargar", x + 4, y + 30);
      doc.text("la fotografía.", x + 4, y + 36);
    }

    if (index % 2 === 1) {
      y += 76;
    }
  }

  if (fotos.length % 2 === 1) {
    y += 76;
  }

  return y;
}

function drawUbicacion(doc, incidencia, y) {
  if (!incidencia?.ubicacionDisponible) return y;

  y = drawSectionTitle(doc, "Ubicación GPS", y);

  drawField(
    doc,
    "Coordenadas",
    `${incidencia.latitud}, ${incidencia.longitud}`,
    14,
    y,
    118
  );

  drawField(
    doc,
    "Precisión",
    incidencia.precisionGps ? `${incidencia.precisionGps} m` : "-",
    138,
    y,
    58
  );

  return y + 25;
}

export async function generarPdfIncidencia({ incidencia }) {
  if (!incidencia?.id) {
    throw new Error("No se encontró la incidencia.");
  }

  const doc = new jsPDF("p", "mm", "letter");

  drawHeader(doc, incidencia);

  let y = 42;

  y = drawGeneralInfo(doc, incidencia, y);

  if (incidencia.tipo === "proveedor") {
    y = drawCamposProveedor(doc, incidencia, y);
  } else if (incidencia.tipo === "hechos_relevantes") {
    y = drawCamposHechos(doc, incidencia, y);
  } else {
    y = drawTextBlock(doc, "Descripción", incidencia.descripcion, y);
  }

  y = await drawFirmas(doc, incidencia, y);
  y = await drawFotos(doc, incidencia, y);
  y = drawUbicacion(doc, incidencia, y);

  y = ensureSpace(doc, y, 20);

  doc.setTextColor(...COLORS.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    "Documento generado automáticamente desde Seguridad GMR.",
    14,
    y + 6
  );

  addPageFooter(doc);

  const nombre = limpiarNombreArchivo(
    `incidencia_${incidencia.tipo}_${incidencia.propiedadNombre}_${incidencia.id}`
  );

  doc.save(`${nombre}.pdf`);
}