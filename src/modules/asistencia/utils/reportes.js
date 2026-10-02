import { csvCell, descargarTexto } from './csv';
export function fechaTexto(value, zona = 'America/Mexico_City') {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return 'Sin registro';
  return date.toLocaleString('es-MX', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
export function duracionTexto(jornada) {
  if (jornada.minutos === null || jornada.minutos === undefined || !Number.isFinite(Number(jornada.minutos))) {
    if (jornada.estado === 'salida_pendiente') return 'Pendiente';
    if (jornada.estado === 'sin_salida') return 'Sin salida';
    return 'Turno abierto';
  }
  const min = Math.max(0, Number(jornada.minutos));
  return `${Math.floor(min / 60)} h ${Math.floor(min % 60)} min`;
}
export function estadoTexto(row) {
  if (row.estado === 'abierta') return 'Turno abierto';
  if (row.estado === 'salida_pendiente') return 'Salida pendiente';
  if (row.estado === 'sin_salida') return 'Sin salida registrada';
  if (row.estado === 'corregida') return 'Cierre manual';
  if (row.estado === 'completa') return 'Completa';
  return row.estado || 'Sin estado';
}
function fila(row) { return [row.claveEmpleado, row.empleadoNombre, row.propiedadNombre,
  fechaTexto(row.entradaEn, row.zonaHoraria), row.salidaEn ? fechaTexto(row.salidaEn, row.zonaHoraria) : 'Sin salida', duracionTexto(row), estadoTexto(row)]; }
const headers = ['Clave', 'Empleado', 'Propiedad', 'Entrada', 'Salida', 'Duracion registrada', 'Estado'];
export function exportarCsvAsistencia(rows, filtros) {
  const data = [...rows.map((r) => [...fila(r), r.entradaRegistradaPor || '', r.salidaRegistradaPor || '', r.motivoCorreccion || ''])];
  descargarTexto(`asistencia_${filtros.desde}_${filtros.hasta}.csv`,
    [[...headers, 'Cuenta entrada', 'Cuenta salida', 'Motivo de correccion'], ...data].map((r) => r.map(csvCell).join(',')).join('\r\n'));
}
export async function exportarPdfAsistencia(rows, filtros) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const margin = 28; const width = doc.internal.pageSize.getWidth(); const height = doc.internal.pageSize.getHeight();
  const widths = [56, 152, 94, 116, 116, 82, width - margin * 2 - 616];
  let y;
  function header() {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(17, 43, 60);
    doc.text('Asistencia / Eventuales - Seguridad GMR', margin, 30);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Periodo por fecha de entrada: ${filtros.desde} a ${filtros.hasta} | ${rows.length} jornadas`, margin, 48);
    doc.text('Duracion registrada, no calculo de nomina. Las jornadas sin salida no suman horas.', margin, 62);
    y = 77; let x = margin;
    doc.setFillColor(31, 93, 117); doc.rect(margin, y, width - margin * 2, 32, 'F'); doc.setTextColor(255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    headers.forEach((h, i) => { doc.text(doc.splitTextToSize(h, widths[i] - 10), x + 5, y + 12); x += widths[i]; });
    y += 32;
  }
  header();
  rows.forEach((row, index) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const lines = fila(row).map((v, i) => doc.splitTextToSize(String(v ?? '-'), widths[i] - 10));
    const rowHeight = Math.max(32, Math.max(...lines.map((l) => l.length)) * 10 + 12);
    if (y + rowHeight > height - 35) { doc.addPage(); header(); }
    doc.setFillColor(...(index % 2 ? [244, 247, 250] : [255, 255, 255]));
    doc.rect(margin, y, width - margin * 2, rowHeight, 'F'); doc.setTextColor(25, 35, 45); let x = margin;
    lines.forEach((v, i) => { doc.text(v, x + 5, y + 13); x += widths[i]; });
    y += rowHeight;
  });
  const count = doc.getNumberOfPages();
  for (let n = 1; n <= count; n++) { doc.setPage(n); doc.setFontSize(8); doc.setTextColor(100); doc.text(`Pagina ${n} de ${count}`, width - margin, height - 16, { align: 'right' }); }
  doc.save(`asistencia_${filtros.desde}_${filtros.hasta}.pdf`);
}
