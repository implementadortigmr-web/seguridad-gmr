const C = {
  brand: [16, 40, 58],
  text: [20, 35, 50],
  muted: [86, 103, 117],
  border: [188, 198, 207],
  soft: [244, 247, 249],
  white: [255, 255, 255],
  green: [28, 117, 84],
  red: [170, 47, 47],
  amber: [155, 105, 15],
};

const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim();
const fecha = (value) => /^\d{4}-\d{2}-\d{2}$/.test(clean(value))
  ? clean(value).split('-').reverse().join('/') : (clean(value) || '—');

function diasEntre(desde, hasta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(desde)) || !/^\d{4}-\d{2}-\d{2}$/.test(clean(hasta)) || hasta < desde) return 0;
  const start = Date.parse(`${desde}T00:00:00Z`);
  const end = Date.parse(`${hasta}T00:00:00Z`);
  return Math.floor((end - start) / 86400000) + 1;
}

function fechasEntre(desde, hasta) {
  const total = diasEntre(desde, hasta);
  if (!total) return [];
  const start = Date.parse(`${desde}T00:00:00Z`);
  return Array.from({ length: total }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
}

function fechasPartida(row = {}) {
  if (Array.isArray(row.fechas) && row.fechas.length) {
    return [...new Set(row.fechas.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(clean(value))))].sort();
  }
  return fechasEntre(row.fechaDesde || '', row.fechaHasta || '');
}

function fechasTexto(row = {}) {
  return fechasPartida(row).map(fecha).join(', ') || '—';
}

function partidasDe(req = {}) {
  if (Array.isArray(req.partidas) && req.partidas.length) return req.partidas;
  if (!req.puestoId && !req.puestoNombre) return [];
  return [{
    partidaId: 'legacy_1',
    puestoId: req.puestoId || '',
    puestoNombre: req.puestoNombre || '',
    horarioId: req.horarioId || '',
    horarioNombre: req.horarioNombre || '',
    horaInicio: req.horaInicio || '',
    horaFin: req.horaFin || '',
    cantidadPersonas: Number(req.cantidadPersonas || 0),
    fechaDesde: req.fechaDesde || '',
    fechaHasta: req.fechaHasta || '',
    fechas: fechasEntre(req.fechaDesde || '', req.fechaHasta || ''),
  }];
}

let logoPromise;
async function cargarLogo() {
  if (logoPromise) return logoPromise;
  logoPromise = (async () => {
    try {
      const base = import.meta.env?.BASE_URL || '/';
      const response = await fetch(`${base}brand/gmr-logo.png`);
      if (!response.ok) return '';
      const blob = await response.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  })();
  const value = await logoPromise;
  if (!value) logoPromise = null;
  return value;
}

function font(doc, size, weight = 'normal', color = C.text) {
  doc.setFont('helvetica', weight);
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.setLineHeightFactor(1.15);
}

function lines(doc, value, width) {
  return doc.splitTextToSize(clean(value) || '—', Math.max(20, width));
}

function statusLabel(value) {
  if (value === 'autorizada') return 'AUTORIZADA';
  if (value === 'rechazada') return 'RECHAZADA';
  return 'PENDIENTE';
}

function statusColor(value) {
  if (value === 'autorizada') return C.green;
  if (value === 'rechazada') return C.red;
  return C.amber;
}

function drawHeader(doc, req, logo) {
  const W = doc.internal.pageSize.getWidth();
  const M = 32;
  doc.setFillColor(...C.brand);
  doc.rect(0, 0, W, 104, 'F');

  let logoDrawn = false;
  if (logo) {
    try {
      const image = doc.getImageProperties(logo);
      const scale = Math.min(150 / image.width, 48 / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      doc.addImage(logo, 'PNG', M, 26, w, h, 'gmr-requisicion-logo', 'FAST');
      logoDrawn = true;
    } catch { /* fallback textual */ }
  }
  if (!logoDrawn) {
    font(doc, 15, 'bold', C.white);
    doc.text('MÉXICO REAL', M, 45);
    font(doc, 7.5, 'normal', C.white);
    doc.text('C O R P O R A T I V O', M, 60);
  }

  font(doc, 17, 'bold', C.white);
  doc.text('REQUISICIÓN DE PERSONAL', 205, 37);
  font(doc, 10, 'bold', C.white);
  doc.text(clean(req.propiedadNombre) || 'Grupo México Real', 205, 57);
  font(doc, 8.5, 'normal', C.white);
  doc.text(`Folio: ${clean(req.folio) || 'Pendiente'}`, W - M, 36, { align: 'right' });
  doc.text(`Fecha de elaboración: ${fecha(String(req.creadoEn || '').slice(0, 10))}`, W - M, 53, { align: 'right' });

  const color = statusColor(req.estado);
  doc.setFillColor(...color);
  doc.roundedRect(W - M - 102, 67, 102, 21, 5, 5, 'F');
  font(doc, 8.5, 'bold', C.white);
  doc.text(statusLabel(req.estado), W - M - 51, 81, { align: 'center' });
  return 124;
}

function continuationHeader(doc, req) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...C.brand);
  doc.rect(0, 0, W, 50, 'F');
  font(doc, 11, 'bold', C.white);
  doc.text('REQUISICIÓN DE PERSONAL · DETALLE', 32, 30);
  font(doc, 8, 'normal', C.white);
  doc.text(`${clean(req.folio) || 'Sin folio'} · ${clean(req.propiedadNombre) || 'Grupo México Real'}`, W - 32, 30, { align: 'right' });
  return 68;
}

