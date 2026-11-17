import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, FileDown, Pencil, Plus, RefreshCw, Search, Trash2, XCircle } from 'lucide-react';
import FormModal from '../../components/admin/FormModal';
import DataLoadingState from '../../components/DataLoadingState';
import { useAuth } from '../../context/AuthContext';
import { useFeedback } from '../../context/FeedbackContext';
import { PERMISOS, tienePermiso } from '../../../shared/perfilesAcceso';
import {
  autorizarRequisicionPersonal,
  cargarCatalogosRequisicion,
  crearRequisicionPersonal,
  listarRequisicionesPersonal,
  rechazarRequisicionPersonal,
} from '../../services/requisicionesPersonalService';
import { crearRequisicionPersonalPDF } from '../../services/pdfRequisicionPersonalService';
import './requisicionesPersonal.css';

const EMPTY_HEADER = {
  propiedadId: '',
  departamentoSolicitante: '',
  motivo: 'Apoyo a la operación',
  descripcionCausa: '',
  formaPago: 'Efectivo',
  personasPropuestas: '',
};

const EMPTY_LINE = {
  puestoId: '',
  horarioId: '',
  cantidadPersonas: 1,
  fechas: [],
};

function hoyLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fechaTexto(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
    ? String(value).split('-').reverse().join('/')
    : '—';
}

function diasEntre(desde, hasta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(hasta || '') || hasta < desde) return 0;
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

function fechasPartida(item = {}) {
  if (Array.isArray(item.fechas) && item.fechas.length) {
    return [...new Set(item.fechas.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))))].sort();
  }
  return fechasEntre(item.fechaDesde || '', item.fechaHasta || '');
}

function resumenFechas(item = {}) {
  const fechas = fechasPartida(item);
  if (!fechas.length) return '—';
  if (fechas.length <= 4) return fechas.map(fechaTexto).join(', ');
  return `${fechas.slice(0, 3).map(fechaTexto).join(', ')} · +${fechas.length - 3} día${fechas.length - 3 === 1 ? '' : 's'}`;
}

