import { resumenPrenomina } from '../../shared/operacionEventuales.js';

// Carta horizontal. Este servicio solo presenta los datos: no modifica tarifas,
// necesidades, asignaciones, jornadas ni la formula de resumenPrenomina.
const W = 792;
const H = 612;
const M = 28;
const CONTENT = W - M * 2;
const C = {
  brand: [16, 40, 58],
  table: [17, 30, 50],
  accent: [31, 93, 117],
  text: [22, 38, 54],
  muted: [86, 103, 117],
  border: [207, 216, 224],
  soft: [245, 248, 250],
  total: [229, 238, 243],
  white: [255, 255, 255],
};
const cash = (n) => Number(n || 0).toLocaleString('es-MX', {
  style: 'currency', currency: 'MXN', minimumFractionDigits: 2,
});
const number = (n, decimals = 0) => Number(n || 0).toLocaleString('es-MX', {
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
});
const fecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''))
  ? String(f).split('-').reverse().join('/') : String(f || '-');
const string = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function font(doc, size, weight = 'normal', color = C.text) {
  doc.setFont('helvetica', weight);
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.setLineHeightFactor(1.15);
}

function lines(doc, value, width) {
  return doc.splitTextToSize(string(value), Math.max(12, width));
}

function weekInfo(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil((((d - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1) / 7);
  return { year, week };
}

function folioPrenomina(propiedad, inicio) {
  const code = string(propiedad?.codigo || propiedad?.id || 'GMR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8) || 'GMR';
  const semana = weekInfo(inicio);
  return semana ? `PRE-${code}-${semana.year}-S${String(semana.week).padStart(2, '0')}` : `PRE-${code}`;
}

let logoPromise;
async function cargarLogo() {
  if (logoPromise) return logoPromise;
  logoPromise = (async () => {
    if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return '';
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
    try {
      const base = import.meta.env?.BASE_URL || '/';
      const response = await fetch(`${base}brand/gmr-logo.png`, controller ? { signal: controller.signal } : {});
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
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  const value = await logoPromise;
  if (!value) logoPromise = null; // Un fallo temporal no impide reintentar el logo.
  return value;
}

function brandHeader(doc, { titulo, propiedad, subtitulo, folio = '', logo = '' }) {
  const textX = 210;
  const textW = W - M - textX;
  font(doc, 11.5, 'bold');
  const propertyLines = lines(doc, propiedad?.nombre || 'Grupo M\u00e9xico Real', textW);
  font(doc, 9);
  const subtitleLines = lines(doc, subtitulo, folio ? textW - 156 : textW);
  const extra = Math.max(0, propertyLines.length - 1) * 13.3;
  const metaY = 68 + extra;
  const height = Math.max(88 + extra, metaY + (subtitleLines.length - 1) * 10.4 + 16);
  doc.setFillColor(...C.brand);
  doc.rect(0, 0, W, height, 'F');
  let logoDrawn = false;
  if (logo) {
    try {
      const image = doc.getImageProperties(logo);
      const scale = Math.min(155 / image.width, 54 / image.height);
      const imageW = image.width * scale;
      const imageH = image.height * scale;
      doc.addImage(logo, 'PNG', M + (155 - imageW) / 2, (height - imageH) / 2,
        imageW, imageH, 'gmr-planeacion-logo', 'FAST');
      logoDrawn = true;
    } catch { /* El reporte sigue disponible aunque el logo no pueda decodificarse. */ }
  }
  if (!logoDrawn) {
    font(doc, 17, 'bold', C.white);
    doc.text('M\u00c9XICO REAL', M, height / 2 - 1);
    font(doc, 8, 'normal', C.white);
    doc.text('C O R P O R A T I V O', M, height / 2 + 16);
  }
  font(doc, 18, 'bold', C.white);
  doc.text(titulo, textX, 28);
  font(doc, 11.5, 'bold', C.white);
  doc.text(propertyLines, textX, 48);
  font(doc, 9, 'normal', C.white);
  doc.text(subtitleLines, textX, metaY);
  if (folio) {
    font(doc, 8, 'normal', C.white);
    doc.text(`Folio: ${folio}`, W - M, metaY, { align: 'right' });
  }
  return height;
}

function sectionTitle(doc, title, y) {
  font(doc, 12, 'bold');
  doc.text(title, M, y);
  return y + 14;
}

function pageNumbers(doc) {
  const count = doc.getNumberOfPages();
  for (let p = 1; p <= count; p += 1) {
    doc.setPage(p);
    font(doc, 8, 'normal', C.muted);
    doc.text(`${p} / ${count}`, W - M, H - 15, { align: 'right' });
  }
}

// Se pinta UNA banda antes de dibujar los textos. jsPDF usa el mismo estado
// grafico para texto/relleno: pintar otra celda tras text() sin restaurar color
// provocaba los encabezados oscuros e ilegibles del reporte anterior.
function tableHead(doc, columns, y, { fontSize = 9, minHeight = 30, grid = false } = {}) {
  font(doc, fontSize, 'bold', C.white);
  const wrapped = columns.map((col) => lines(doc, col.label, col.width - 12));
  const lineH = fontSize * 1.15;
  const height = Math.max(minHeight, Math.max(...wrapped.map((row) => row.length)) * lineH + 14);
  doc.setFillColor(...C.table);
  doc.rect(M, y, CONTENT, height, 'F');
  let x = M;
  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    font(doc, fontSize, 'bold', C.white);
    const align = col.headAlign || col.align || 'left';
    const tx = align === 'right' ? x + col.width - 7 : align === 'center' ? x + col.width / 2 : x + 7;
    const ty = y + (height - wrapped[i].length * lineH) / 2 + fontSize;
    doc.text(wrapped[i], tx, ty, { align });
    if (grid && i > 0) {
      doc.setDrawColor(67, 86, 104);
      doc.setLineWidth(0.35);
      doc.line(x, y, x, y + height);
    }
    x += col.width;
  }
  return y + height;
}

function tableRow(doc, columns, row, y, {
  fontSize = 10, minHeight = 28, total = false, grid = false,
} = {}) {
  font(doc, fontSize, total ? 'bold' : 'normal');
  const wrapped = columns.map((col, i) => lines(doc, row[i] ?? '', col.width - 12));
  const lineH = fontSize * 1.15;
  const height = Math.max(minHeight, Math.max(...wrapped.map((a) => a.length)) * lineH + 14);
  doc.setFillColor(...(total ? C.total : C.white));
  doc.rect(M, y, CONTENT, height, 'F');
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.4);
  let x = M;
  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    font(doc, fontSize, total ? 'bold' : 'normal');
    const align = col.align || 'left';
    const tx = align === 'right' ? x + col.width - 7 : align === 'center' ? x + col.width / 2 : x + 7;
    const ty = y + (height - wrapped[i].length * lineH) / 2 + fontSize;
    if (wrapped[i].some(Boolean)) doc.text(wrapped[i], tx, ty, { align });
    if (grid) doc.rect(x, y, col.width, height, 'S');
    x += col.width;
  }
  if (!grid) doc.line(M, y + height, W - M, y + height);
  return height;
}

function rowHeight(doc, columns, row, fontSize, minHeight) {
  font(doc, fontSize);
  const count = Math.max(...columns.map((col, i) => lines(doc, row[i] ?? '', col.width - 12).length));
  return Math.max(minHeight, count * fontSize * 1.15 + 14);
}

function reportTable(doc, columns, rows, startY, nextPage, {
  fontSize = 10, minHeight = 28, bottom = 558, totals = null,
} = {}) {
  let y = tableHead(doc, columns, startY);
  const entries = rows.map((row) => ({ row, total: false }));
  if (totals) entries.push({ row: totals, total: true });
  for (const entry of entries) {
    const height = rowHeight(doc, columns, entry.row, fontSize, minHeight);
    if (y + height > bottom) y = tableHead(doc, columns, nextPage());
    if (y + height > bottom) throw new Error('Un texto es demasiado largo para la tabla. Revisa los datos antes de imprimir.');
    y += tableRow(doc, columns, entry.row, y, { fontSize, minHeight, total: entry.total });
  }
  return y;
}

function metric(doc, x, y, width, label, value, prominent = false) {
  doc.setFillColor(...(prominent ? C.total : C.soft));
  doc.roundedRect(x, y, width, 63, 7, 7, 'F');
  font(doc, 9, 'bold', prominent ? C.accent : C.muted);
  doc.text(label, x + 14, y + 20);
  font(doc, prominent ? 23 : 21, 'bold');
  // Las cifras largas se ajustan sin invadir otra tarjeta.
  const maxWidth = width - 28;
  let size = prominent ? 23 : 21;
  while (size > 11 && doc.getTextWidth(value) > maxWidth) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  doc.text(value, x + 14, y + 47);
}

function signatures(doc, afterY, nextPage) {
  let y = Math.max(afterY + 48, 532);
  if (y + 21 > 567) y = Math.max(nextPage() + 74, 240);
  const gap = 36;
  const width = (CONTENT - gap * 2) / 3;
  ['Elabor\u00f3', 'Autoriz\u00f3', 'Recibi\u00f3 Contabilidad'].forEach((label, index) => {
    const x = M + index * (width + gap);
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.6);
    doc.line(x + 12, y, x + width - 12, y);
    font(doc, 9.5);
    doc.text(label, x + width / 2, y + 17, { align: 'center' });
  });
}

/** Dibujo puro: permite comprobar el PDF sin consultar Firebase ni alterar datos. */
export function dibujarPrenomina(doc, {
  propiedad = {}, semanaInicio, semanaFin, necesidades = [], asignaciones = [], logo = '',
} = {}) {
  const resumen = resumenPrenomina(necesidades, asignaciones);
  const t = resumen.total;
  const week = weekInfo(semanaInicio);
  const periodo = `${fecha(semanaInicio)} al ${fecha(semanaFin)}`;
  const header = () => brandHeader(doc, {
    titulo: 'Solicitud de efectivo', propiedad, logo,
    subtitulo: `Pren\u00f3mina semanal${week ? ` \u00b7 Semana ${String(week.week).padStart(2, '0')}` : ''} \u00b7 ${periodo}`,
    folio: folioPrenomina(propiedad, semanaInicio),
  });
  const next = (title) => () => {
    doc.addPage();
    return sectionTitle(doc, title, header() + 25);
  };
  const headerH = header();
  sectionTitle(doc, 'Resumen semanal', headerH + 25);
  const metricsY = headerH + 41;
  metric(doc, M, metricsY, 200, 'TURNOS REQUERIDOS', number(t.turnosRequeridos));
  metric(doc, M + 212, metricsY, 210, 'HORAS PROGRAMADAS', number(t.horas, 2));
  metric(doc, M + 434, metricsY, CONTENT - 434, 'EFECTIVO ESTIMADO', cash(t.importe), true);
  const summaryColumns = [
    { label: 'D\u00eda', width: 240 },
    { label: 'Turnos requeridos', width: 136, align: 'center' },
    { label: 'Horas programadas', width: 166, align: 'right' },
    { label: 'Importe estimado', width: 194, align: 'right' },
  ];
  const y = reportTable(doc, summaryColumns,
    resumen.dias.map((d) => [fecha(d.id), number(d.necesarios), number(d.horas, 2), cash(d.importe)]),
    metricsY + 81, next('Resumen semanal (continuaci\u00f3n)'), {
      totals: ['TOTAL SEMANAL', number(t.turnosRequeridos), number(t.horas, 2), cash(t.importe)],
      bottom: 493,
    });
  signatures(doc, y, next('Autorizaci\u00f3n de solicitud'));

  // Solo la segunda seccion solicitada. Sin anexos nominales ni datos de personas.
  const detailTitle = 'Detalle por d\u00eda, puesto y horario';
  const detailY = next(detailTitle)();
  const detailColumns = [
    { label: 'Fecha', width: 76 },
    { label: 'Puesto', width: 150 },
    { label: 'Horario citado', width: 126 },
    { label: 'Turnos\nrequeridos', width: 72, align: 'center' },
    { label: 'Horas\nprogramadas', width: 98, align: 'right' },
    { label: 'Tarifa base\npor hora', width: 100, align: 'right' },
    { label: 'Importe\nestimado', width: 114, align: 'right' },
  ];
  const detalle = [...resumen.detalle].sort((a, b) =>
    `${a.fecha}|${a.horaInicio}|${a.puestoNombre}`.localeCompare(`${b.fecha}|${b.horaInicio}|${b.puestoNombre}`, 'es'));
  reportTable(doc, detailColumns, detalle.map((n) => [
    fecha(n.fecha), n.puestoNombre || '-',
    `${n.horaInicio || '--:--'} - ${n.horaFin || '--:--'}${n.cruzaDia ? '\n(d\u00eda siguiente)' : ''}`,
    number(n.necesarios), number(n.horas, 2), cash(n.tarifaHora), cash(n.importe),
  ]), detailY, next(`${detailTitle} (continuaci\u00f3n)`), {
    fontSize: 9.5, minHeight: 26,
    totals: ['TOTAL', '', '', number(t.turnosRequeridos), number(t.horas, 2), '', cash(t.importe)],
  });
  pageNumbers(doc);
  return doc;
}

const REGISTER_COLUMNS = [
  { label: 'FECHA', width: 60, align: 'center' },
  { label: 'HORA\nCITADA', width: 60, align: 'center' },
  { label: 'NOMBRE DEL\nEVENTUAL', width: 118 },
  { label: 'HORA\nENTRADA', width: 48, align: 'center' },
  { label: 'FIRMA DEL\nEVENTUAL', width: 58, align: 'center' },
  { label: 'NOMBRE Y FIRMA\nDE SEGURIDAD', width: 68, align: 'center' },
  { label: 'FECHA\nSALIDA', width: 60, align: 'center' },
  { label: 'HORA\nSALIDA', width: 48, align: 'center' },
  { label: 'FIRMA DEL\nEVENTUAL', width: 58, align: 'center' },
  { label: 'NOMBRE Y FIRMA\nDE SEGURIDAD', width: 68, align: 'center' },
  { label: 'N\u00daM.\nFOLIO', width: 42, align: 'center' },
  { label: 'N\u00daM.\nFACTURA', width: 48, align: 'center' },
];

function registerMetadata(doc, group, evento, y) {
  const boxes = [
    { x: M, w: 438, label: 'EVENTO / SERVICIO', value: evento || '' },
    { x: M + 450, w: CONTENT - 450, label: 'PUESTO', value: group.puesto || '-' },
  ];
  font(doc, 10.5);
  const wrapped = boxes.map((box) => lines(doc, box.value, box.w - 24));
  const height = Math.max(43, Math.max(...wrapped.map((row) => row.length)) * 12.1 + 28);
  boxes.forEach((box, index) => {
    doc.setFillColor(...C.soft);
    doc.roundedRect(box.x, y, box.w, height, 5, 5, 'F');
    font(doc, 8, 'bold', C.muted);
    doc.text(box.label, box.x + 12, y + 14);
    font(doc, 10.5);
    if (box.value) doc.text(wrapped[index], box.x + 12, y + 31);
    else {
      doc.setDrawColor(...C.border);
      doc.setLineWidth(0.45);
      doc.line(box.x + 12, y + 33, box.x + box.w - 12, y + 33);
    }
  });
  return y + height + 12;
}

function registerHead(doc, y) {
  doc.setFillColor(...C.accent);
  doc.rect(M, y, CONTENT, 18, 'F');
  let x = M;
  for (const group of [
    { label: 'PROGRAMACI\u00d3N', width: 238 },
    { label: 'ENTRADA', width: 174 },
    { label: 'SALIDA', width: 234 },
    { label: 'CONTROL', width: 90 },
  ]) {
    font(doc, 8, 'bold', C.white);
    doc.text(group.label, x + group.width / 2, y + 12, { align: 'center' });
    x += group.width;
  }
  return tableHead(doc, REGISTER_COLUMNS, y + 18, { fontSize: 7.2, minHeight: 36, grid: true });
}

export function dibujarHojaRegistro(doc, {
  propiedad = {}, necesidades = [], asignaciones = [], evento = '', renglonesExtra = 2, logo = '',
} = {}) {
  const groups = new Map();
  const sorted = necesidades.filter((n) => n.activo !== false).sort((a, b) =>
    `${a.fecha}|${a.puestoNombre}|${a.horaInicio}`.localeCompare(`${b.fecha}|${b.puestoNombre}|${b.horaInicio}`, 'es'));
  for (const n of sorted) {
    const key = `${n.fecha}|${n.puestoId}`;
    const group = groups.get(key) || { fecha: n.fecha, puesto: n.puestoNombre, rows: [] };
    const people = asignaciones.filter((a) => a.necesidadId === n.id && a.activo !== false)
      .sort((a, b) => string(a.empleadoNombre).localeCompare(string(b.empleadoNombre), 'es'));
    const count = Math.max(Number(n.cantidadNecesaria || 0), people.length);
    for (let i = 0; i < count; i += 1) {
      group.rows.push([
        fecha(n.fecha), `${n.horaInicio || '--:--'}\na ${n.horaFin || '--:--'}${n.cruzaDia ? '\n(+1 d\u00eda)' : ''}`,
        people[i]?.empleadoNombre ? String(people[i].empleadoNombre).toLocaleUpperCase('es-MX') : '', '', '', '', '', '', '', '', '', '',
      ]);
    }
    groups.set(key, group);
  }
  if (!groups.size) throw new Error('No hay necesidades para imprimir.');
  const extra = Number.isFinite(Number(renglonesExtra)) ? Math.min(5, Math.max(0, Math.floor(Number(renglonesExtra)))) : 0;
  let first = true;
  for (const group of groups.values()) {
    const rows = [...group.rows, ...Array.from({ length: extra }, () => Array(12).fill(''))];
    if (!rows.length) rows.push(Array(12).fill(''));
    let index = 0;
    while (index < rows.length) {
      if (!first) doc.addPage();
      first = false;
      const headerH = brandHeader(doc, {
        titulo: 'Registro de asistencia', propiedad, logo,
        subtitulo: `Personal eventual \u00b7 ${fecha(group.fecha)}`,
      });
      const tableY = registerMetadata(doc, group, evento, headerH + 12);
      let y = registerHead(doc, tableY);
      let printed = 0;
      while (index < rows.length) {
        const height = rowHeight(doc, REGISTER_COLUMNS, rows[index], 8.6, 48);
        if (y + height > 557) break;
        tableRow(doc, REGISTER_COLUMNS, rows[index], y, { fontSize: 8.6, minHeight: 48, grid: true });
        y += height;
        index += 1;
        printed += 1;
      }
      if (!printed) throw new Error('Un nombre, puesto o evento es demasiado largo para la hoja. Revisa sus datos antes de imprimir.');
    }
  }
  pageNumbers(doc);
  return doc;
}

export async function crearHojaRegistroPDF(options) {
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), cargarLogo()]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  return dibujarHojaRegistro(doc, { ...options, logo });
}

export async function crearPrenominaPDF(options) {
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), cargarLogo()]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  return dibujarPrenomina(doc, { ...options, logo });
}
