import { useMemo, useState } from 'react';
import { ClipboardCopy, Download, FileUp, Inbox, UserCheck, XCircle } from 'lucide-react';
import FormModal from '../../components/admin/FormModal';
import { useFeedback } from '../../context/FeedbackContext';
import { guardarPersonal } from '../../services/personasAdminService';
import { listarSolicitudesEventuales, resolverSolicitudEventual } from '../../services/eventualesRegistroService';

function norm(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function splitLine(line, delimiter) {
  const out = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (c === delimiter && !quoted) { out.push(cell.trim()); cell = ''; }
    else cell += c;
  }
  out.push(cell.trim());
  return out;
}

function parseText(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitLine(lines[0], delimiter).map(norm);
  const aliases = {
    nombre: ['nombre', 'nombre completo', 'persona'], telefono: ['telefono', 'teléfono', 'celular'],
    puesto: ['puesto', 'puesto nombre'], propiedad: ['propiedad', 'hotel', 'unidad'], area: ['area', 'área'],
    encargado: ['encargado', 'responsable', 'capitan', 'capitán'], grupo: ['grupo', 'cuadrilla'],
  };
  const index = {};
  Object.entries(aliases).forEach(([key, names]) => { index[key] = headers.findIndex((h) => names.map(norm).includes(h)); });
  if (index.nombre < 0 || index.puesto < 0) throw new Error('La lista necesita al menos las columnas: nombre y puesto.');
  return lines.slice(1).map((line, idx) => {
    const cells = splitLine(line, delimiter);
    const get = (key) => index[key] >= 0 ? String(cells[index[key]] || '').trim() : '';
    return { fila: idx + 2, nombre: get('nombre'), telefono: get('telefono'), puesto: get('puesto'), propiedad: get('propiedad'), area: get('area'), encargadoNombre: get('encargado'), grupoNombre: get('grupo') };
  }).filter((row) => row.nombre || row.telefono || row.puesto || row.propiedad);
}

