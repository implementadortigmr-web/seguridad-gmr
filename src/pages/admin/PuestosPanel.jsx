import { useEffect, useMemo, useState } from 'react';
import { Edit3, Plus, Save } from 'lucide-react';
import CatalogTable from '../../components/CatalogTable';
import FormModal from '../../components/admin/FormModal';
import { guardarPuesto, listarPuestos } from '../../services/personasAdminService';

const EMPTY = { nombre: '', descripcion: '', tarifaHora: '', activo: true };

export default function PuestosPanel({ setMessage }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(EMPTY);
  const activos = useMemo(() => rows.filter((x) => x.activo !== false), [rows]);

  async function load() {
    setLoading(true);
    try { setRows(await listarPuestos()); }
    catch (e) { setMessage?.(e?.message || 'No fue posible cargar los puestos.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function nuevo() { setEditingId(''); setForm(EMPTY); setOpen(true); }
  function editar(item) {
    setEditingId(item.id);
    setForm({ nombre: item.nombre || '', descripcion: item.descripcion || '', tarifaHora: String(item.tarifaHora ?? ''), activo: item.activo !== false });
    setOpen(true);
  }
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage?.('');
    try {
      await guardarPuesto({ puestoId: editingId, ...form, tarifaHora: Number(form.tarifaHora) });
      setOpen(false); setForm(EMPTY); setEditingId(''); await load();
      setMessage?.('Puesto guardado correctamente.');
    } catch (e) { setMessage?.(e?.message || 'No fue posible guardar el puesto.'); }
    finally { setBusy(false); }
  }

  return <section>
    <div className="catalog-toolbar">
      <div><h2>Puestos</h2><p className="muted">Solo se asignan a eventuales. La tarifa del puesto se copia a cada jornada para conservar el historial.</p></div>
      <button type="button" className="primary-button" onClick={nuevo}><Plus size={17}/>Nuevo puesto</button>
    </div>
    <div className="catalog-summary-inline">{loading ? 'Cargando...' : `${activos.length} activos · ${rows.length - activos.length} inactivos`}</div>
    <CatalogTable columns={['Puesto','Tarifa por hora','Estado','Acción']} rows={rows.map((item) => [
      item.nombre,
      `$${Number(item.tarifaHora || 0).toFixed(2)}`,
      item.activo !== false ? 'Activo' : 'Inactivo',
      <button key={item.id} type="button" className="mini-button" onClick={() => editar(item)}><Edit3 size={14}/>Editar</button>,
    ])}/>

    <FormModal open={open} title={editingId ? 'Editar puesto' : 'Nuevo puesto'} subtitle="La tarifa se utiliza únicamente para personal eventual." onClose={() => !busy && setOpen(false)} busy={busy}>
      <form onSubmit={save} className="modal-form-grid">
        <label className="field-label">Nombre del puesto<input className="text-input" required maxLength={120} value={form.nombre} onChange={(e) => setForm({...form, nombre:e.target.value})}/></label>
        <label className="field-label">Tarifa por hora<input className="text-input" type="number" min="0" step="0.01" required value={form.tarifaHora} onChange={(e) => setForm({...form, tarifaHora:e.target.value})}/></label>
        <label className="field-label form-full">Descripción<textarea className="textarea-input" maxLength={500} rows={3} value={form.descripcion} onChange={(e) => setForm({...form, descripcion:e.target.value})}/></label>
        <label className="field-label">Estado<select className="text-input" value={form.activo ? 'true':'false'} onChange={(e) => setForm({...form, activo:e.target.value==='true'})}><option value="true">Activo</option><option value="false">Inactivo</option></select></label>
        <div className="admin-form-modal-actions form-full"><button className="primary-button" disabled={busy}><Save size={16}/>{busy?'Guardando...':'Guardar'}</button></div>
      </form>
    </FormModal>
  </section>;
}
