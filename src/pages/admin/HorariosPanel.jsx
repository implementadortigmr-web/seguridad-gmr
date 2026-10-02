import { useEffect, useMemo, useState } from 'react';
import { Clock3, Edit3, Plus, Save } from 'lucide-react';
import CatalogTable from '../../components/CatalogTable';
import DataLoadingState from '../../components/DataLoadingState';
import FormModal from '../../components/admin/FormModal';
import { guardarHorario, listarHorarios } from '../../services/planeacionService';

const EMPTY = {
  nombre: '',
  horaInicio: '07:00',
  horaFin: '15:00',
  activo: true,
};

function duracionTexto(minutos = 0) {
  const total = Number(minutos || 0);
  const horas = Math.floor(total / 60);
  const mins = total % 60;
  return mins ? `${horas} h ${mins} min` : `${horas} h`;
}

export default function HorariosPanel({ setMessage }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(EMPTY);

  const activeCount = useMemo(() => rows.filter((item) => item.activo !== false).length, [rows]);

  async function load() {
    setLoading(true);
    try {
      const result = await listarHorarios();
      setRows(Array.isArray(result?.rows) ? result.rows : []);
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible cargar los horarios.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function nuevo() {
    setEditingId('');
    setForm(EMPTY);
    setOpen(true);
  }

  function editar(item) {
    setEditingId(item.id);
    setForm({
      nombre: item.nombre || '',
      horaInicio: item.horaInicio || '07:00',
      horaFin: item.horaFin || '15:00',
      activo: item.activo !== false,
    });
    setOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage?.('');
    try {
      await guardarHorario({ horarioId: editingId || '', ...form });
      setOpen(false);
      setEditingId('');
      setForm(EMPTY);
      await load();
      setMessage?.('Horario guardado correctamente.');
    } catch (error) {
      setMessage?.(error?.message || 'No fue posible guardar el horario.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !rows.length) {
    return <DataLoadingState title="Cargando horarios..." detail="Preparando el catálogo de turnos reutilizables." />;
  }

  return (
    <section>
      <div className="catalog-toolbar">
        <div>
          <h2>Horarios</h2>
          <p className="muted">Crea horarios reutilizables para la planeación de Eventuales. Un mismo horario puede usarse con varios puestos.</p>
        </div>
        <button type="button" className="primary-button" onClick={nuevo}><Plus size={17} />Nuevo horario</button>
      </div>

      <div className="catalog-summary-inline">
        <Clock3 size={16} /> {activeCount} activos · {rows.length - activeCount} inactivos
      </div>

      <CatalogTable
        columns={['Horario', 'Entrada', 'Salida', 'Duración', 'Cruza día', 'Estado', 'Acción']}
        rows={rows.map((item) => [
          item.nombre,
          item.horaInicio,
          item.horaFin,
          duracionTexto(item.minutosDuracion),
          item.cruzaDia ? 'Sí' : 'No',
          item.activo !== false ? 'Activo' : 'Inactivo',
          <button key={item.id} type="button" className="mini-button" onClick={() => editar(item)}><Edit3 size={14} />Editar</button>,
        ])}
      />

      <FormModal
        open={open}
        title={editingId ? 'Editar horario' : 'Nuevo horario'}
        subtitle="La duración se calcula automáticamente. Los horarios nocturnos pueden terminar al día siguiente."
        onClose={() => !busy && setOpen(false)}
        busy={busy}
        width="620px"
      >
        <form className="modal-form-grid" onSubmit={save}>
          <label className="field-label form-full">Nombre del horario
            <input className="text-input" maxLength={80} required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Matutino" />
          </label>
          <label className="field-label">Hora de entrada
            <input className="text-input" type="time" required value={form.horaInicio} onChange={(e) => setForm({ ...form, horaInicio: e.target.value })} />
          </label>
          <label className="field-label">Hora de salida
            <input className="text-input" type="time" required value={form.horaFin} onChange={(e) => setForm({ ...form, horaFin: e.target.value })} />
          </label>
          <label className="field-label">Estado
            <select className="text-input" value={form.activo ? 'true' : 'false'} onChange={(e) => setForm({ ...form, activo: e.target.value === 'true' })}>
              <option value="true">Activo</option>
              <option value="false">Inactivo</option>
            </select>
          </label>
          <div className="admin-form-modal-actions form-full">
            <button className="primary-button" disabled={busy}><Save size={16} />{busy ? 'Guardando...' : 'Guardar horario'}</button>
          </div>
        </form>
      </FormModal>
    </section>
  );
}
