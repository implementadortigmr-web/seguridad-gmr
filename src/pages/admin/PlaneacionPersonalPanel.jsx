import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Clock3,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  DollarSign,
  Edit3,
  Plus,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import DataLoadingState from '../../components/DataLoadingState';
import { confirmFeedback } from '../../services/feedbackService';
import FormModal from '../../components/admin/FormModal';
import {
  asignarEventualPlaneacion,
  asignarReemplazoPlaneacion,
  copiarDiaPlaneacion,
  copiarSemanaPlaneacion,
  eliminarNecesidadPersonal,
  guardarNecesidadPersonal,
  listarPlaneacionSemana,
  listarSeguimientoPlaneacionSemana,
  quitarAsignacionPlaneacion,
  quitarReemplazoPlaneacion,
} from '../../services/planeacionService';

function isoLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mondayOf(value = new Date()) {
  const date = typeof value === 'string' ? new Date(`${value}T12:00:00`) : new Date(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return isoLocal(date);
}

function addDays(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoLocal(date);
}

function fechaCorta(value) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }).format(date);
}

function money(value) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(Number(value || 0));
}

function horasTexto(minutos = 0) {
  const total = Number(minutos || 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function costoPlaneadoNecesidad(need, assigned = []) {
  const cantidad = Number(need?.cantidadNecesaria || 0);
  const horas = Number(need?.minutosDuracion || 0) / 60;
  const tarifaBase = Number(need?.tarifaHora || 0);
  const asignados = Array.isArray(assigned) ? assigned : [];
  const costoAsignado = asignados.reduce((sum, item) => {
    const tarifa = Number.isFinite(Number(item?.tarifaHoraPlanificada))
      ? Number(item.tarifaHoraPlanificada)
      : tarifaBase;
    return sum + (horas * tarifa);
  }, 0);
  const faltantes = Math.max(0, cantidad - asignados.length);
  return Math.round((costoAsignado + (faltantes * horas * tarifaBase)) * 100) / 100;
}

function seguimientoEstadoMeta(value) {
  const map = {
    programado: { label: 'Programado', className: 'planned' },
    llego: { label: 'Llegó', className: 'ok' },
    llego_tarde: { label: 'Llegó tarde', className: 'late' },
    no_ha_llegado: { label: 'No ha llegado', className: 'warning' },
    no_llego: { label: 'No llegó', className: 'danger' },
    turno_pendiente: { label: 'Turno pendiente', className: 'pending' },
    sin_salida: { label: 'Sin salida', className: 'pending' },
    reemplazado: { label: 'Reemplazado', className: 'replacement' },
  };
  return map[value] || { label: value || 'Sin estado', className: 'planned' };
}

function diferenciaEntradaTexto(item) {
  if (Number(item?.retardoMinutos || 0) > 0) return `+${item.retardoMinutos} min`;
  if (Number(item?.anticipacionMinutos || 0) > 0) return `-${item.anticipacionMinutos} min`;
  return item?.jornada ? 'A tiempo' : '-';
}

function esMexico(propiedad) {
  const value = `${propiedad?.codigo || ''} ${propiedad?.nombre || ''}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return value.includes('MEXICO');
}

const NEED_EMPTY = {
  fecha: '',
  horarioId: '',
  puestoId: '',
  cantidadNecesaria: 1,
  observaciones: '',
};

export default function PlaneacionPersonalPanel({ propiedades = [], setMessage }) {
  const usableProperties = useMemo(
    () => (Array.isArray(propiedades) ? propiedades : []).filter((p) => p.activo === true && !esMexico(p)),
    [propiedades]
  );

  const [propiedadId, setPropiedadId] = useState('');
  const [semanaInicio, setSemanaInicio] = useState(mondayOf());
  const [data, setData] = useState({ necesidades: [], asignaciones: [], horarios: [], puestos: [], eventuales: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState('planeacion');
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [tracking, setTracking] = useState({ seguimiento: [], sinProgramacion: [], resumen: {} });

  const [needOpen, setNeedOpen] = useState(false);
  const [editingNeedId, setEditingNeedId] = useState('');
  const [needForm, setNeedForm] = useState(NEED_EMPTY);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignNeed, setAssignNeed] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState('');

  const [copyDayOpen, setCopyDayOpen] = useState(false);
  const [copyDayForm, setCopyDayForm] = useState({ origen: '', destino: '' });

  const [replacementOpen, setReplacementOpen] = useState(false);
  const [replacementAssignment, setReplacementAssignment] = useState(null);
  const [selectedReplacementJourney, setSelectedReplacementJourney] = useState('');
  const [replacementReason, setReplacementReason] = useState('');

  useEffect(() => {
    if (!propiedadId && usableProperties.length === 1) setPropiedadId(usableProperties[0].id);
  }, [usableProperties, propiedadId]);

  async function load({ quiet = false } = {}) {
    if (!propiedadId) return;
    if (!quiet) setLoading(true);
    try {
      const result = await listarPlaneacionSemana({ propiedadId, semanaInicio });
      setData({
        necesidades: Array.isArray(result?.necesidades) ? result.necesidades : [],
        asignaciones: Array.isArray(result?.asignaciones) ? result.asignaciones : [],
        horarios: Array.isArray(result?.horarios) ? result.horarios : [],
        puestos: Array.isArray(result?.puestos) ? result.puestos : [],
        eventuales: Array.isArray(result?.eventuales) ? result.eventuales : [],
      });
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible cargar la planeación.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => { load(); }, [propiedadId, semanaInicio]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadTracking() {
    if (!propiedadId) return;
    setTrackingLoading(true);
    try {
      const result = await listarSeguimientoPlaneacionSemana({ propiedadId, semanaInicio });
      setTracking({
        seguimiento: Array.isArray(result?.seguimiento) ? result.seguimiento : [],
        sinProgramacion: Array.isArray(result?.sinProgramacion) ? result.sinProgramacion : [],
        resumen: result?.resumen || {},
        zonaHoraria: result?.zonaHoraria || 'America/Mexico_City',
        criterioRetardoMinutos: Number(result?.criterioRetardoMinutos || 0),
      });
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible comparar la planeación con la asistencia real.');
    } finally {
      setTrackingLoading(false);
    }
  }

  useEffect(() => {
    if (viewMode === 'seguimiento') loadTracking();
  }, [viewMode, propiedadId, semanaInicio]); // eslint-disable-line react-hooks/exhaustive-deps

  const dias = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(semanaInicio, index)), [semanaInicio]);
  const asignacionesPorNecesidad = useMemo(() => {
    const map = new Map();
    data.asignaciones.forEach((item) => {
      const list = map.get(item.necesidadId) || [];
      list.push(item);
      map.set(item.necesidadId, list);
    });
    return map;
  }, [data.asignaciones]);

  const resumen = useMemo(() => {
    let necesarios = 0;
    let asignados = 0;
    let costo = 0;
    data.necesidades.forEach((need) => {
      const qty = Number(need.cantidadNecesaria || 0);
      const assigned = (asignacionesPorNecesidad.get(need.id) || []).length;
      necesarios += qty;
      asignados += assigned;
      costo += costoPlaneadoNecesidad(need, asignacionesPorNecesidad.get(need.id) || []);
    });
    return { necesarios, asignados, faltantes: Math.max(0, necesarios - asignados), costo };
  }, [data.necesidades, asignacionesPorNecesidad]);

  const horariosActivos = useMemo(() => data.horarios.filter((item) => item.activo !== false), [data.horarios]);
  const puestosActivos = useMemo(() => data.puestos.filter((item) => item.activo !== false), [data.puestos]);

  function openNewNeed(fecha = dias[0]) {
    setEditingNeedId('');
    setNeedForm({ ...NEED_EMPTY, fecha, horarioId: horariosActivos[0]?.id || '', puestoId: puestosActivos[0]?.id || '' });
    setNeedOpen(true);
  }

  function openEditNeed(need) {
    setEditingNeedId(need.id);
    setNeedForm({
      fecha: need.fecha,
      horarioId: need.horarioId,
      puestoId: need.puestoId,
      cantidadNecesaria: Number(need.cantidadNecesaria || 1),
      observaciones: need.observaciones || '',
    });
    setNeedOpen(true);
  }

  async function saveNeed(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage?.('');
    try {
      await guardarNecesidadPersonal({
        necesidadId: editingNeedId || '',
        propiedadId,
        ...needForm,
        cantidadNecesaria: Number(needForm.cantidadNecesaria),
      });
      setNeedOpen(false);
      setEditingNeedId('');
      await load({ quiet: true });
      setMessage?.('Necesidad de personal guardada.');
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible guardar la necesidad.');
    } finally {
      setBusy(false);
    }
  }

  async function removeNeed(need) {
    if (busy) return;
    const ok = await confirmFeedback({
      title: 'Quitar necesidad',
      message: `Se quitará ${need.puestoNombre} de ${need.horarioNombre} el ${need.fecha}, junto con sus asignaciones.`,
      confirmText: 'Quitar',
      type: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await eliminarNecesidadPersonal({ necesidadId: need.id });
      await load({ quiet: true });
      setMessage?.('Necesidad eliminada de la planeación.');
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible eliminar la necesidad.');
    } finally {
      setBusy(false);
    }
  }

  function openAssign(need) {
    setAssignNeed(need);
    setSelectedEmployee('');
    setAssignOpen(true);
  }

  const candidates = useMemo(() => {
    if (!assignNeed) return [];
    const assignedIds = new Set((asignacionesPorNecesidad.get(assignNeed.id) || []).map((item) => item.empleadoId));
    return data.eventuales
      .filter((person) => person.activo !== false && person.puestoId === assignNeed.puestoId && !assignedIds.has(person.id))
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
  }, [assignNeed, data.eventuales, asignacionesPorNecesidad]);

  async function assignEmployee(event) {
    event.preventDefault();
    if (!assignNeed || !selectedEmployee || busy) return;
    setBusy(true);
    try {
      await asignarEventualPlaneacion({ necesidadId: assignNeed.id, empleadoId: selectedEmployee });
      await load({ quiet: true });
      setSelectedEmployee('');
      setMessage?.('Eventual asignado correctamente.');
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible asignar al eventual.');
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(item) {
    if (busy) return;
    setBusy(true);
    try {
      await quitarAsignacionPlaneacion({ asignacionId: item.id });
      await load({ quiet: true });
      setMessage?.('Asignación retirada.');
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible retirar la asignación.');
    } finally {
      setBusy(false);
    }
  }

  const replacementCandidates = useMemo(() => {
    if (!replacementAssignment) return [];
    return (tracking.sinProgramacion || [])
      .filter((item) => item.fechaJornada === replacementAssignment.fecha)
      .filter((item) => !replacementAssignment.puestoId || !item.puestoId || item.puestoId === replacementAssignment.puestoId)
      .sort((a, b) => `${a.entradaHora || ''}${a.empleadoNombre || ''}`.localeCompare(`${b.entradaHora || ''}${b.empleadoNombre || ''}`, 'es'));
  }, [replacementAssignment, tracking.sinProgramacion]);

  function openReplacement(item) {
    setReplacementAssignment(item);
    setSelectedReplacementJourney('');
    setReplacementReason('');
    setReplacementOpen(true);
  }

  async function assignReplacement(event) {
    event.preventDefault();
    if (!replacementAssignment || !selectedReplacementJourney || busy) return;
    const candidate = replacementCandidates.find((item) => item.id === selectedReplacementJourney);
    if (!candidate) {
      setMessage?.('Selecciona una jornada válida para cubrir el turno.');
      return;
    }
    const ok = await confirmFeedback({
      title: 'Confirmar reemplazo',
      message: `${candidate.empleadoNombre} cubrirá el turno de ${replacementAssignment.empleadoNombre} el ${replacementAssignment.fecha}, ${replacementAssignment.horaInicio}-${replacementAssignment.horaFin}. Las checadas reales no se modificarán.`,
      confirmText: 'Registrar reemplazo',
      type: 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await asignarReemplazoPlaneacion({
        asignacionId: replacementAssignment.id,
        jornadaId: selectedReplacementJourney,
        motivo: replacementReason,
      });
      setReplacementOpen(false);
      setReplacementAssignment(null);
      setSelectedReplacementJourney('');
      setReplacementReason('');
      await loadTracking();
      setMessage?.('Reemplazo registrado correctamente.');
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible registrar el reemplazo.');
    } finally {
      setBusy(false);
    }
  }

  async function removeReplacement(item) {
    if (busy || !item?.reemplazo) return;
    const ok = await confirmFeedback({
      title: 'Quitar reemplazo',
      message: `Se quitará a ${item.reemplazo.empleadoNombre} como reemplazo de ${item.empleadoNombre}. La jornada real permanecerá intacta y volverá a mostrarse como sin programación.`,
      confirmText: 'Quitar reemplazo',
      type: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await quitarReemplazoPlaneacion({ asignacionId: item.id });
      await loadTracking();
      setMessage?.('Reemplazo retirado.');
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible quitar el reemplazo.');
    } finally {
      setBusy(false);
    }
  }

  function openCopyDay(origen) {
    setCopyDayForm({ origen, destino: addDays(origen, 1) });
    setCopyDayOpen(true);
  }

  async function copyDay(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await copiarDiaPlaneacion({ propiedadId, fechaOrigen: copyDayForm.origen, fechaDestino: copyDayForm.destino });
      setCopyDayOpen(false);
      await load({ quiet: true });
      setMessage?.(`Día copiado: ${result?.creadas || 0} necesidades nuevas${result?.omitidas ? `, ${result.omitidas} ya existían` : ''}.`);
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible copiar el día.');
    } finally {
      setBusy(false);
    }
  }

  async function copyWeek() {
    if (busy || !propiedadId) return;
    const next = addDays(semanaInicio, 7);
    const ok = await confirmFeedback({
      title: 'Copiar semana',
      message: `Se copiarán las necesidades a la semana que inicia ${next}. Las personas asignadas no se copiarán.`,
      confirmText: 'Copiar semana',
      type: 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await copiarSemanaPlaneacion({ propiedadId, semanaOrigen: semanaInicio, semanaDestino: next });
      setSemanaInicio(next);
      setMessage?.(`Semana copiada: ${result?.creadas || 0} necesidades nuevas${result?.omitidas ? `, ${result.omitidas} ya existían` : ''}.`);
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible copiar la semana.');
    } finally {
      setBusy(false);
    }
  }

  function moveWeek(delta) {
    setSemanaInicio((current) => addDays(current, delta * 7));
  }

  if (!usableProperties.length) {
    return <div className="empty-state">No hay propiedades disponibles para planear Eventuales.</div>;
  }

  return (
    <section className="workforce-planning">
      <div className="catalog-toolbar workforce-toolbar">
        <div>
          <h2>Planeación de personal</h2>
          <p className="muted">Define cuántas personas necesitas por horario y puesto. Después asigna Eventuales disponibles.</p>
        </div>
        {viewMode === 'planeacion' && (
          <button type="button" className="primary-button" onClick={() => openNewNeed()} disabled={!propiedadId || loading}>
            <Plus size={17} />Agregar necesidad
          </button>
        )}
      </div>

      <div className="planning-view-tabs" role="tablist" aria-label="Vista de planeación">
        <button
          type="button"
          className={viewMode === 'planeacion' ? 'active' : ''}
          onClick={() => setViewMode('planeacion')}
        >
          Planeación semanal
        </button>
        <button
          type="button"
          className={viewMode === 'seguimiento' ? 'active' : ''}
          onClick={() => setViewMode('seguimiento')}
        >
          Seguimiento asistencia
        </button>
      </div>

      <div className="info-box">
        {viewMode === 'planeacion'
          ? 'Fase 1: esta pantalla planea necesidades y asignaciones. No modifica checadas ni pagos reales; el costo mostrado es una estimación con las tarifas actuales.'
          : 'Fase 2: compara lo programado contra las checadas reales de Eventuales. Es solo consulta: no modifica jornadas ni pagos.'}
      </div>

      <div className="planning-controls">
        <label className="field-label">Propiedad
          <select className="text-input" value={propiedadId} onChange={(e) => setPropiedadId(e.target.value)}>
            <option value="">Selecciona propiedad</option>
            {usableProperties.map((property) => <option key={property.id} value={property.id}>{property.nombre}</option>)}
          </select>
        </label>

        <div className="planning-week-control">
          <button type="button" className="secondary-button" onClick={() => moveWeek(-1)} disabled={loading}><ChevronLeft size={17} />Anterior</button>
          <label className="field-label">Semana que inicia
            <input className="text-input" type="date" value={semanaInicio} onChange={(e) => setSemanaInicio(mondayOf(e.target.value))} />
          </label>
          <button type="button" className="secondary-button" onClick={() => moveWeek(1)} disabled={loading}>Siguiente<ChevronRight size={17} /></button>
        </div>

        {viewMode === 'planeacion' ? (
          <button type="button" className="secondary-button planning-copy-week" onClick={copyWeek} disabled={!propiedadId || loading || busy}>
            <ClipboardCopy size={17} />Copiar a semana siguiente
          </button>
        ) : (
          <button type="button" className="secondary-button planning-copy-week" onClick={loadTracking} disabled={!propiedadId || trackingLoading}>
            <Clock3 size={17} />Actualizar seguimiento
          </button>
        )}
      </div>

      {!propiedadId ? (
        <div className="empty-state">Selecciona una propiedad para comenzar.</div>
      ) : viewMode === 'planeacion' ? (
        loading ? (
          <DataLoadingState title="Cargando planeación..." detail="Consultando horarios, puestos, necesidades y Eventuales disponibles." />
        ) : (
          <>
            <div className="planning-summary-grid">
              <article><Users size={20} /><span>Necesarios</span><strong>{resumen.necesarios}</strong></article>
              <article><UserPlus size={20} /><span>Asignados</span><strong>{resumen.asignados}</strong></article>
              <article className={resumen.faltantes ? 'warning' : ''}><CalendarDays size={20} /><span>Faltantes</span><strong>{resumen.faltantes}</strong></article>
              <article><DollarSign size={20} /><span>Costo estimado</span><strong>{money(resumen.costo)}</strong></article>
            </div>

            <div className="planning-week-grid">
              {dias.map((fecha) => {
                const needs = data.necesidades
                  .filter((item) => item.fecha === fecha && item.activo !== false)
                  .sort((a, b) => `${a.horaInicio}${a.puestoNombre}`.localeCompare(`${b.horaInicio}${b.puestoNombre}`, 'es'));
                const requiredDay = needs.reduce((sum, item) => sum + Number(item.cantidadNecesaria || 0), 0);
                const costDay = needs.reduce((sum, item) => sum + costoPlaneadoNecesidad(item, asignacionesPorNecesidad.get(item.id) || []), 0);

                return (
                  <article className="planning-day-card" key={fecha}>
                    <header>
                      <div><span>{fechaCorta(fecha)}</span><strong>{requiredDay} persona{requiredDay === 1 ? '' : 's'}</strong></div>
                      <div className="planning-day-header-actions">
                        <button type="button" className="icon-button" title="Agregar necesidad" onClick={() => openNewNeed(fecha)}><Plus size={16} /></button>
                        <button type="button" className="icon-button" title="Copiar día" onClick={() => openCopyDay(fecha)}><ClipboardCopy size={16} /></button>
                      </div>
                    </header>

                    {!needs.length ? (
                      <div className="planning-day-empty">Sin necesidades programadas.</div>
                    ) : (
                      <div className="planning-need-list">
                        {needs.map((need) => {
                          const assigned = asignacionesPorNecesidad.get(need.id) || [];
                          const missing = Math.max(0, Number(need.cantidadNecesaria || 0) - assigned.length);
                          return (
                            <section className="planning-need-card" key={need.id}>
                              <div className="planning-need-top">
                                <div>
                                  <span className="planning-time">{need.horaInicio} - {need.horaFin}</span>
                                  <strong>{need.puestoNombre}</strong>
                                  <small>{horasTexto(need.minutosDuracion)} · {money(costoPlaneadoNecesidad(need, assigned))}</small>
                                </div>
                                <div className="planning-mini-actions">
                                  <button type="button" className="icon-button" title="Editar" onClick={() => openEditNeed(need)}><Edit3 size={14} /></button>
                                  <button type="button" className="icon-button danger" title="Quitar" onClick={() => removeNeed(need)}><Trash2 size={14} /></button>
                                </div>
                              </div>

                              <div className="planning-staff-status">
                                <span>Necesarios <strong>{need.cantidadNecesaria}</strong></span>
                                <span>Asignados <strong>{assigned.length}</strong></span>
                                <span className={missing ? 'missing' : 'complete'}>{missing ? `Faltan ${missing}` : 'Completo'}</span>
                              </div>

                              {assigned.length > 0 && (
                                <div className="planning-assigned-list">
                                  {assigned.map((person) => <span key={person.id}>{person.empleadoNombre}</span>)}
                                </div>
                              )}

                              <button type="button" className="mini-button planning-assign-button" onClick={() => openAssign(need)}>
                                <UserPlus size={14} />Asignar / revisar
                              </button>
                            </section>
                          );
                        })}
                      </div>
                    )}

                    <footer>Costo estimado del día: <strong>{money(costDay)}</strong></footer>
                  </article>
                );
              })}
            </div>
          </>
        )
      ) : trackingLoading ? (
        <DataLoadingState title="Comparando planeación y asistencia..." detail="Consultando las jornadas reales de Eventuales de esta semana." />
      ) : (
        <div className="planning-tracking">
          <div className="planning-summary-grid planning-tracking-summary">
            <article><Users size={20} /><span>Programados</span><strong>{tracking.resumen?.programados || 0}</strong></article>
            <article><UserCheck size={20} /><span>Llegaron</span><strong>{tracking.resumen?.llegaron || 0}</strong></article>
            <article className={tracking.resumen?.noLlegaron ? 'warning' : ''}><UserX size={20} /><span>No llegaron</span><strong>{tracking.resumen?.noLlegaron || 0}</strong></article>
            <article className={tracking.resumen?.reemplazados ? 'replacement' : ''}><UserPlus size={20} /><span>Reemplazos</span><strong>{tracking.resumen?.reemplazados || 0}</strong></article>
            <article className={tracking.resumen?.sinProgramacion ? 'warning' : ''}><CalendarDays size={20} /><span>Sin programación</span><strong>{tracking.resumen?.sinProgramacion || 0}</strong></article>
          </div>

          <div className="planning-tracking-note">
            <Clock3 size={17} />
            <span>
              El retardo se compara directamente contra la hora de inicio programada. Actualmente no hay minutos de tolerancia configurados.
              Los turnos futuros permanecen como <strong>Programado</strong> hasta que llegue su hora. Los reemplazos se vinculan manualmente a una jornada real sin modificar la checada.
            </span>
          </div>

          <section className="planning-tracking-section">
            <div className="planning-tracking-heading">
              <div>
                <h3>Programado vs asistencia real</h3>
                <p className="muted">Entrada y salida se muestran con la zona horaria de la propiedad.</p>
              </div>
              <span className="planning-record-count">{tracking.seguimiento.length} asignación{tracking.seguimiento.length === 1 ? '' : 'es'}</span>
            </div>

            {!tracking.seguimiento.length ? (
              <div className="empty-state">No hay personas asignadas en la planeación de esta semana.</div>
            ) : (
              <div className="planning-tracking-table-wrap">
                <table className="planning-tracking-table planning-tracking-main-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Horario</th>
                      <th>Puesto</th>
                      <th>Programado</th>
                      <th>Entrada real</th>
                      <th>Salida real</th>
                      <th>Diferencia</th>
                      <th>Resultado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracking.seguimiento.map((item) => {
                      const meta = seguimientoEstadoMeta(item.estadoSeguimiento);
                      const originalMeta = seguimientoEstadoMeta(item.estadoOriginal || item.estadoSeguimiento);
                      const replacementMeta = item.reemplazo ? seguimientoEstadoMeta(item.reemplazo.estadoJornada) : null;
                      const puedeReemplazar = !item.reemplazo && ['no_llego', 'no_ha_llegado'].includes(item.estadoOriginal || item.estadoSeguimiento);
                      const candidatosDisponibles = (tracking.sinProgramacion || []).filter((candidate) => (
                        candidate.fechaJornada === item.fecha
                        && (!item.puestoId || !candidate.puestoId || candidate.puestoId === item.puestoId)
                      )).length;
                      return (
                        <tr key={item.id}>
                          <td><strong>{fechaCorta(item.fecha)}</strong></td>
                          <td>{item.horaInicio} - {item.horaFin}</td>
                          <td>{item.puestoNombre || '-'}</td>
                          <td>
                            <div className="planning-programmed-person">
                              <strong>{item.empleadoNombre || '-'}</strong>
                              {item.reemplazo && <span><UserPlus size={13} />Cubierto por {item.reemplazo.empleadoNombre}</span>}
                            </div>
                          </td>
                          <td>{item.jornada?.entradaHora || '-'}</td>
                          <td>{item.jornada?.salidaHora || '-'}</td>
                          <td className={item.retardoMinutos > 0 ? 'planning-late-text' : ''}>{diferenciaEntradaTexto(item)}</td>
                          <td>
                            <div className="planning-result-stack">
                              <span className={`planning-status-badge ${meta.className}`}>{meta.label}</span>
                              {item.reemplazo && <small>Original: {originalMeta.label}{replacementMeta ? ` · Cobertura: ${replacementMeta.label}` : ''}</small>}
                            </div>
                          </td>
                          <td>
                            {item.reemplazo ? (
                              <button type="button" className="mini-button" disabled={busy} onClick={() => removeReplacement(item)}>Quitar reemplazo</button>
                            ) : puedeReemplazar && candidatosDisponibles ? (
                              <button type="button" className="mini-button" disabled={busy} onClick={() => openReplacement(item)}>Asignar reemplazo</button>
                            ) : puedeReemplazar ? (
                              <span className="planning-no-candidate">Sin candidato</span>
                            ) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="planning-tracking-section">
            <div className="planning-tracking-heading">
              <div>
                <h3>Llegaron sin programación</h3>
                <p className="muted">Eventuales con jornada real en la propiedad que no pudieron vincularse a una asignación programada del mismo día.</p>
              </div>
              <span className="planning-record-count">{tracking.sinProgramacion.length} registro{tracking.sinProgramacion.length === 1 ? '' : 's'}</span>
            </div>

            {!tracking.sinProgramacion.length ? (
              <div className="planning-tracking-empty-ok">No se detectaron Eventuales sin programación en esta semana.</div>
            ) : (
              <div className="planning-tracking-table-wrap">
                <table className="planning-tracking-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Eventual</th>
                      <th>Puesto</th>
                      <th>Entrada</th>
                      <th>Salida</th>
                      <th>Estado de jornada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracking.sinProgramacion.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{fechaCorta(item.fechaJornada)}</strong></td>
                        <td>{item.empleadoNombre || '-'}</td>
                        <td>{item.puestoNombre || '-'}</td>
                        <td>{item.entradaHora || '-'}</td>
                        <td>{item.salidaHora || '-'}</td>
                        <td><span className="planning-status-badge warning">Sin programación{item.estado === 'salida_pendiente' ? ' · turno pendiente' : ''}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <FormModal
        open={replacementOpen}
        title="Asignar reemplazo"
        subtitle={replacementAssignment ? `${replacementAssignment.empleadoNombre} · ${replacementAssignment.fecha} · ${replacementAssignment.horaInicio}-${replacementAssignment.horaFin}` : ''}
        onClose={() => !busy && setReplacementOpen(false)}
        busy={busy}
        width="640px"
      >
        {replacementAssignment && (
          <form className="modal-form-grid" onSubmit={assignReplacement}>
            <div className="planning-replacement-summary form-full">
              <div><span>Programado</span><strong>{replacementAssignment.empleadoNombre}</strong></div>
              <div><span>Puesto</span><strong>{replacementAssignment.puestoNombre || '-'}</strong></div>
              <div><span>Turno</span><strong>{replacementAssignment.horaInicio}-{replacementAssignment.horaFin}</strong></div>
            </div>
            <label className="field-label form-full">Persona que cubrió el turno
              <select className="text-input" value={selectedReplacementJourney} onChange={(e) => setSelectedReplacementJourney(e.target.value)} required>
                <option value="">Selecciona una llegada sin programación</option>
                {replacementCandidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.empleadoNombre} · entrada {item.entradaHora || '-'}{item.salidaHora ? ` · salida ${item.salidaHora}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {!replacementCandidates.length && (
              <div className="planning-replacement-empty form-full">
                No hay Eventuales del mismo puesto con una jornada sin programación en este día.
              </div>
            )}
            <label className="field-label form-full">Comentario
              <textarea
                className="textarea-input"
                rows={3}
                maxLength={500}
                value={replacementReason}
                onChange={(e) => setReplacementReason(e.target.value)}
                placeholder="Opcional: ausencia, cambio operativo, cobertura de último momento..."
              />
            </label>
            <div className="planning-replacement-note form-full">
              La jornada real del reemplazo no se modifica. Solo se vincula con esta asignación y el cambio queda registrado en auditoría.
            </div>
            <div className="admin-form-modal-actions form-full">
              <button className="primary-button" disabled={busy || !selectedReplacementJourney}>
                {busy ? 'Registrando...' : 'Registrar reemplazo'}
              </button>
            </div>
          </form>
        )}
      </FormModal>

      <FormModal
        open={needOpen}
        title={editingNeedId ? 'Editar necesidad' : 'Agregar necesidad'}
        subtitle="Selecciona día, horario, puesto y cuántas personas se requieren."
        onClose={() => !busy && setNeedOpen(false)}
        busy={busy}
        width="680px"
      >
        <form className="modal-form-grid" onSubmit={saveNeed}>
          <label className="field-label">Fecha
            <input className="text-input" type="date" required value={needForm.fecha} onChange={(e) => setNeedForm({ ...needForm, fecha: e.target.value })} />
          </label>
          <label className="field-label">Horario
            <select className="text-input" required value={needForm.horarioId} onChange={(e) => setNeedForm({ ...needForm, horarioId: e.target.value })}>
              <option value="">Selecciona horario</option>
              {horariosActivos.map((item) => <option key={item.id} value={item.id}>{item.nombre} · {item.horaInicio}-{item.horaFin}</option>)}
            </select>
          </label>
          <label className="field-label">Puesto
            <select className="text-input" required value={needForm.puestoId} onChange={(e) => setNeedForm({ ...needForm, puestoId: e.target.value })}>
              <option value="">Selecciona puesto</option>
              {puestosActivos.map((item) => <option key={item.id} value={item.id}>{item.nombre} · {money(item.tarifaHora)}/h</option>)}
            </select>
          </label>
          <label className="field-label">Personas necesarias
            <input className="text-input" type="number" min="1" max="100" required value={needForm.cantidadNecesaria} onChange={(e) => setNeedForm({ ...needForm, cantidadNecesaria: e.target.value })} />
          </label>
          <label className="field-label form-full">Observaciones
            <textarea className="textarea-input" rows={3} maxLength={500} value={needForm.observaciones} onChange={(e) => setNeedForm({ ...needForm, observaciones: e.target.value })} placeholder="Opcional" />
          </label>
          <div className="admin-form-modal-actions form-full"><button className="primary-button" disabled={busy}>{busy ? 'Guardando...' : 'Guardar necesidad'}</button></div>
        </form>
      </FormModal>

      <FormModal
        open={assignOpen}
        title={assignNeed ? `${assignNeed.puestoNombre} · ${assignNeed.horaInicio}-${assignNeed.horaFin}` : 'Asignar Eventuales'}
        subtitle={assignNeed ? `${assignNeed.fecha} · Necesarios ${assignNeed.cantidadNecesaria}` : ''}
        onClose={() => !busy && setAssignOpen(false)}
        busy={busy}
        width="720px"
      >
        {assignNeed && (
          <div className="planning-assignment-modal">
            <div className="planning-current-assignments">
              <h4>Asignados</h4>
              {(asignacionesPorNecesidad.get(assignNeed.id) || []).length ? (
                (asignacionesPorNecesidad.get(assignNeed.id) || []).map((item) => (
                  <div key={item.id}><span>{item.empleadoNombre}</span><button type="button" className="mini-button" disabled={busy} onClick={() => removeAssignment(item)}>Quitar</button></div>
                ))
              ) : <p className="muted">Todavía no hay Eventuales asignados.</p>}
            </div>

            <form onSubmit={assignEmployee} className="planning-add-assignment">
              <label className="field-label">Eventual disponible
                <select className="text-input" value={selectedEmployee} onChange={(e) => setSelectedEmployee(e.target.value)} required>
                  <option value="">Selecciona persona</option>
                  {candidates.map((person) => <option key={person.id} value={person.id}>{person.nombre}</option>)}
                </select>
              </label>
              <button className="primary-button" disabled={busy || !selectedEmployee}>Asignar</button>
            </form>
            {!candidates.length && <p className="muted">No hay más Eventuales activos con este puesto y acceso a la propiedad.</p>}
          </div>
        )}
      </FormModal>

      <FormModal
        open={copyDayOpen}
        title="Copiar necesidades del día"
        subtitle="Copia horarios, puestos y cantidades. No se copian las personas asignadas."
        onClose={() => !busy && setCopyDayOpen(false)}
        busy={busy}
        width="560px"
      >
        <form className="modal-form-grid" onSubmit={copyDay}>
          <label className="field-label">Día origen<input className="text-input" type="date" value={copyDayForm.origen} onChange={(e) => setCopyDayForm({ ...copyDayForm, origen: e.target.value })} required /></label>
          <label className="field-label">Día destino<input className="text-input" type="date" value={copyDayForm.destino} onChange={(e) => setCopyDayForm({ ...copyDayForm, destino: e.target.value })} required /></label>
          <div className="admin-form-modal-actions form-full"><button className="primary-button" disabled={busy}>Copiar día</button></div>
        </form>
      </FormModal>
    </section>
  );
}
