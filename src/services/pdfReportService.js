import { jsPDF } from "jspdf";
import { formatDate } from "../utils/formatters";
import { getBlob, ref } from "firebase/storage";
import { storage } from "./firebase";


function convertirAFecha(valor) {
  if (!valor) return null;

  if (typeof valor?.toDate === "function") {
    return valor.toDate();
  }

  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function calcularDuracion(inicio, cierre) {
  const fechaInicio = convertirAFecha(inicio);
  const fechaCierre = convertirAFecha(cierre);

  if (!fechaInicio || !fechaCierre) return "Sin duración";

  const diferenciaMs = fechaCierre.getTime() - fechaInicio.getTime();

  if (diferenciaMs < 0) return "Sin duración";

  const totalMinutos = Math.max(1, Math.round(diferenciaMs / 60000));
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;

  if (horas > 0 && minutos > 0) return `${horas} h ${minutos} min`;
  if (horas > 0) return `${horas} h`;

  return `${minutos} min`;
}

function limpiarNombreArchivo(valor = "") {
  return String(valor || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 80);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No fue posible leer la imagen."));

    reader.readAsDataURL(blob);
  });
}

function obtenerDimensionesImagen(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      resolve({
        width: img.width,
        height: img.height,
      });
    };

    img.onerror = () => {
      resolve({
        width: 1,
        height: 1,
      });
    };

    img.src = dataUrl;
  });
}

async function cargarImagenEvidencia(evidencia) {
  const storagePath =
    evidencia.fotoThumbStoragePath || evidencia.fotoStoragePath || "";

  const imageUrl = evidencia.fotoThumbUrl || evidencia.fotoUrl || "";

  let blob = null;

  if (storagePath) {
    const storageRef = ref(storage, storagePath);
    blob = await getBlob(storageRef);
  } else if (imageUrl) {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error("No fue posible cargar una fotografía.");
    }

    blob = await response.blob();
  } else {
    throw new Error("La evidencia no tiene fotografía.");
  }

  const dataUrl = await blobToDataUrl(blob);
  const dimensiones = await obtenerDimensionesImagen(dataUrl);

  return {
    dataUrl,
    tipo: blob.type.includes("png") ? "PNG" : "JPEG",
    ...dimensiones,
  };
}

function agregarTextoMultilinea(doc, texto, x, y, ancho, lineHeight = 5) {
  const lineas = doc.splitTextToSize(String(texto || ""), ancho);
  doc.text(lineas, x, y);

  return y + lineas.length * lineHeight;
}

function agregarPaginaSiHaceFalta(doc, y, espacioNecesario = 60) {
  const pageHeight = doc.internal.pageSize.getHeight();

  if (y + espacioNecesario < pageHeight - 14) {
    return y;
  }

  doc.addPage();
  return 16;
}

