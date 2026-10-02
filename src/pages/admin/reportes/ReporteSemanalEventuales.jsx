import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCcw,
  Save,
} from 'lucide-react';
import DataLoadingState from '../../../components/DataLoadingState';
import FormModal from '../../../components/admin/FormModal';
import { useAuth } from '../../../context/AuthContext';
import { useFeedback } from '../../../context/FeedbackContext';
import {
  exportarTodasJornadas,
  listarPersonal,
  llamarAsistencia,
  mensajeAsistencia,
} from '../../../modules/asistencia/services/asistenciaService';
import MessageBox from '../../../components/MessageBox';
import { PERMISOS, tienePermiso } from '../../../../shared/perfilesAcceso';
import {
  dinero,
  folioSolicitudEventuales,
  horaTexto,
  rangoSemanaISO,
  resumirSemanaEventuales,
  semanaISOActual,
} from '../../../modules/asistencia/utils/eventualesNomina';

function numero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fechaCorta(value) {
  const [y, m, d] = String(value).split('-');
  return `${d}/${m}`;
}

function estadoRegistro(jornada) {
  if (jornada?.estado === 'sin_salida') {
    return jornada?.resueltoAdministrativamente
      ? 'Sin salida registrada · resuelto por RH'
      : 'Sin salida registrada';
  }
  if (jornada?.estado === 'salida_pendiente') return 'Salida pendiente';
  if (jornada?.estado === 'abierta') return 'Turno abierto';
  if (jornada?.estado === 'corregida') return 'Corregido';
  if (jornada?.estado === 'completa') return 'Completo';
  return jornada?.estado || 'Pendiente de salida/corrección';
}

function puedeResolverRegistro(jornada) {
  return !jornada?.salidaEn && ['salida_pendiente', 'sin_salida'].includes(jornada?.estado);
}