function sectionBand(doc, title, y) {
  const W = doc.internal.pageSize.getWidth();
  const M = 32;
  doc.setFillColor(...C.soft);
  doc.setDrawColor(...C.border);
  doc.rect(M, y, W - M * 2, 22, 'FD');
  font(doc, 8.5, 'bold');
  doc.text(title.toUpperCase(), W / 2, y + 14, { align: 'center' });
  return y + 22;
}

function rowFields(doc, fields, y, height = 42) {
  const W = doc.internal.pageSize.getWidth();
  const M = 32;
  const total = W - M * 2;
  const width = total / fields.length;
  fields.forEach((field, index) => {
    const x = M + width * index;
    doc.setDrawColor(...C.border);
    doc.rect(x, y, width, height);
    font(doc, 6.8, 'bold', C.muted);
    doc.text(clean(field.label).toUpperCase(), x + 7, y + 11);
    font(doc, 9, field.bold ? 'bold' : 'normal');
    const valueLines = lines(doc, field.value, width - 14).slice(0, 3);
    doc.text(valueLines, x + 7, y + 25);
  });
  return y + height;
}

function narrative(doc, label, value, y, minHeight = 48) {
  const W = doc.internal.pageSize.getWidth();
  const M = 32;
  const content = lines(doc, value, W - M * 2 - 16);
  const height = Math.max(minHeight, 30 + content.length * 10.5);
  doc.setDrawColor(...C.border);
  doc.rect(M, y, W - M * 2, height);
  font(doc, 6.8, 'bold', C.muted);
  doc.text(clean(label).toUpperCase(), M + 8, y + 12);
  font(doc, 9, 'normal');
  doc.text(content, M + 8, y + 28);
  return y + height;
}

function drawDetailHeader(doc, y) {
  const M = 32;
  const widths = [125, 120, 115, 55, 45, 88];
  const labels = ['DÍAS SOLICITADOS', 'PUESTO', 'HORARIO', 'PERSONAS', 'DÍAS', 'TURNOS-PERSONA'];
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);

  // Pintar la banda completa ANTES de escribir cualquier texto.
  // jsPDF comparte el estado gráfico y, si se pinta celda por celda después
  // de cambiar el color del texto, las siguientes celdas pueden quedar blancas.
  doc.setFillColor(...C.brand);
  doc.rect(M, y, totalWidth, 24, 'F');

  let x = M;
  widths.forEach((width, index) => {
    font(doc, 6.5, 'bold', C.white);
    doc.text(labels[index], x + width / 2, y + 15, { align: 'center', maxWidth: width - 6 });
    if (index > 0) {
      doc.setDrawColor(67, 86, 104);
      doc.setLineWidth(0.35);
      doc.line(x, y, x, y + 24);
    }
    x += width;
  });
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.4);
  doc.rect(M, y, totalWidth, 24, 'S');
  return { y: y + 24, widths };
}

function drawDetailRow(doc, row, y, widths) {
  const M = 32;
  const days = fechasPartida(row).length;
  const values = [
    fechasTexto(row),
    row.puestoNombre || '—',
    `${row.horaInicio || ''} - ${row.horaFin || ''}${row.horarioNombre ? ` · ${row.horarioNombre}` : ''}`,
    String(Number(row.cantidadPersonas || 0)),
    String(days),
    String(days * Number(row.cantidadPersonas || 0)),
  ];
  const wrapped = values.map((value, index) => lines(doc, value, widths[index] - 10));
  const maxLines = Math.max(...wrapped.map((item) => item.length), 1);
  const height = Math.max(27, 13 + maxLines * 9);
  let x = M;
  widths.forEach((width, index) => {
    doc.setDrawColor(...C.border);
    doc.rect(x, y, width, height);
    font(doc, 7.2, index === 1 ? 'bold' : 'normal');
    doc.text(wrapped[index], x + (index >= 3 ? width / 2 : 5), y + 15, { align: index >= 3 ? 'center' : 'left', maxWidth: width - 10 });
    x += width;
  });
  return y + height;
}