function downloadTemplate() {
  const content = '\uFEFFnombre,telefono,puesto,encargado\nJUAN PEREZ,4150000000,Mesero,Carlos Lopez\n';
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'plantilla_eventuales.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function EventualesTools({ propiedades = [], puestos = [], personas = [], onImported, setMessage }) {
  const feedback = useFeedback();
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [requests, setRequests] = useState([]);
  const [requestsBusy, setRequestsBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const [preview, setPreview] = useState([]);
  const [importBusy, setImportBusy] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const activeProperties = useMemo(() => propiedades.filter((p) => p.activo === true && !norm(`${p.codigo || ''} ${p.nombre || ''}`).includes('mexico')), [propiedades]);
  const allPropertyIds = useMemo(() => activeProperties.map((p) => p.id), [activeProperties]);
  const activeJobs = useMemo(() => puestos.filter((p) => p.activo !== false), [puestos]);

  async function copyLink() {
    const url = `${window.location.origin}/#/registro-eventual`;
    try { await navigator.clipboard.writeText(url); setMessage?.('Liga de registro de Eventuales copiada.'); }
    catch { setMessage?.(`Liga de registro: ${url}`); }
  }

  async function loadRequests() {
    setRequestsBusy(true);
    try { const data = await listarSolicitudesEventuales('pendiente'); setRequests(data?.rows || []); }
    catch (e) { setMessage?.(e?.message || 'No fue posible cargar solicitudes.'); }
    finally { setRequestsBusy(false); }
  }

  async function openRequests() { setRequestsOpen(true); await loadRequests(); }

  async function approve(item) {
    const ok = await feedback.confirm({ title: 'Aprobar eventual', message: `Se creará la ficha de ${item.nombre} como ${item.puestoNombre} para ${item.propiedadNombre || 'las propiedades solicitadas'} y se generará su QR.`, confirmText: 'Aprobar y crear QR', type: 'warning' });
    if (!ok) return;
    setRequestsBusy(true);
    try { await resolverSolicitudEventual({ solicitudId: item.id, accion: 'aprobar' }); await loadRequests(); await onImported?.(); setMessage?.('Solicitud aprobada. El eventual ya aparece en Personal y su QR quedó habilitado.'); }
    catch (e) { setMessage?.(e?.message || 'No fue posible aprobar la solicitud.'); }
    finally { setRequestsBusy(false); }
  }

  async function rejectSubmit(event) {
    event.preventDefault(); if (!rejecting || !rejectReason.trim()) return;
    setRequestsBusy(true);
    try { await resolverSolicitudEventual({ solicitudId: rejecting.id, accion: 'rechazar', motivoRechazo: rejectReason.trim() }); setRejecting(null); setRejectReason(''); await loadRequests(); setMessage?.('Solicitud rechazada.'); }
    catch (e) { setMessage?.(e?.message || 'No fue posible rechazar la solicitud.'); }
    finally { setRequestsBusy(false); }
  }

  function preparePreview(text = sourceText) {
    try {
      const raw = parseText(text);
      if (!raw.length) throw new Error('No se encontraron personas en la lista.');
      if (raw.length > 100) throw new Error('Importa máximo 100 personas por operación.');
      const existing = new Set(personas.map((p) => `${norm(p.nombre)}|${norm(p.telefono)}`));
      const result = raw.map((row) => {
        const job = activeJobs.find((p) => [norm(p.nombre), norm(p.id)].includes(norm(row.puesto)));
        const property = { nombre: 'Todas las propiedades', ids: allPropertyIds };
        const duplicate = existing.has(`${norm(row.nombre)}|${norm(row.telefono)}`);
        const errors = [];
        if (!row.nombre) errors.push('Falta nombre');
        if (!job) errors.push('Puesto no encontrado');
        if (!allPropertyIds.length) errors.push('No hay propiedades operativas activas');
        if (duplicate) errors.push('Posible duplicado');
        return { ...row, job, property, duplicate, errors };
      });
      setPreview(result);
    } catch (e) { setPreview([]); setMessage?.(e?.message || 'No fue posible leer la lista.'); }
  }

  async function readFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) { setMessage?.('El archivo supera 1 MB.'); return; }
    const text = await file.text(); setSourceText(text); preparePreview(text);
  }

  async function importRows() {
    const valid = preview.filter((r) => !r.errors.length);
    if (!valid.length) { setMessage?.('No hay filas válidas para importar.'); return; }
    const ok = await feedback.confirm({ title: 'Confirmar importación', message: `Se crearán ${valid.length} eventuales. Las filas marcadas con error no se importarán.`, confirmText: 'Importar', type: 'warning' });
    if (!ok) return;
    setImportBusy(true);
    let created = 0; const failed = [];
    for (const row of valid) {
      try {
        await guardarPersonal({ nombre: row.nombre, telefono: row.telefono, tipo: 'eventual', propiedadesPermitidas: row.property.ids, area: '', puestoId: row.job.id, tarifaPersonalizada: null, encargadoNombre: row.encargadoNombre || '', grupoNombre: '', activo: true });
        created += 1;
      } catch (e) { failed.push(`${row.nombre}: ${e?.message || 'error'}`); }
    }
    setImportBusy(false);
    await onImported?.();
    if (failed.length) setMessage?.(`Importación: ${created} creados y ${failed.length} con error. Primer error: ${failed[0]}`);
    else { setMessage?.(`Importación terminada: ${created} eventuales creados con QR.`); setImportOpen(false); setPreview([]); setSourceText(''); }
  }

  return <>
    <div className="eventual-tools-row">
      <button type="button" className="secondary-button" onClick={copyLink}><ClipboardCopy size={16} /> Copiar liga de registro</button>
      <button type="button" className="secondary-button" onClick={openRequests}><Inbox size={16} /> Solicitudes pendientes</button>
      <button type="button" className="secondary-button" onClick={() => setImportOpen(true)}><FileUp size={16} /> Importar lista</button>
    </div>

    <FormModal open={requestsOpen} title="Solicitudes de Eventuales" subtitle="Solo para solicitudes antiguas que quedaron pendientes antes del alta inmediata." onClose={() => !requestsBusy && setRequestsOpen(false)} width="860px" busy={requestsBusy}>
      {requestsBusy && !requests.length ? <p>Cargando solicitudes...</p> : requests.length ? <div className="eventual-request-list">{requests.map((item) => <article className="eventual-request-card" key={item.id}>
        <div><strong>{item.nombre}</strong><span>{item.telefono || 'Sin teléfono'}</span><small>{item.puestoNombre} · {item.propiedadNombre}</small>{item.encargadoNombre && <small>Encargado: {item.encargadoNombre}</small>}</div>
        <div className="table-actions"><button type="button" className="mini-button" disabled={requestsBusy} onClick={() => approve(item)}><UserCheck size={14} /> Aprobar</button><button type="button" className="mini-button" disabled={requestsBusy} onClick={() => { setRejecting(item); setRejectReason(''); }}><XCircle size={14} /> Rechazar</button></div>
      </article>)}</div> : <p className="muted">No hay solicitudes pendientes.</p>}
    </FormModal>

    <FormModal open={Boolean(rejecting)} title="Rechazar solicitud" subtitle={rejecting ? rejecting.nombre : ''} onClose={() => !requestsBusy && setRejecting(null)} width="520px" busy={requestsBusy}>
      <form onSubmit={rejectSubmit}><label className="field-label">Motivo<textarea className="text-input" rows="4" maxLength={300} required value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /></label><div className="admin-form-modal-actions"><button className="primary-button" disabled={requestsBusy || !rejectReason.trim()}>Confirmar rechazo</button></div></form>
    </FormModal>

    <FormModal open={importOpen} title="Importar lista de Eventuales" subtitle="Se asignarán todas las propiedades operativas activas. Acepta CSV o datos copiados de Excel." onClose={() => !importBusy && setImportOpen(false)} width="980px" busy={importBusy}>
      <div className="eventual-import-actions"><button type="button" className="secondary-button" onClick={downloadTemplate}><Download size={16} /> Descargar plantilla CSV</button><label className="secondary-button eventual-file-button"><FileUp size={16} /> Elegir CSV/TXT<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={readFile} /></label></div>
      <label className="field-label">O pega aquí la lista de Excel<textarea className="text-input" rows="7" value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder={'nombre\ttelefono\tpuesto\tencargado\nJuan Pérez\t415...\tMesero\tCarlos López'} /></label>
      <button type="button" className="secondary-button" onClick={() => preparePreview()}>Validar lista</button>
      {preview.length > 0 && <div className="eventual-import-preview"><p><strong>{preview.length} filas:</strong> {preview.filter((r) => !r.errors.length).length} listas para importar · {preview.filter((r) => r.errors.length).length} requieren revisión.</p><div className="asistencia-table-wrap"><table><thead><tr><th>Fila</th><th>Nombre</th><th>Puesto</th><th>Ámbito</th><th>Resultado</th></tr></thead><tbody>{preview.map((r) => <tr key={`${r.fila}-${r.nombre}`}><td>{r.fila}</td><td>{r.nombre}</td><td>{r.job?.nombre || r.puesto}</td><td>{r.property?.nombre || r.propiedad}</td><td>{r.errors.length ? r.errors.join(', ') : 'Lista para importar'}</td></tr>)}</tbody></table></div><div className="admin-form-modal-actions"><button type="button" className="primary-button" disabled={importBusy || !preview.some((r) => !r.errors.length)} onClick={importRows}>{importBusy ? 'Importando...' : `Importar ${preview.filter((r) => !r.errors.length).length} personas`}</button></div></div>}
    </FormModal>
  </>;
}
