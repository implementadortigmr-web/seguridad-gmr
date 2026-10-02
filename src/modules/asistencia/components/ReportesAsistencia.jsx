import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Download,
  Eye,
  Search,
  X,
} from 'lucide-react';

import DataLoadingState from '../../../components/DataLoadingState';
import MessageBox from '../../../components/MessageBox';
import { useFeedback } from '../../../context/FeedbackContext';
import {
  consultarJornadas,
  exportarTodasJornadas,
  listarPersonal,
  llamarAsistencia,
  mensajeAsistencia,
} from '../services/asistenciaService';
import { fechaEnZona } from '../../../../shared/asistenciaDomain';
import {
  fechaTexto,
  duracionTexto,
  estadoTexto,
  exportarCsvAsistencia,
  exportarPdfAsistencia,
} from '../utils/reportes';
import FotoAsistencia from './FotoAsistencia';
import '../asistencia.css';

function filtrosIniciales(propiedad, tipoPersonal) {
  const today = fechaEnZona(
    new Date(),
    propiedad.asistencia?.zonaHoraria
  );

  return {
    desde: `${today.slice(0, 7)}-01`,
    hasta: today,
    empleadoId: '',
    estado: '',
    propiedadId: propiedad.id,
    tipoPersonal,
  };
}

export default function ReportesAsistencia({
  profile,
  propiedad,
  tipoPersonal = '',
}) {
  const initial = filtrosIniciales(propiedad, tipoPersonal);
  const [form, setForm] = useState({
    desde: initial.desde,
    hasta: initial.hasta,
    empleadoId: '',
    estado: '',
  });
  const [applied, setApplied] = useState(null);
  const [people, setPeople] = useState([]);
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [more, setMore] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState(null);
  const [salida, setSalida] = useState('');
  const [motivo, setMotivo] = useState('');

  const lock = useRef(false);
  const feedback = useFeedback();
  const serial = useRef(0);

  const executeQuery = useCallback(async ({
    filters,
    append = false,
    currentCursor = null,
  }) => {
    const version = ++serial.current;
    const page = await consultarJornadas({
      ...filters,
      cursor: append ? currentCursor : null,
      pageSize: 50,
    });

    if (version !== serial.current) return null;
    return page;
  }, []);

  useEffect(() => {
    let alive = true;
    const filters = filtrosIniciales(propiedad, tipoPersonal);

    setForm({
      desde: filters.desde,
      hasta: filters.hasta,
      empleadoId: '',
      estado: '',
    });
    setPeople([]);
    setRows([]);
    setCursor(null);
    setMore(false);
    setApplied(filters);
    setDetail(null);
    setMessage('');
    setPeopleLoading(true);
    setReportLoading(true);

    Promise.all([
      listarPersonal(propiedad.id, tipoPersonal),
      executeQuery({ filters }),
    ])
      .then(([items, page]) => {
        if (!alive) return;
        setPeople(items);
        if (page) {
          setRows(page.rows);
          setCursor(page.cursor);
          setMore(page.more);
        }
      })
      .catch((error) => {
        if (alive) setMessage(mensajeAsistencia(error));
      })
      .finally(() => {
        if (alive) {
          setPeopleLoading(false);
          setReportLoading(false);
        }
      });

    return () => {
      alive = false;
      serial.current += 1;
    };
  }, [propiedad.id, propiedad.asistencia?.zonaHoraria, tipoPersonal, executeQuery]);

  async function load(append = false, override = null) {
    if (lock.current) return;

    const filters = override || (append
      ? applied
      : {
          ...form,
          propiedadId: propiedad.id,
          tipoPersonal,
        });

    if (!filters || filters.desde > filters.hasta) {
      setMessage('El rango de fechas no es válido.');
      return;
    }

    lock.current = true;
    setReportLoading(true);
    setMessage('');

    try {
      const page = await executeQuery({
        filters,
        append,
        currentCursor: cursor,
      });

      if (!page) return;

      setRows((old) => append ? [...old, ...page.rows] : page.rows);
      setCursor(page.cursor);
      setMore(page.more);
      setApplied(filters);
      if (!append) setDetail(null);
    } catch (error) {
      setMessage(mensajeAsistencia(error));
    } finally {
      lock.current = false;
      setReportLoading(false);
    }
  }

  async function exportReport(kind) {
    if (lock.current || !applied || exportLoading) return;

    lock.current = true;
    setExportLoading(true);
    setMessage('');

    try {
      const all = await exportarTodasJornadas(applied);
      if (!all.length) throw new Error('No hay registros para exportar.');

      if (kind === 'pdf') {
        await exportarPdfAsistencia(all, applied);
      } else {
        exportarCsvAsistencia(all, applied);
      }

      setMessage(`Reporte generado con ${all.length} jornadas.`);
    } catch (error) {
      setMessage(mensajeAsistencia(error));
    } finally {
      lock.current = false;
      setExportLoading(false);
    }
  }

  async function closeManually(event) {
    event.preventDefault();
    if (lock.current || !detail) return;

    if (!(await feedback.confirm({ title: 'Confirmar cierre manual', message: 'Registrar esta salida manual? La corrección quedará registrada en auditoría.', confirmText: 'Registrar salida', type: 'warning' }))) {
      return;
    }

    lock.current = true;
    setReportLoading(true);
    setMessage('');

    try {
      const parsed = new Date(salida);
      if (!Number.isFinite(parsed.getTime())) {
        throw new Error('Captura fecha y hora de salida.');
      }

      await llamarAsistencia('asistenciaCerrarJornadaManual', {
        jornadaId: detail.id,
        salidaIso: parsed.toISOString(),
        motivo,
      });

      setDetail(null);
      setSalida('');
      setMotivo('');
      lock.current = false;
      await load(false, applied);
      setMessage('Cierre manual registrado.');
    } catch (error) {
      setMessage(mensajeAsistencia(error));
    } finally {
      lock.current = false;
      setReportLoading(false);
    }
  }

  const emptyText = tipoPersonal === 'eventual'
    ? 'No hay jornadas de eventuales con los filtros seleccionados.'
    : tipoPersonal === 'practicante'
      ? 'No hay jornadas de practicantes con los filtros seleccionados.'
      : 'No hay jornadas con los filtros seleccionados.';

  return (
    <section className="asistencia-module asistencia-report-page">
      <div className="asistencia-report-title">
        <div>
          <span className="asistencia-eyebrow">Reportes</span>
          <h2>Asistencia {propiedad.nombre}</h2>
        </div>
        <CalendarDays size={24} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          load();
        }}
        className="asistencia-form-grid asistencia-report-filters"
      >
        <label>
          Desde
          <input
            type="date"
            required
            value={form.desde}
            onChange={(event) => setForm({ ...form, desde: event.target.value })}
          />
        </label>

        <label>
          Hasta
          <input
            type="date"
            required
            value={form.hasta}
            onChange={(event) => setForm({ ...form, hasta: event.target.value })}
          />
        </label>

        <label>
          Empleado
          <select
            value={form.empleadoId}
            disabled={peopleLoading}
            onChange={(event) => setForm({ ...form, empleadoId: event.target.value })}
          >
            <option value="">
              {peopleLoading ? 'Cargando personal...' : 'Todos'}
            </option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.clave} - {person.nombre}
              </option>
            ))}
          </select>
        </label>

        <label>
          Estado
          <select
            value={form.estado}
            onChange={(event) => setForm({ ...form, estado: event.target.value })}
          >
            <option value="">Todos</option>
            <option value="abierta">Turno abierto</option>
            <option value="salida_pendiente">Salida pendiente</option>
            <option value="sin_salida">Sin salida registrada</option>
            <option value="completa">Completa</option>
            <option value="corregida">Cierre manual</option>
          </select>
        </label>

        <button type="submit" className="asistencia-primary" disabled={reportLoading}>
          <Search size={17} />
          {reportLoading ? 'Consultando...' : 'Consultar'}
        </button>
      </form>

      {message && <MessageBox>{message}</MessageBox>}

      <div className="asistencia-report-actions">
        <button
          type="button"
          disabled={reportLoading || exportLoading || !applied || !rows.length}
          onClick={() => exportReport('pdf')}
        >
          <Download size={16} />
          {exportLoading ? 'Preparando...' : 'PDF'}
        </button>
        <button
          type="button"
          disabled={reportLoading || exportLoading || !applied || !rows.length}
          onClick={() => exportReport('csv')}
        >
          <Download size={16} />
          Excel / CSV
        </button>
      </div>

      {reportLoading ? (
        <DataLoadingState
          title="Consultando jornadas..."
          detail="Aplicando filtros y cargando los primeros 50 registros."
        />
      ) : (
        <>
          <div className="asistencia-report-summary">
            <strong>{rows.length}</strong>
            <span>{more ? 'jornadas cargadas · hay más resultados' : 'jornadas cargadas'}</span>
          </div>

          {rows.length ? (
            <div className="asistencia-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Empleado</th>
                    {tipoPersonal === 'eventual' && <th>Puesto</th>}
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th>Duración</th>
                    <th>Estado</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.empleadoNombre}</strong>
                        <small>{row.claveEmpleado}</small>
                      </td>
                      {tipoPersonal === 'eventual' && (
                        <td>{row.puestoNombre || 'Sin puesto'}</td>
                      )}
                      <td>{fechaTexto(row.entradaEn, row.zonaHoraria)}</td>
                      <td>
                        {row.salidaEn
                          ? fechaTexto(row.salidaEn, row.zonaHoraria)
                          : 'Sin salida'}
                      </td>
                      <td>{duracionTexto(row)}</td>
                      <td>{estadoTexto(row)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => {
                            setDetail(row);
                            setSalida('');
                            setMotivo('');
                          }}
                        >
                          <Eye size={16} /> Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">{emptyText}</div>
          )}

          {more && (
            <button
              type="button"
              className="secondary-button asistencia-load-more"
              disabled={reportLoading}
              onClick={() => load(true)}
            >
              Cargar 50 más
            </button>
          )}
        </>
      )}

      {detail && (
        <div
          className="asistencia-detail-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Detalle de asistencia"
        >
          <section className="asistencia-detail-card">
            <div className="asistencia-detail-header">
              <div>
                <span className="asistencia-eyebrow">Detalle</span>
                <h3>{detail.empleadoNombre}</h3>
                <p>{detail.claveEmpleado}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                disabled={reportLoading}
                aria-label="Cerrar detalle"
              >
                <X size={18} />
              </button>
            </div>

            <div className="asistencia-detail-stats">
              <div>
                <span>Entrada</span>
                <strong>{fechaTexto(detail.entradaEn, detail.zonaHoraria)}</strong>
              </div>
              <div>
                <span>Salida</span>
                <strong>
                  {detail.salidaEn
                    ? fechaTexto(detail.salidaEn, detail.zonaHoraria)
                    : 'Sin salida'}
                </strong>
              </div>
              <div>
                <span>Duración</span>
                <strong>{duracionTexto(detail)}</strong>
              </div>
              <div>
                <span>Estado</span>
                <strong>{estadoTexto(detail)}</strong>
              </div>
            </div>

            {tipoPersonal === 'eventual' && (
              <p className="asistencia-note">
                Puesto: <strong>{detail.puestoNombre || 'Sin puesto'}</strong>
                {Number.isFinite(Number(detail.tarifaHoraAplicada))
                  ? ` · Tarifa aplicada: $${Number(detail.tarifaHoraAplicada).toFixed(2)} / hora`
                  : ''}
              </p>
            )}

            <div className="asistencia-photos">
              <FotoAsistencia path={detail.entradaFotoPath} label="Fotografía de entrada" />
              <FotoAsistencia path={detail.salidaFotoPath} label="Fotografía de salida" />
            </div>

            {detail.motivoCorreccion && (
              <p>Justificación de cierre manual: {detail.motivoCorreccion}</p>
            )}

            {detail.estado === 'sin_salida' && (
              <p className="asistencia-note">
                Esta jornada quedó sin hora de salida. {detail.cierreAutomatico
                  ? 'El sistema la cerró automáticamente al superar el límite configurado.'
                  : 'Seguridad confirmó que no se registró la salida.'}
              </p>
            )}

            {detail.estado === 'salida_pendiente' && (
              <p className="asistencia-note">
                El turno superó el límite configurado y está pendiente de resolución por Seguridad.
              </p>
            )}

            {profile.rol === 'administrador' && ['abierta', 'salida_pendiente', 'sin_salida'].includes(detail.estado) && (
              <form onSubmit={closeManually} className="asistencia-form-grid">
                <h4 className="asistencia-full">Cierre manual autorizado</h4>
                <label>
                  Fecha y hora de salida
                  <input
                    type="datetime-local"
                    required
                    value={salida}
                    onChange={(event) => setSalida(event.target.value)}
                  />
                </label>
                <label>
                  Justificación
                  <textarea
                    required
                    minLength={10}
                    maxLength={1000}
                    value={motivo}
                    onChange={(event) => setMotivo(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={reportLoading} className="asistencia-primary">
                  Registrar cierre manual
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