function drawDetailTable(doc, req, partidas, y) {
  let header = drawDetailHeader(doc, y);
  y = header.y;
  let widths = header.widths;
  for (const row of partidas) {
    const days = fechasPartida(row).length;
    const previewLines = Math.max(
      lines(doc, fechasTexto(row), widths[0] - 10).length,
      lines(doc, row.puestoNombre || '—', widths[1] - 10).length,
      lines(doc, `${row.horaInicio || ''} - ${row.horaFin || ''}${row.horarioNombre ? ` · ${row.horarioNombre}` : ''}`, widths[2] - 10).length,
      1
    );
    const needed = Math.max(27, 13 + previewLines * 9);
    if (y + needed > 710) {
      doc.addPage();
      y = continuationHeader(doc, req);
      y = sectionBand(doc, 'Detalle solicitado (continuación)', y);
      header = drawDetailHeader(doc, y);
      y = header.y;
      widths = header.widths;
    }
    y = drawDetailRow(doc, { ...row, diasSolicitados: days }, y, widths);
  }
  return y;
}

function signatures(doc, req, y) {
  const W = doc.internal.pageSize.getWidth();
  const M = 46;
  const gap = 24;
  const width = (W - M * 2 - gap * 2) / 3;
  const items = [
    { label: 'SOLICITA', name: req.solicitanteNombre || '', role: 'Jefe / Gerente de área' },
    { label: 'AUTORIZA', name: req.autorizadoPorNombre || '', role: 'Gerencia / Responsable autorizado' },
    { label: 'Vo. Bo.', name: req.estado === 'autorizada' ? (req.autorizadoPorNombre || '') : '', role: 'Capital Humano' },
  ];
  items.forEach((item, index) => {
    const x = M + index * (width + gap);
    font(doc, 7.5, 'bold', C.muted);
    doc.text(item.label, x + width / 2, y, { align: 'center' });
    doc.setDrawColor(...C.text);
    doc.line(x, y + 43, x + width, y + 43);
    font(doc, 7.5, 'bold');
    doc.text(clean(item.name) || 'Nombre y firma', x + width / 2, y + 55, { align: 'center', maxWidth: width });
    font(doc, 6.5, 'normal', C.muted);
    doc.text(item.role, x + width / 2, y + 67, { align: 'center', maxWidth: width });
  });
}

export async function crearRequisicionPersonalPDF(requisicion = {}) {
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), cargarLogo()]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const partidas = partidasDe(requisicion);
  const turnosPersona = partidas.reduce((sum, row) => sum + Number(row.cantidadPersonas || 0) * fechasPartida(row).length, 0);
  let y = drawHeader(doc, requisicion, logo);
  y = sectionBand(doc, 'Datos generales', y);
  y = rowFields(doc, [
    { label: 'Departamento solicitante', value: requisicion.departamentoSolicitante },
    { label: 'Forma de pago', value: requisicion.formaPago || 'Efectivo' },
  ], y, 43);
  y = rowFields(doc, [
    { label: 'Necesidades / renglones', value: partidas.length, bold: true },
    { label: 'Turnos-persona solicitados', value: turnosPersona, bold: true },
  ], y, 40);
  y = sectionBand(doc, 'Motivo', y);
  y = narrative(doc, 'Motivo', requisicion.motivo, y, 39);
  y = narrative(doc, 'Descripción de la causa', requisicion.descripcionCausa, y, 48);
  y = sectionBand(doc, 'Detalle solicitado', y);
  y = drawDetailTable(doc, requisicion, partidas, y);

  if (y > 650) {
    doc.addPage();
    y = continuationHeader(doc, requisicion);
  } else {
    y += 12;
  }
  y = sectionBand(doc, 'Personal propuesto', y);
  y = narrative(doc, 'Nombres de las personas requeridas / propuestas', requisicion.personasPropuestas || 'N/A', y, 44);

  if (requisicion.estado === 'rechazada' && requisicion.motivoRechazo) {
    y = narrative(doc, 'Motivo de rechazo', requisicion.motivoRechazo, y + 8, 42);
  }
  const signatureY = Math.max(y + 30, 610);
  if (signatureY > 690) {
    doc.addPage();
    continuationHeader(doc, requisicion);
    signatures(doc, requisicion, 160);
  } else {
    signatures(doc, requisicion, signatureY);
  }

  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page += 1) {
    doc.setPage(page);
    font(doc, 7, 'normal', C.muted);
    doc.text(`SEGURIDAD GMR · Requisición de personal · ${clean(requisicion.folio) || 'Sin folio'}`, 32, 770);
    doc.text(`${page} / ${count}`, 580, 770, { align: 'right' });
  }
  return doc;
}
