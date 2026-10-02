import { useEffect, useRef, useState } from 'react';
import { llamarAsistencia, listarPersonal, mensajeAsistencia } from '../services/asistenciaService';
import { parseCsv, descargarTexto } from '../utils/csv';
import { validarPersonal } from '../../../../shared/asistenciaDomain';
import MessageBox from '../../../components/MessageBox';
import { useFeedback } from '../../../context/FeedbackContext';

const fresh = (mexico) => ({ clave: '', nombre: '', tipo: mexico ? 'personal_mexico' : 'eventual', area: '', puesto: '', activo: true });
export default function PersonalAsistencia({ propiedad }) {
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState(fresh(propiedad.asistencia?.fotoEntrada));
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const feedback = useFeedback();
  async function load() { setPeople(await listarPersonal(propiedad.id)); }
  useEffect(() => { let alive = true; listarPersonal(propiedad.id).then((p) => { if (alive) setPeople(p); }).catch((e) => { if (alive) setMessage(mensajeAsistencia(e)); }); return () => { alive = false; }; }, [propiedad.id]);
  async function save(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const fields = validarPersonal(form);
      await llamarAsistencia('asistenciaGuardarPersonal', { ...fields, propiedadId: propiedad.id, empleadoId: editing });
      setEditing(null); setForm(fresh(propiedad.asistencia?.fotoEntrada)); await load(); setMessage('Personal guardado. Esta ficha no crea una cuenta de acceso a la app.');
    } catch (e) { setMessage(mensajeAsistencia(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function importCsv(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      if (file.size > 1024 * 1024) throw new Error('El CSV supera 1 MB. Divide el archivo.');
      const rows = parseCsv(await file.text()).map(validarPersonal);
      if (!rows.length || rows.length > 300) throw new Error('Importa entre 1 y 300 personas por archivo.');
      if (new Set(rows.map((r) => r.clave)).size !== rows.length) throw new Error('Hay claves repetidas dentro del CSV.');
      if (!(await feedback.confirm({ title: 'Confirmar importación', message: `Crear ${rows.length} fichas en ${propiedad.nombre}? Las claves existentes se omitirán sin modificar.`, confirmText: 'Importar', type: 'warning' }))) return;
      let created = 0; let skipped = 0;
      for (const row of rows) {
        try { await llamarAsistencia('asistenciaGuardarPersonal', { ...row, propiedadId: propiedad.id }); created++; }
        catch (e) { if (e.code === 'functions/already-exists') skipped++; else throw new Error(`${created} creadas, ${skipped} omitidas. Fallo ${row.clave}: ${mensajeAsistencia(e)}`); }
        setMessage(`Importando: ${created + skipped} de ${rows.length}...`);
      }
      await load(); setMessage(`Importacion terminada: ${created} nuevas, ${skipped} existentes omitidas.`);
    } catch (e) { setMessage(mensajeAsistencia(e)); await load().catch(() => {}); }
    finally { lock.current = false; setBusy(false); }
  }
  function field(key, label, maxLength = 100) {
    return <label>{label}<input value={form[key]} maxLength={maxLength} disabled={busy || (key === 'clave' && Boolean(editing))}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} required={['clave', 'nombre'].includes(key)} /></label>;
  }
  return <section>
    <h2>Personal de {propiedad.nombre}</h2>
    <p className="asistencia-note">Cada persona tiene su propia clave de checada. No necesita usuario de Firebase. Conserva los ceros iniciales: 00036 no es 36.</p>
    {message && <MessageBox>{message}</MessageBox>}
    <form onSubmit={save} className="asistencia-form-grid">
      {field('clave', 'Clave del empleado', 32)}{field('nombre', 'Nombre completo', 160)}
      <label>Tipo de personal<select value={form.tipo} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}>
        <option value="eventual">Eventual</option><option value="practicante">Practicante</option><option value="personal_mexico">Personal Mexico</option>
      </select></label>
      {field('area', 'Area')}{field('puesto', 'Puesto (informativo)')}
      <label>Estado<select value={String(form.activo)} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, activo: e.target.value === 'true' }))}>
        <option value="true">Activo</option><option value="false">Inactivo</option></select></label>
      <div className="asistencia-actions"><button type="submit" className="asistencia-primary" disabled={busy}>{busy ? 'Guardando...' : editing ? 'Guardar cambios' : 'Agregar persona'}</button>
        {editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setForm(fresh(propiedad.asistencia?.fotoEntrada)); }}>Cancelar edicion</button>}</div>
    </form>
    <div className="asistencia-actions">
      <button type="button" disabled={busy} onClick={() => descargarTexto('plantilla_personal.csv', 'clave,nombre,tipo,area,puesto\nEJEMPLO001,PERSONA DE EJEMPLO,personal_mexico,Ventas,Ejecutivo\n')}>Plantilla CSV</button>
      <label className="asistencia-file-label">Importar personal CSV<input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={busy} /></label>
    </div>
    <p>Mostrando {people.length} registros (limite de esta vista: 500).</p>
    <div className="asistencia-table-wrap"><table><thead><tr><th>Clave</th><th>Nombre</th><th>Tipo</th><th>Estado</th><th>Accion</th></tr></thead>
      <tbody>{people.map((p) => <tr key={p.id}><td>{p.clave}</td><td>{p.nombre}</td><td>{p.tipo}</td><td>{p.activo ? 'Activo' : 'Inactivo'}</td><td><button type="button" disabled={busy} onClick={() => { setEditing(p.id); setForm({ clave: p.clave, nombre: p.nombre, tipo: p.tipo, area: p.area || '', puesto: p.puesto || '', activo: p.activo }); }}>Editar</button></td></tr>)}</tbody></table></div>
  </section>;
}