function monthLabel(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) return '';
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const text = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shiftMonth(monthKey, delta) {
  const [year, month] = String(monthKey || hoyLocal().slice(0, 7)).split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function calendarCells(monthKey) {
  const [year, month] = String(monthKey || hoyLocal().slice(0, 7)).split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

function estadoMeta(value) {
  if (value === 'autorizada') return { label: 'Autorizada', cls: 'authorized' };
  if (value === 'rechazada') return { label: 'Rechazada', cls: 'rejected' };
  return { label: 'Pendiente', cls: 'pending' };
}

function safeFile(value) {
  return String(value || 'requisicion').replace(/[^A-Za-z0-9_-]+/g, '_');
}

function partidasDe(item = {}) {
  if (Array.isArray(item.partidas) && item.partidas.length) return item.partidas;
  if (!item.puestoId && !item.puestoNombre) return [];
  return [{
    partidaId: 'legacy_1',
    puestoId: item.puestoId || '',
    puestoNombre: item.puestoNombre || '',
    horarioId: item.horarioId || '',
    horarioNombre: item.horarioNombre || '',
    horaInicio: item.horaInicio || '',
    horaFin: item.horaFin || '',
    cantidadPersonas: Number(item.cantidadPersonas || 0),
    fechaDesde: item.fechaDesde || '',
    fechaHasta: item.fechaHasta || '',
    fechas: fechasPartida(item),
  }];
}

function resumenRequisicion(item) {
  const partidas = partidasDe(item);
  const turnosPersona = partidas.reduce((sum, row) => sum + Number(row.cantidadPersonas || 0) * fechasPartida(row).length, 0);
  const dates = partidas.flatMap((row) => fechasPartida(row)).filter(Boolean).sort();
  return {
    partidas,
    turnosPersona,
    desde: dates[0] || item.fechaDesde || '',
    hasta: dates.at(-1) || item.fechaHasta || '',
  };
}

export default function RequisicionesPersonalPanel() {
  const { profile } = useAuth();
  const feedback = useFeedback();
  const puedeAutorizar = profile?.rol === 'administrador' || tienePermiso(profile, PERMISOS.AUTORIZAR_REQUISICIONES_PERSONAL) || (profile?.rol === 'rh' && tienePermiso(profile, PERMISOS.PLANEACION_PERSONAL));
  const puedeSolicitar = profile?.rol === 'administrador' || tienePermiso(profile, PERMISOS.SOLICITAR_PERSONAL) || puedeAutorizar;
  const [catalogos, setCatalogos] = useState({ propiedades: [], puestos: [], horarios: [] });
  const [solicitudes, setSolicitudes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('todas');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_HEADER });
  const [line, setLine] = useState({ ...EMPTY_LINE });
  const [calendarMonth, setCalendarMonth] = useState(hoyLocal().slice(0, 7));
  const [partidas, setPartidas] = useState([]);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [rejecting, setRejecting] = useState(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [cats, list] = await Promise.all([
        cargarCatalogosRequisicion(),
        listarRequisicionesPersonal(),
      ]);
      setCatalogos(cats || { propiedades: [], puestos: [], horarios: [] });
      setSolicitudes(list?.solicitudes || []);
    } catch (error) {
      feedback.error(error?.message || 'No fue posible cargar las requisiciones.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return solicitudes.filter((item) => {
      if (filter !== 'todas' && item.estado !== filter) return false;
      if (!q) return true;
      const puestos = partidasDe(item).map((row) => row.puestoNombre).join(' ');
      return [item.folio, item.departamentoSolicitante, item.puestoNombre, puestos, item.solicitanteNombre, item.propiedadNombre]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [solicitudes, filter, search]);

  function resetLine(today = hoyLocal()) {
    setLine({ ...EMPTY_LINE, fechas: [] });
    setCalendarMonth(today.slice(0, 7));
    setEditingIndex(-1);
  }

  function toggleDate(date) {
    setLine((current) => {
      const selected = fechasPartida(current);
      if (selected.includes(date)) return { ...current, fechas: selected.filter((item) => item !== date) };
      if (selected.length >= 31) {
        feedback.warning('Puedes seleccionar como máximo 31 días por necesidad.');
        return current;
      }
      return { ...current, fechas: [...selected, date].sort() };
    });
  }

  function openForm() {
    const today = hoyLocal();
    const propiedad = catalogos.propiedades.length === 1 ? catalogos.propiedades[0].id : '';
    setForm({ ...EMPTY_HEADER, propiedadId: propiedad });
    setPartidas([]);
    resetLine(today);
    setFormOpen(true);
  }

  function addOrUpdateLine() {
    const cantidad = Number(line.cantidadPersonas);
    const fechas = fechasPartida(line);
    if (!line.puestoId || !line.horarioId || !fechas.length) {
      feedback.warning('Selecciona puesto, horario y al menos un día antes de guardar la necesidad.');
      return;
    }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) {
      feedback.warning('La cantidad de personas debe estar entre 1 y 100.');
      return;
    }
    if (fechas.length > 31) {
      feedback.warning('Cada necesidad puede incluir como máximo 31 días seleccionados.');
      return;
    }
    const puesto = catalogos.puestos.find((item) => item.id === line.puestoId);
    const horario = catalogos.horarios.find((item) => item.id === line.horarioId);
    if (!puesto || !horario) {
      feedback.warning('El puesto o el horario ya no está disponible. Actualiza los catálogos.');
      return;
    }
    const next = {
      partidaId: editingIndex >= 0 ? partidas[editingIndex].partidaId : `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      puestoId: puesto.id,
      puestoNombre: puesto.nombre,
      horarioId: horario.id,
      horarioNombre: horario.nombre,
      horaInicio: horario.horaInicio,
      horaFin: horario.horaFin,
      cantidadPersonas: cantidad,
      fechas,
      fechaDesde: fechas[0],
      fechaHasta: fechas.at(-1),
      diasSolicitados: fechas.length,
    };
    setPartidas((current) => {
      const copy = [...current];
      if (editingIndex >= 0) copy[editingIndex] = next;
      else copy.push(next);
      return copy;
    });
    resetLine(fechas[0] || hoyLocal());
  }

  function editLine(index) {
    const item = partidas[index];
    const fechas = fechasPartida(item);
    setLine({
      puestoId: item.puestoId,
      horarioId: item.horarioId,
      cantidadPersonas: item.cantidadPersonas,
      fechas,
    });
    if (fechas[0]) setCalendarMonth(fechas[0].slice(0, 7));
    setEditingIndex(index);
  }

  async function removeLine(index) {
    const item = partidas[index];
    const ok = await feedback.confirm({
      title: 'Eliminar necesidad',
      message: `Se quitará ${item.cantidadPersonas} ${item.puestoNombre} para ${fechasPartida(item).length} día${fechasPartida(item).length === 1 ? '' : 's'} seleccionado${fechasPartida(item).length === 1 ? '' : 's'}.`,
      confirmText: 'Eliminar',
      cancelText: 'Conservar',
    });
    if (!ok) return;
    setPartidas((current) => current.filter((_, idx) => idx !== index));
    if (editingIndex === index) resetLine(fechasPartida(item)[0] || hoyLocal());
    else if (editingIndex > index) setEditingIndex((value) => value - 1);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!form.propiedadId || !form.departamentoSolicitante.trim() || !form.descripcionCausa.trim()) {
      feedback.warning('Completa propiedad, departamento solicitante y descripción de la causa.');
      return;
    }
    if (!partidas.length) {
      feedback.warning('Agrega al menos una necesidad a la requisición antes de enviarla.');
      return;
    }
    setBusy(true);
    try {
      const result = await crearRequisicionPersonal({ ...form, partidas });
      feedback.success(`Requisición ${result.folio} enviada con ${partidas.length} necesidad${partidas.length === 1 ? '' : 'es'} para autorización.`);
      setFormOpen(false);
      await load();
    } catch (error) {
      feedback.error(error?.message || 'No fue posible guardar la requisición.');
    } finally {
      setBusy(false);
    }
  }

  async function authorize(item) {
    const summary = resumenRequisicion(item);
    const ok = await feedback.confirm({
      title: 'Autorizar requisición',
      message: `Se enviarán ${summary.partidas.length} necesidad${summary.partidas.length === 1 ? '' : 'es'} a Planeación (${summary.turnosPersona} turnos-persona) del ${fechaTexto(summary.desde)} al ${fechaTexto(summary.hasta)}.`,
      confirmText: 'Autorizar y pasar a Planeación',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await autorizarRequisicionPersonal(item.id);
      const detalle = result?.actualizadas ? ` Se actualizaron ${result.actualizadas} necesidades existentes.` : '';
      feedback.success(`Requisición autorizada y enviada a Planeación.${detalle}`);
      await load();
    } catch (error) {
      feedback.error(error?.message || 'No fue posible autorizar la requisición.');
    } finally {
      setBusy(false);
    }
  }

  function openReject(item) {
    setRejecting(item);
    setMotivoRechazo('');
  }

  async function reject(event) {
    event.preventDefault();
    if (!rejecting || busy) return;
    setBusy(true);
    try {
      await rechazarRequisicionPersonal(rejecting.id, motivoRechazo);
      feedback.success(`Requisición ${rejecting.folio} rechazada.`);
      setRejecting(null);
      setMotivoRechazo('');
      await load();
    } catch (error) {
      feedback.error(error?.message || 'No fue posible rechazar la requisición.');
    } finally {
      setBusy(false);
    }
  }

  async function print(item) {
    try {
      const doc = await crearRequisicionPersonalPDF(item);
      doc.save(`${safeFile(item.folio)}.pdf`);
    } catch (error) {
      feedback.error(error?.message || 'No fue posible generar la requisición PDF.');
    }
  }

  if (loading) {
    return <DataLoadingState title="Cargando requisiciones..." detail="Consultando puestos, horarios y solicitudes." />;
  }

  return (
    <div className="requisition-panel">
      <div className="catalog-toolbar requisition-toolbar">
        <div>
          <h2>Requisiciones de personal</h2>
          <p className="muted">Una misma requisición puede incluir varios días, puestos y horarios. Al autorizar, todas las necesidades pasan a Planeación.</p>
        </div>
        <div className="requisition-toolbar-actions">
          <button type="button" className="secondary-button" onClick={load} disabled={busy}><RefreshCw size={16} />Actualizar</button>
          {puedeSolicitar && <button type="button" className="primary-button" onClick={openForm} disabled={busy}><Plus size={17} />Nueva requisición</button>}
        </div>
      </div>

      <div className="requisition-summary">
        <div><strong>{solicitudes.length}</strong><span>Total</span></div>
        <div><strong>{solicitudes.filter((x) => x.estado === 'pendiente_autorizacion').length}</strong><span>Pendientes</span></div>
        <div><strong>{solicitudes.filter((x) => x.estado === 'autorizada').length}</strong><span>Autorizadas</span></div>
        <div><strong>{solicitudes.filter((x) => x.estado === 'rechazada').length}</strong><span>Rechazadas</span></div>
      </div>

      <div className="requisition-filters">
        <label className="requisition-search"><Search size={16} /><input className="text-input" placeholder="Buscar folio, puesto, departamento..." value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <select className="text-input" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="todas">Todos los estados</option>
          <option value="pendiente_autorizacion">Pendientes</option>
          <option value="autorizada">Autorizadas</option>
          <option value="rechazada">Rechazadas</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No hay requisiciones con estos filtros.</div>
      ) : (
        <div className="requisition-list">
          {filtered.map((item) => {
            const status = estadoMeta(item.estado);
            const summary = resumenRequisicion(item);
            return (
              <article className="requisition-card" key={item.id}>
                <div className="requisition-card-main">
                  <div className="requisition-card-title">
                    <strong>{item.folio}</strong>
                    <span className={`requisition-status ${status.cls}`}>{status.label}</span>
                  </div>
                  <h3>{summary.partidas.length} necesidad{summary.partidas.length === 1 ? '' : 'es'} · {summary.turnosPersona} turnos-persona</h3>
                  <div className="requisition-meta-grid">
                    <span><b>Departamento:</b> {item.departamentoSolicitante}</span>
                    <span><b>Propiedad:</b> {item.propiedadNombre}</span>
                    <span><b>Periodo:</b> {fechaTexto(summary.desde)} - {fechaTexto(summary.hasta)}</span>
                    <span><b>Solicita:</b> {item.solicitanteNombre}</span>
                    <span><b>Motivo:</b> {item.motivo}</span>
                    <span><b>Detalle:</b> {summary.partidas.slice(0, 2).map((row) => `${row.cantidadPersonas} ${row.puestoNombre} ${row.horaInicio}-${row.horaFin}`).join(' · ')}{summary.partidas.length > 2 ? ` · +${summary.partidas.length - 2} más` : ''}</span>
                  </div>
                  {item.estado === 'rechazada' && item.motivoRechazo && <p className="requisition-reject-note"><b>Motivo de rechazo:</b> {item.motivoRechazo}</p>}
                </div>
                <div className="requisition-actions">
                  <button type="button" className="secondary-button" onClick={() => print(item)}><FileDown size={16} />PDF</button>
                  {puedeAutorizar && item.estado === 'pendiente_autorizacion' && (
                    <>
                      <button type="button" className="secondary-button requisition-reject" onClick={() => openReject(item)} disabled={busy}><XCircle size={16} />Rechazar</button>
                      <button type="button" className="primary-button" onClick={() => authorize(item)} disabled={busy}><CheckCircle2 size={16} />Autorizar</button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <FormModal open={formOpen} title="Nueva requisición de personal" subtitle="Agrega todas las necesidades y envíalas juntas para autorización." onClose={() => setFormOpen(false)} busy={busy} width="980px">
        <form onSubmit={submit}>
          <div className="modal-form-grid requisition-form-grid requisition-header-fields">
            <label className="field-label">Propiedad
              <select className="text-input" required value={form.propiedadId} onChange={(e) => setForm({ ...form, propiedadId: e.target.value })}>
                <option value="">Selecciona</option>
                {catalogos.propiedades.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
              </select>
            </label>
            <label className="field-label">Departamento solicitante
              <input className="text-input" required maxLength={120} placeholder="Restaurante, Cocina, Banquetes..." value={form.departamentoSolicitante} onChange={(e) => setForm({ ...form, departamentoSolicitante: e.target.value })} />
            </label>
            <label className="field-label">Motivo
              <select className="text-input" required value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })}>
                <option>Apoyo a la operación</option>
                <option>Fin de semana</option>
                <option>Evento</option>
                <option>Incremento de ocupación</option>
                <option>Incapacidad</option>
                <option>Vacante</option>
                <option>Otro</option>
              </select>
            </label>
            <label className="field-label">Forma de pago
              <input className="text-input" required maxLength={80} value={form.formaPago} onChange={(e) => setForm({ ...form, formaPago: e.target.value })} />
            </label>
            <label className="field-label form-full">Descripción de la causa
              <textarea className="text-input requisition-textarea" required maxLength={700} placeholder="Ej. Apoyo en la operación del restaurante por evento / ocupación..." value={form.descripcionCausa} onChange={(e) => setForm({ ...form, descripcionCausa: e.target.value })} />
            </label>
          </div>

          <section className="requisition-line-editor">
            <div className="requisition-line-heading">
              <div>
                <h3>{editingIndex >= 0 ? 'Editar necesidad' : 'Agregar necesidad'}</h3>
                <p>Selecciona puesto, cantidad, horario y marca en un solo calendario los días que necesitas.</p>
              </div>
              {editingIndex >= 0 && <button type="button" className="secondary-button" onClick={() => resetLine(fechasPartida(line)[0] || hoyLocal())}>Cancelar edición</button>}
            </div>

            <div className="requisition-line-core">
              <label className="field-label">Puesto solicitado
                <select className="text-input" value={line.puestoId} onChange={(e) => setLine({ ...line, puestoId: e.target.value })}>
                  <option value="">Selecciona</option>
                  {catalogos.puestos.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
                </select>
              </label>
              <label className="field-label">Personas
                <input className="text-input" type="number" min="1" max="100" value={line.cantidadPersonas} onChange={(e) => setLine({ ...line, cantidadPersonas: e.target.value })} />
              </label>
              <label className="field-label requisition-line-schedule">Horario
                <select className="text-input" value={line.horarioId} onChange={(e) => setLine({ ...line, horarioId: e.target.value })}>
                  <option value="">Selecciona</option>
                  {catalogos.horarios.map((item) => <option key={item.id} value={item.id}>{item.horaInicio} - {item.horaFin} · {item.nombre}</option>)}
                </select>
              </label>
            </div>

            <div className="requisition-calendar-layout">
              <div className="requisition-calendar">
                <div className="requisition-calendar-header">
                  <button type="button" className="icon-button" aria-label="Mes anterior" onClick={() => setCalendarMonth((value) => shiftMonth(value, -1))}><ChevronLeft size={17} /></button>
                  <strong><CalendarDays size={17} />{monthLabel(calendarMonth)}</strong>
                  <button type="button" className="icon-button" aria-label="Mes siguiente" onClick={() => setCalendarMonth((value) => shiftMonth(value, 1))}><ChevronRight size={17} /></button>
                </div>
                <div className="requisition-calendar-weekdays">{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
                <div className="requisition-calendar-grid">
                  {calendarCells(calendarMonth).map((date, index) => date ? (
                    <button key={date} type="button" className={`requisition-calendar-day${fechasPartida(line).includes(date) ? ' selected' : ''}${date === hoyLocal() ? ' today' : ''}`} onClick={() => toggleDate(date)} aria-pressed={fechasPartida(line).includes(date)}>
                      {Number(date.slice(-2))}
                    </button>
                  ) : <span key={`blank-${index}`} className="requisition-calendar-blank" />)}
                </div>
              </div>

              <div className="requisition-selected-days">
                <div className="requisition-selected-days-head">
                  <div><b>Días seleccionados</b><span>{fechasPartida(line).length} de 31</span></div>
                  {fechasPartida(line).length > 0 && <button type="button" className="secondary-button requisition-clear-days" onClick={() => setLine({ ...line, fechas: [] })}>Limpiar</button>}
                </div>
                {fechasPartida(line).length ? (
                  <div className="requisition-date-chips">
                    {fechasPartida(line).map((date) => <button type="button" key={date} className="requisition-date-chip" onClick={() => toggleDate(date)} title="Quitar día">{fechaTexto(date)} <span>×</span></button>)}
                  </div>
                ) : <p className="requisition-selected-empty">Haz clic en los días del calendario que quieres incluir en esta necesidad.</p>}
                <div className="requisition-add-line-wrap">
                  <button type="button" className="primary-button requisition-add-line" onClick={addOrUpdateLine} disabled={busy || !fechasPartida(line).length}>
                    {editingIndex >= 0 ? <><Pencil size={16} />Guardar cambios</> : <><Plus size={16} />Guardar necesidad</>}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="requisition-lines-section">
            <div className="requisition-lines-title">
              <h3>Necesidades agregadas</h3>
              <span>{partidas.length} renglón{partidas.length === 1 ? '' : 'es'}</span>
            </div>
            {partidas.length === 0 ? (
              <div className="requisition-lines-empty">Todavía no has agregado necesidades. Captura el primer turno y pulsa <b>Guardar necesidad</b>.</div>
            ) : (
              <div className="requisition-lines-scroll">
                <table className="requisition-lines-table">
                  <thead><tr><th>Días seleccionados</th><th>Puesto</th><th>Horario</th><th>Personas</th><th>Días</th><th>Turnos-persona</th><th>Acciones</th></tr></thead>
                  <tbody>
                    {partidas.map((item, index) => {
                      const days = fechasPartida(item).length;
                      return (
                        <tr key={item.partidaId || `${index}-${item.puestoId}`}>
                          <td title={fechasPartida(item).map(fechaTexto).join(', ')}>{resumenFechas(item)}</td>
                          <td><b>{item.puestoNombre}</b></td>
                          <td>{item.horaInicio} - {item.horaFin}</td>
                          <td>{item.cantidadPersonas}</td>
                          <td>{days}</td>
                          <td>{days * Number(item.cantidadPersonas || 0)}</td>
                          <td><div className="requisition-line-actions"><button type="button" className="secondary-button" onClick={() => editLine(index)}><Pencil size={15} />Editar</button><button type="button" className="secondary-button requisition-reject" onClick={() => removeLine(index)}><Trash2 size={15} />Eliminar</button></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <label className="field-label requisition-proposed">Personal propuesto (opcional)
            <textarea className="text-input requisition-textarea short" maxLength={1800} placeholder="Si ya tienes nombres, escríbelos aquí. No los da de alta automáticamente." value={form.personasPropuestas} onChange={(e) => setForm({ ...form, personasPropuestas: e.target.value })} />
          </label>

          <div className="admin-form-modal-actions requisition-submit-actions">
            <span className="requisition-submit-summary">{partidas.length ? `${partidas.length} necesidad${partidas.length === 1 ? '' : 'es'} · ${partidas.reduce((sum, row) => sum + Number(row.cantidadPersonas || 0) * fechasPartida(row).length, 0)} turnos-persona` : 'Agrega al menos una necesidad'}</span>
            <button type="submit" className="primary-button" disabled={busy || !partidas.length || editingIndex >= 0}>{busy ? 'Guardando...' : editingIndex >= 0 ? 'Guarda la edición primero' : 'Enviar requisición completa'}</button>
          </div>
        </form>
      </FormModal>

      <FormModal open={Boolean(rejecting)} title="Rechazar requisición" subtitle={rejecting ? `${rejecting.folio} · ${resumenRequisicion(rejecting).partidas.length} necesidad(es)` : ''} onClose={() => setRejecting(null)} busy={busy} width="560px">
        <form onSubmit={reject}>
          <label className="field-label">Motivo del rechazo
            <textarea className="text-input requisition-textarea" required maxLength={500} value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} placeholder="Especifica por qué no se autoriza." />
          </label>
          <div className="admin-form-modal-actions">
            <button type="submit" className="primary-button requisition-danger" disabled={busy || !motivoRechazo.trim()}>Confirmar rechazo</button>
          </div>
        </form>
      </FormModal>
    </div>
  );
}