async function cargarLogoDataUrl() {
  try {
    const response = await fetch('/brand/gmr-logo.png');
    if (!response.ok) return '';
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

function prepararFilas(rows, people) {
  const personal = new Map((people || []).map((item) => [item.id, item]));
  return (rows || []).map((row) => {
    const person = personal.get(row.empleadoId);
    return {
      ...row,
      area: row.area || person?.area || '',
      puestoNombre: row.puestoNombre || person?.puestoNombre || '',
      tarifaHoraAplicada: Number(
        row.tarifaHoraAplicada
        ?? person?.tarifaPersonalizada
        ?? person?.tarifaBase
        ?? 0
      ),
    };
  });
}

async function pdfSolicitud({ propiedad, rango, summary, control, folio }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 28;
  const logo = await cargarLogoDataUrl();

  const headerH = 78;
  doc.setFillColor(16, 40, 58);
  doc.rect(0, 0, W, headerH, 'F');
  if (logo) doc.addImage(logo, 'PNG', margin, 18, 155, 38, undefined, 'FAST');

  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(`Solicitud de efectivo · ${propiedad.nombre}`, 210, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Eventuales · Semana ${String(rango.week).padStart(2, '0')} · ${rango.desde} a ${rango.hasta}`, 210, 49);
  doc.text(`Folio: ${folio}`, W - margin, 49, { align: 'right' });

  const headers = [
    'EVENTUAL', 'PUESTO', 'ÁREA', 'DÍAS',
    ...rango.dias.map((d) => String(Number(d.slice(8)))),
    'NORMAL', 'H. EXTRA', 'TOTAL',
  ];
  const usable = W - margin * 2;
  const widths = [132, 58, 78, 30, ...rango.dias.map(() => 38), 64, 60, 70];
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const scale = usable / totalWidth;
  const sw = widths.map((value) => value * scale);
  const tableWidth = sw.reduce((a, b) => a + b, 0);
  const textColumns = new Set([0, 1, 2]);
  let y = 98;

  function drawHeader() {
    let x = margin;
    doc.setFillColor(17, 30, 50);
    doc.roundedRect(margin, y, tableWidth, 27, 4, 4, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.1);
    headers.forEach((header, index) => {
      const center = x + sw[index] / 2;
      doc.text(String(header), textColumns.has(index) ? x + 4 : center, y + 17, {
        align: textColumns.has(index) ? 'left' : 'center',
        maxWidth: sw[index] - 8,
      });
      x += sw[index];
    });
    y += 27;
  }

  function dailyMoney(value) {
    if (!Number(value)) return '-';
    return dinero(value);
  }

  drawHeader();

  const body = summary.personas.map((person) => [
    person.nombre,
    person.puesto,
    person.area || '-',
    person.dias,
    ...rango.dias.map((date) => dailyMoney(person.fechas[date])),
    dinero(person.pagoNormal),
    dinero(person.pagoExtra),
    dinero(person.total),
  ]);

  body.push([
    'TOTAL GENERAL', '', '', summary.totals.dias,
    ...rango.dias.map((date) => dailyMoney(summary.totals.fechas[date])),
    dinero(summary.totals.pagoNormal),
    dinero(summary.totals.pagoExtra),
    dinero(summary.totals.total),
  ]);

  body.forEach((row, rowIndex) => {
    const isTotal = rowIndex === body.length - 1;
    const textLines = row.map((value, index) => textColumns.has(index)
      ? doc.splitTextToSize(String(value ?? '-'), Math.max(18, sw[index] - 8))
      : [String(value ?? '-')]);
    const maxLines = Math.max(1, ...textLines.slice(0, 3).map((lines) => lines.length));
    const rowHeight = Math.max(25, maxLines * 8 + 9);

    if (y + rowHeight > H - 145) {
      doc.addPage();
      y = 32;
      drawHeader();
    }

    doc.setFillColor(...(isTotal ? [230, 236, 242] : rowIndex % 2 ? [248, 250, 252] : [255, 255, 255]));
    doc.rect(margin, y, tableWidth, rowHeight, 'F');
    doc.setDrawColor(226, 231, 236);
    doc.line(margin, y + rowHeight, margin + tableWidth, y + rowHeight);
    doc.setTextColor(22, 38, 54);
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal');

    let x = margin;
    row.forEach((value, index) => {
      if (textColumns.has(index)) {
        doc.setFontSize(7.1);
        doc.text(textLines[index], x + 4, y + 11);
      } else {
        doc.setFontSize(index === 3 ? 7.2 : 6.7);
        doc.text(String(value ?? '-'), x + sw[index] - 4, y + 15, { align: 'right' });
      }
      x += sw[index];
    });
    y += rowHeight;
  });

  const requested = numero(control.solicitado);
  const paid = numero(control.pagado);
  const balance = Math.max(0, requested - paid);
  const boxY = Math.min(H - 150, y + 18);
  const leftW = 250;
  const gap = 18;
  const rightX = margin + leftW + gap;
  const rightW = W - margin - rightX;

  doc.setFillColor(246, 248, 250);
  doc.roundedRect(margin, boxY, leftW, 84, 8, 8, 'F');
  doc.roundedRect(rightX, boxY, rightW, 84, 8, 8, 'F');
  doc.setTextColor(17, 43, 60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('Control de efectivo', margin + 12, boxY + 19);
  doc.text('Comentarios', rightX + 12, boxY + 19);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Solicitado: ${dinero(requested)}`, margin + 12, boxY + 40);
  doc.text(`Pagado: ${dinero(paid)}`, margin + 12, boxY + 57);
  doc.text(`Sobrante: ${dinero(balance)}`, margin + 12, boxY + 74);
  doc.text(doc.splitTextToSize(control.comentarios || '-', rightW - 24), rightX + 12, boxY + 39);

  const signaturesY = H - 28;
  doc.setDrawColor(150, 160, 170);
  doc.line(margin + 45, signaturesY - 12, margin + 210, signaturesY - 12);
  doc.line(W - margin - 210, signaturesY - 12, W - margin - 45, signaturesY - 12);
  doc.setTextColor(95, 105, 115);
  doc.setFontSize(8);
  doc.text('Elaboró', margin + 128, signaturesY, { align: 'center' });
  doc.text('Autorizó', W - margin - 128, signaturesY, { align: 'center' });

  doc.save(`solicitud_efectivo_${folio}.pdf`);
}

async function pdfRecibos({ propiedad, rango, summary, folio }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const logo = await cargarLogoDataUrl();

  function drawReceipt(person, top, height) {
    const x = 28;
    const width = W - 56;
    doc.setDrawColor(210, 214, 219);
    doc.roundedRect(x, top, width, height, 10, 10, 'S');

    doc.setFillColor(16, 40, 58);
    doc.roundedRect(x, top, width, 58, 10, 10, 'F');
    doc.rect(x, top + 48, width, 10, 'F');
    if (logo) doc.addImage(logo, 'PNG', x + 16, top + 14, 145, 30, undefined, 'FAST');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(propiedad.nombre, x + 178, top + 27);
    doc.setFontSize(8.5);
    doc.text(`Folio: ${folio}`, x + width - 16, top + 27, { align: 'right' });

    doc.setTextColor(30, 35, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.text(person.nombre, W / 2, top + 82, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(`Puesto: ${person.puesto}`, x + 15, top + 105);
    doc.text(`Semana: ${rango.week}`, x + 190, top + 105);
    doc.text(`Periodo: ${rango.desde} a ${rango.hasta}`, x + 300, top + 105);

    const cols = ['Fecha', 'Entrada', 'Salida', 'Horas pagables', 'Tarifa', 'Pago'];
    const widths = [95, 75, 75, 85, 78, 92];
    let y = top + 122;
    let cx = x + 15;
    doc.setFillColor(183, 86, 74);
    doc.rect(cx, y, widths.reduce((a, b) => a + b, 0), 22, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    cols.forEach((c, i) => { doc.text(c, cx + 5, y + 14); cx += widths[i]; });
    y += 22;

    const jornadas = [...person.jornadas].sort((a, b) => String(a.fechaJornada).localeCompare(String(b.fechaJornada)));
    const maxRows = 5;
    jornadas.slice(0, maxRows).forEach((row, idx) => {
      const calc = row.calculoPago;
      cx = x + 15;
      const values = [
        row.fechaJornada || '-',
        horaTexto(row.entradaEn, row.zonaHoraria),
        row.salidaEn ? horaTexto(row.salidaEn, row.zonaHoraria) : '-',
        calc.pendiente ? '-' : calc.horasPagables.toFixed(2),
        dinero(calc.tarifa),
        calc.pendiente ? '-' : dinero(calc.total),
      ];
      doc.setFillColor(...(idx % 2 ? [248, 248, 248] : [238, 235, 230]));
      doc.rect(cx, y, widths.reduce((a, b) => a + b, 0), 20, 'F');
      doc.setTextColor(45, 45, 45);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      values.forEach((v, i) => { doc.text(String(v), cx + 5, y + 13); cx += widths[i]; });
      y += 20;
    });

    if (jornadas.length > maxRows) {
      doc.setTextColor(100);
      doc.setFontSize(7.5);
      doc.text(`+ ${jornadas.length - maxRows} registros adicionales incluidos en el total semanal.`, x + 15, y + 11);
      y += 15;
    }

    const boxY = top + height - 108;
    doc.setFillColor(238, 235, 230);
    doc.roundedRect(x + 15, boxY, width - 30, 58, 6, 6, 'F');
    doc.setTextColor(45, 45, 45);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Días: ${person.dias}`, x + 28, boxY + 20);
    doc.text(`Horas: ${person.horasPagables.toFixed(2)}`, x + 130, boxY + 20);
    doc.text(`Normales: ${person.horasNormales.toFixed(2)}`, x + 250, boxY + 20);
    doc.text(`Extra: ${person.horasExtra.toFixed(2)}`, x + 390, boxY + 20);
    doc.text(`Sueldo: ${dinero(person.pagoNormal)}`, x + 28, boxY + 42);
    doc.text(`Horas extra: ${dinero(person.pagoExtra)}`, x + 210, boxY + 42);
    doc.setTextColor(183, 72, 58);
    doc.text(`Total a pagar: ${dinero(person.total)}`, x + 382, boxY + 42);

    doc.setDrawColor(180);
    doc.line(x + 45, top + height - 20, x + 220, top + height - 20);
    doc.line(x + width - 220, top + height - 20, x + width - 45, top + height - 20);
    doc.setTextColor(80);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Firma del empleado', x + 132, top + height - 7, { align: 'center' });
    doc.text('Firma de autorización', x + width - 132, top + height - 7, { align: 'center' });
  }

  const receiptHeight = 350;
  summary.personas.forEach((person, index) => {
    const slot = index % 2;
    if (index > 0 && slot === 0) doc.addPage();
    drawReceipt(person, 25 + slot * 365, receiptHeight);
  });

  doc.save(`recibos_eventuales_${rango.desde}_a_${rango.hasta}.pdf`);
}

function descargarCsv({ propiedad, rango, summary, folio }) {
  const headers = ['Folio', 'Eventual', 'Puesto', 'Area', 'Dias', ...rango.dias, 'Horas normales', 'Horas extra', 'Pago normal', 'Pago extra', 'Total final', 'Pendientes'];
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(',')];
  summary.personas.forEach((p) => {
    lines.push([
      folio,
      p.nombre,
      p.puesto,
      p.area || '',
      p.dias,
      ...rango.dias.map((d) => (p.fechas[d] || 0).toFixed(2)),
      p.horasNormales.toFixed(2),
      p.horasExtra.toFixed(2),
      p.pagoNormal.toFixed(2),
      p.pagoExtra.toFixed(2),
      p.total.toFixed(2),
      p.pendientes,
    ].map(escape).join(','));
  });
  const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `eventuales_${propiedad.codigo || propiedad.id}_${rango.desde}_${rango.hasta}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ReporteSemanalEventuales({ propiedad }) {
  const { profile } = useAuth();
  const feedback = useFeedback();
  const [weekValue, setWeekValue] = useState(() => semanaISOActual());
  const [rows, setRows] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [control, setControl] = useState({ solicitado: '', pagado: '', comentarios: '' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [resolver, setResolver] = useState(null);
  const [resolverModo, setResolverModo] = useState('sin_salida');
  const [resolverSalida, setResolverSalida] = useState('');
  const [resolverMotivo, setResolverMotivo] = useState('');
  const [resolverBusy, setResolverBusy] = useState(false);

  const puedeResolverTurnos = profile?.rol === 'administrador'
    || tienePermiso(profile, PERMISOS.RESOLVER_TURNOS_EVENTUALES);

  const rango = useMemo(() => rangoSemanaISO(weekValue), [weekValue]);
  const folio = useMemo(() => folioSolicitudEventuales(propiedad, rango), [propiedad, rango]);
  const preparedRows = useMemo(() => prepararFilas(rows, people), [rows, people]);
  const summary = useMemo(() => resumirSemanaEventuales(preparedRows, rango), [preparedRows, rango]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessage('');
    Promise.all([
      exportarTodasJornadas({
        propiedadId: propiedad.id,
        desde: rango.desde,
        hasta: rango.hasta,
        empleadoId: '',
        estado: '',
        tipoPersonal: 'eventual',
      }),
      listarPersonal(propiedad.id, 'eventual'),
    ])
      .then(([jornadas, personal]) => {
        if (!alive) return;
        setRows(jornadas);
        setPeople(personal);
      })
      .catch((error) => {
        if (alive) setMessage(mensajeAsistencia(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [propiedad.id, rango.desde, rango.hasta, refreshKey]);

  function abrirResolverTurno(jornada, persona) {
    setResolver({
      ...jornada,
      empleadoNombre: jornada.empleadoNombre || persona.nombre,
      puestoNombre: jornada.puestoNombre || persona.puesto,
    });
    const modo = jornada.estado === 'sin_salida' ? 'corregir_salida' : 'sin_salida';
    setResolverModo(modo);
    setResolverSalida('');
    setResolverMotivo(
      modo === 'sin_salida'
        ? 'El eventual no registró su salida y RH resolvió el pendiente.'
        : ''
    );
  }

  function cerrarResolverTurno(force = false) {
    if (resolverBusy && !force) return;
    setResolver(null);
    setResolverSalida('');
    setResolverMotivo('');
    setResolverModo('sin_salida');
  }

  async function resolverTurno(event) {
    event.preventDefault();
    if (!resolver || resolverBusy) return;

    const motivo = resolverMotivo.trim();
    if (motivo.length < 10) {
      feedback.warning('Escribe un motivo de al menos 10 caracteres.');
      return;
    }

    let salidaIso = '';
    if (resolverModo === 'corregir_salida') {
      const parsed = new Date(resolverSalida);
      if (!Number.isFinite(parsed.getTime())) {
        feedback.warning('Captura la fecha y hora real de salida.');
        return;
      }
      salidaIso = parsed.toISOString();
    }

    const confirmada = await feedback.confirm({
      type: 'warning',
      title: resolverModo === 'corregir_salida' ? 'Confirmar salida corregida' : 'Confirmar sin salida registrada',
      message: resolverModo === 'corregir_salida'
        ? 'Se guardará la hora real indicada, se recalcularán las horas y el pago, y quedará auditoría del cambio.'
        : 'El turno dejará de aparecer a Seguridad como pendiente. No se inventará una hora de salida y no generará pago hasta que se corrija.',
      confirmText: 'Resolver turno',
      cancelText: 'Cancelar',
    });
    if (!confirmada) return;

    setResolverBusy(true);
    try {
      await llamarAsistencia('asistenciaResolverTurnoAdministrativo', {
        jornadaId: resolver.id,
        accion: resolverModo,
        salidaIso,
        motivo,
      });
      cerrarResolverTurno(true);
      setRefreshKey((value) => value + 1);
      feedback.success(
        resolverModo === 'corregir_salida'
          ? 'La salida fue corregida y el pago semanal se recalculará.'
          : 'El turno quedó como sin salida registrada y ya no aparecerá pendiente para Seguridad.'
      );
    } catch (error) {
      feedback.error(mensajeAsistencia(error));
    } finally {
      setResolverBusy(false);
    }
  }

  const solicitado = control.solicitado === '' ? summary.totals.total : numero(control.solicitado);
  const sobrante = Math.max(0, solicitado - numero(control.pagado));

  return (
    <section className="weekly-eventuales-report">
      <div className="weekly-report-header">
        <div>
          <span className="asistencia-eyebrow">Pago semanal</span>
          <h2>Eventuales · {propiedad.nombre}</h2>
          <p>La semana se calcula de lunes a domingo. Los turnos sin salida no generan pago hasta ser corregidos.</p>
        </div>
        <CalendarDays size={28} />
      </div>

      <div className="weekly-report-toolbar">
        <label>
          Semana
          <input type="week" value={weekValue} onChange={(e) => { setWeekValue(e.target.value); setControl({ solicitado: '', pagado: '', comentarios: '' }); }} />
        </label>
        <div className="weekly-folio">
          <span>Folio</span>
          <strong>{folio}</strong>
          <small>{rango.desde} a {rango.hasta}</small>
        </div>
        <button type="button" className="secondary-button" onClick={() => setWeekValue(semanaISOActual())}>
          <RefreshCcw size={16} /> Semana actual
        </button>
      </div>

      {message && <MessageBox>{message}</MessageBox>}

      {loading ? (
        <DataLoadingState title="Calculando semana..." detail="Consultando jornadas, puestos y tarifas de eventuales." />
      ) : (
        <>
          <div className="weekly-kpis">
            <div><span>Eventuales</span><strong>{summary.personas.length}</strong></div>
            <div><span>Horas pagables</span><strong>{summary.totals.horasPagables.toFixed(0)} h</strong></div>
            <div><span>Horas extra</span><strong>{summary.totals.horasExtra.toFixed(0)} h</strong></div>
            <div><span>Total semanal</span><strong>{dinero(summary.totals.total)}</strong></div>
            <div className={summary.totals.pendientes ? 'warning' : ''}><span>Turnos pendientes</span><strong>{summary.totals.pendientes}</strong></div>
          </div>

          <div className="weekly-table-wrap">
            <table className="weekly-table">
              <thead>
                <tr>
                  <th>Eventual</th>
                  <th>Puesto</th>
                  <th>Área</th>
                  <th>Días</th>
                  {rango.dias.map((d) => <th key={d}>{fechaCorta(d)}</th>)}
                  <th>Normal</th>
                  <th>H. extra</th>
                  <th>Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {summary.personas.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.nombre}</strong></td>
                    <td>{p.puesto}</td>
                    <td>{p.area || '-'}</td>
                    <td>{p.dias}</td>
                    {rango.dias.map((d) => <td key={d}>{p.fechas[d] ? dinero(p.fechas[d]) : '-'}</td>)}
                    <td>{dinero(p.pagoNormal)}</td>
                    <td>{dinero(p.pagoExtra)}</td>
                    <td><strong>{dinero(p.total)}</strong></td>
                    <td>{p.pendientes ? <span className="weekly-pending">{p.pendientes} pendiente(s)</span> : <span className="weekly-ok">Completo</span>}</td>
                  </tr>
                ))}
                {!summary.personas.length && (
                  <tr><td colSpan={15} className="weekly-empty">No hay jornadas de eventuales para esta semana.</td></tr>
                )}
              </tbody>
              {summary.personas.length > 0 && (
                <tfoot>
                  <tr>
                    <th colSpan={3}>TOTAL GENERAL</th>
                    <th>{summary.totals.dias}</th>
                    {rango.dias.map((d) => <th key={d}>{summary.totals.fechas[d] ? dinero(summary.totals.fechas[d]) : '-'}</th>)}
                    <th>{dinero(summary.totals.pagoNormal)}</th>
                    <th>{dinero(summary.totals.pagoExtra)}</th>
                    <th>{dinero(summary.totals.total)}</th>
                    <th>{summary.totals.pendientes ? `${summary.totals.pendientes} pendiente(s)` : 'Completo'}</th>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="weekly-control-grid">
            <div className="weekly-control-card">
              <h3>Solicitud de efectivo</h3>
              <label>Solicitado<input type="number" min="0" step="0.01" value={control.solicitado} placeholder={summary.totals.total.toFixed(2)} onChange={(e) => setControl({ ...control, solicitado: e.target.value })} /></label>
              <label>Pagado<input type="number" min="0" step="0.01" value={control.pagado} onChange={(e) => setControl({ ...control, pagado: e.target.value })} /></label>
              <div className="weekly-balance"><span>Sobrante</span><strong>{dinero(sobrante)}</strong></div>
            </div>
            <div className="weekly-control-card">
              <h3>Comentarios</h3>
              <textarea rows={5} value={control.comentarios} onChange={(e) => setControl({ ...control, comentarios: e.target.value })} placeholder="Comentarios de la solicitud o ajustes de pago..." />
            </div>
          </div>

          <div className="weekly-actions">
            <button type="button" onClick={() => pdfSolicitud({ propiedad, rango, summary, control: { ...control, solicitado }, folio })} disabled={!summary.personas.length}>
              <FileText size={17} /> PDF solicitud
            </button>
            <button type="button" onClick={() => pdfRecibos({ propiedad, rango, summary, folio })} disabled={!summary.personas.length}>
              <Download size={17} /> PDF recibos
            </button>
            <button type="button" onClick={() => descargarCsv({ propiedad, rango, summary, folio })} disabled={!summary.personas.length}>
              <FileSpreadsheet size={17} /> Excel / CSV
            </button>
          </div>

          <section className="weekly-detail-card">
            <h3>Detalle de registros</h3>
            <div className="weekly-table-wrap">
              <table className="weekly-table compact">
                <thead><tr><th>Empleado</th><th>Puesto</th><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Horas pagables</th><th>Tarifa</th><th>Pago</th><th>Estado</th>{puedeResolverTurnos && <th>Acción</th>}</tr></thead>
                <tbody>
                  {summary.personas.flatMap((p) => p.jornadas.map((j) => {
                    const c = j.calculoPago;
                    return (
                      <tr key={j.id || `${p.id}-${j.fechaJornada}-${j.entradaEn}`}>
                        <td>{p.nombre}</td><td>{p.puesto}</td><td>{j.fechaJornada}</td>
                        <td>{horaTexto(j.entradaEn, j.zonaHoraria)}</td>
                        <td>{j.salidaEn ? horaTexto(j.salidaEn, j.zonaHoraria) : '-'}</td>
                        <td>{c.pendiente ? '-' : c.horasPagables.toFixed(2)}</td>
                        <td>{dinero(c.tarifa)}</td>
                        <td>{c.pendiente ? '-' : dinero(c.total)}</td>
                        <td>{estadoRegistro(j)}</td>
                        {puedeResolverTurnos && (
                          <td>
                            {puedeResolverRegistro(j) ? (
                              <button
                                type="button"
                                className="weekly-resolve-button"
                                onClick={() => abrirResolverTurno(j, p)}
                              >
                                Resolver turno
                              </button>
                            ) : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  }))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <FormModal
        open={Boolean(resolver)}
        title="Resolver turno pendiente"
        subtitle="RH puede cerrar el pendiente sin inventar una hora, o capturar la salida real cuando exista evidencia."
        onClose={cerrarResolverTurno}
        busy={resolverBusy}
        width="680px"
      >
        {resolver && (
          <form className="turn-resolution-form" onSubmit={resolverTurno}>
            <div className="turn-resolution-summary">
              <div><span>Eventual</span><strong>{resolver.empleadoNombre}</strong></div>
              <div><span>Puesto</span><strong>{resolver.puestoNombre || 'Sin puesto'}</strong></div>
              <div><span>Fecha</span><strong>{resolver.fechaJornada || '-'}</strong></div>
              <div><span>Entrada</span><strong>{horaTexto(resolver.entradaEn, resolver.zonaHoraria)}</strong></div>
            </div>

            {resolver.estado !== 'sin_salida' && (
              <div className="turn-resolution-options">
                <label className={resolverModo === 'sin_salida' ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="resolver-modo"
                    value="sin_salida"
                    checked={resolverModo === 'sin_salida'}
                    onChange={() => {
                      setResolverModo('sin_salida');
                      setResolverSalida('');
                      if (!resolverMotivo.trim()) setResolverMotivo('El eventual no registró su salida y RH resolvió el pendiente.');
                    }}
                  />
                  <AlertTriangle size={20} />
                  <span><strong>No checó salida</strong><small>No se asignará una hora. Desaparece de pendientes de Seguridad y queda sin pago hasta corregirse.</small></span>
                </label>
                <label className={resolverModo === 'corregir_salida' ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="resolver-modo"
                    value="corregir_salida"
                    checked={resolverModo === 'corregir_salida'}
                    onChange={() => {
                      setResolverModo('corregir_salida');
                      setResolverMotivo('');
                    }}
                  />
                  <Save size={20} />
                  <span><strong>Registrar salida real</strong><small>Usa esta opción solo cuando RH tenga una hora de salida confirmada.</small></span>
                </label>
              </div>
            )}

            {resolverModo === 'corregir_salida' && (
              <label className="turn-resolution-field">
                Fecha y hora real de salida
                <input
                  type="datetime-local"
                  required
                  value={resolverSalida}
                  onChange={(event) => setResolverSalida(event.target.value)}
                />
              </label>
            )}

            <label className="turn-resolution-field">
              Motivo / evidencia de la corrección
              <textarea
                rows={4}
                minLength={10}
                maxLength={1000}
                required
                value={resolverMotivo}
                onChange={(event) => setResolverMotivo(event.target.value)}
                placeholder="Ej. El jefe de área confirmó la salida del eventual a las 04:00 a.m."
              />
            </label>

            <div className="turn-resolution-note">
              <AlertTriangle size={18} />
              <span>La modificación queda registrada en auditoría con el usuario de RH/Admin que la realizó.</span>
            </div>

            <div className="admin-form-modal-actions">
              <button type="button" className="secondary-button" onClick={cerrarResolverTurno} disabled={resolverBusy}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={resolverBusy}>
                {resolverBusy ? 'Guardando...' : 'Resolver turno'}
              </button>
            </div>
          </form>
        )}
      </FormModal>
    </section>
  );
}