export async function generarPdfRecorrido({ ejecucion, evidencias }) {
  if (!ejecucion) return;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "letter",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  let y = 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Reporte de recorrido", margin, y);

  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Sistema de Rondines Seguridad GMR", margin, y);

  y += 10;

  doc.setDrawColor(210, 220, 230);
  doc.line(margin, y, pageWidth - margin, y);

  y += 8;

  const datos = [
    ["Propiedad", ejecucion.propiedadNombre || ejecucion.propiedadId || "-"],
    ["Recorrido", ejecucion.plantillaNombre || "-"],
    ["Guardia", ejecucion.guardiaNombre || "-"],
    ["Equipo", ejecucion.dispositivoNombre || "-"],
    ["Inicio", formatDate(ejecucion.iniciadaEn)],
    ["Cierre", formatDate(ejecucion.finalizadaEn)],
    ["Duración", calcularDuracion(ejecucion.iniciadaEn, ejecucion.finalizadaEn)],
    [
      "Puntos",
      `${ejecucion.puntosCompletados || 0}/${ejecucion.totalPuntos || 0}`,
    ],
  ];

  doc.setFontSize(9);

  datos.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);

    const x = margin + col * (contentWidth / 2);
    const yy = y + row * 11;

    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, x, yy);

    doc.setFont("helvetica", "normal");
    doc.text(String(value || "-"), x + 24, yy);
  });

  y += 50;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Detalle de puntos", margin, y);

  y += 8;

  const evidenciasOrdenadas = [...evidencias].sort(
    (a, b) => (a.puntoOrden || 0) - (b.puntoOrden || 0)
  );

  for (const evidencia of evidenciasOrdenadas) {
  const cardHeight = 66;
  const imageBoxWidth = 48;
  const imageBoxHeight = 48;
  const imagePadding = 3;

  y = agregarPaginaSiHaceFalta(doc, y, cardHeight + 10);

  const cardX = margin;
  const cardY = y;
  const cardWidth = contentWidth;

  const imageBoxX = cardX + cardWidth - imageBoxWidth - 7;
  const imageBoxY = cardY + (cardHeight - imageBoxHeight) / 2;

  const textX = cardX + 5;
  const textWidth = cardWidth - imageBoxWidth - 22;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(220, 226, 235);
  doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 3, 3, "FD");

  let innerY = cardY + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);

  const tituloPunto = `${evidencia.puntoOrden || ""}. ${
    evidencia.puntoNombre || "Punto"
  }`;

  const tituloLineas = doc.splitTextToSize(tituloPunto, textWidth);
  doc.text(tituloLineas, textX, innerY);

  innerY += tituloLineas.length * 5 + 3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  innerY = agregarTextoMultilinea(
    doc,
    `Comentario: ${evidencia.comentario || "Sin comentario"}`,
    textX,
    innerY,
    textWidth,
    4.5
  );

  innerY += 2;

  doc.text(`Hora: ${formatDate(evidencia.capturadaEn)}`, textX, innerY);

  innerY += 6;

  const tieneGps =
    evidencia.ubicacionDisponible &&
    evidencia.latitud !== null &&
    evidencia.longitud !== null &&
    evidencia.latitud !== undefined &&
    evidencia.longitud !== undefined;

  const gpsTexto = tieneGps
    ? `${Number(evidencia.latitud).toFixed(6)}, ${Number(
        evidencia.longitud
      ).toFixed(6)}`
    : "GPS no disponible";

  doc.text(`GPS: ${gpsTexto}`, textX, innerY);

  innerY += 6;

  if (tieneGps) {
    const mapsUrl = `https://www.google.com/maps?q=${evidencia.latitud},${evidencia.longitud}`;

    doc.setTextColor(20, 90, 150);
    doc.textWithLink("Abrir ubicación en Google Maps", textX, innerY, {
      url: mapsUrl,
    });
    doc.setTextColor(0, 0, 0);
  }

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(220, 226, 235);
  doc.roundedRect(
    imageBoxX,
    imageBoxY,
    imageBoxWidth,
    imageBoxHeight,
    2,
    2,
    "FD"
  );

  if (
    evidencia.fotoThumbStoragePath ||
    evidencia.fotoStoragePath ||
    evidencia.fotoThumbUrl ||
    evidencia.fotoUrl
  ) {
    try {
      const imagen = await cargarImagenEvidencia(evidencia);

      const maxW = imageBoxWidth - imagePadding * 2;
      const maxH = imageBoxHeight - imagePadding * 2;

      const ratio = Math.min(maxW / imagen.width, maxH / imagen.height);

      const imgW = Math.max(10, imagen.width * ratio);
      const imgH = Math.max(10, imagen.height * ratio);

      const imgX = imageBoxX + (imageBoxWidth - imgW) / 2;
      const imgY = imageBoxY + (imageBoxHeight - imgH) / 2;

      doc.addImage(imagen.dataUrl, imagen.tipo, imgX, imgY, imgW, imgH);
    } catch (error) {
      console.warn("No se pudo agregar imagen al PDF:", error);

      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text("Foto no disponible", imageBoxX + 6, imageBoxY + 24);
    }
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text("Sin foto", imageBoxX + 13, imageBoxY + 24);
  }

  y += cardHeight + 8;
}

  y = agregarPaginaSiHaceFalta(doc, y, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90, 100, 115);
  doc.text(`Generado: ${formatDate(new Date().toISOString())}`, margin, y);

  const nombreArchivo = `Reporte_${limpiarNombreArchivo(
    ejecucion.propiedadNombre || ejecucion.propiedadId || "propiedad"
  )}_${limpiarNombreArchivo(
    ejecucion.plantillaNombre || "recorrido"
  )}.pdf`;

  doc.save(nombreArchivo);
}