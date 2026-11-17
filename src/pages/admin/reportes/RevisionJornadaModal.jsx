import { useEffect, useRef, useState } from 'react';
import FormModal from '../../../components/admin/FormModal';
import { useFeedback } from '../../../context/FeedbackContext';
import { llamarAsistencia, mensajeAsistencia } from '../../../modules/asistencia/services/asistenciaService';
import { listarPuestos } from '../../../services/personasAdminService';
import { fechaHoraEnZona, tiempoMs, MAX_RESPALDO_BYTES } from '../../../../shared/operacionEventuales';
import './revisionJornada.css';

function base64Archivo(file) {
  return new Promise((resolve,reject)=>{
    const r=new FileReader(); r.onload=()=>resolve(String(r.result).split(',')[1]);
    r.onerror=()=>reject(new Error('No fue posible leer el documento.')); r.readAsDataURL(file);
  });
}
async function descargarRespaldo(id) {
  const result=await llamarAsistencia('asistenciaDescargarRespaldo',{respaldoId:id});
  const bytes=Uint8Array.from(atob(result.contenido),c=>c.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:result.mime}));
  const a=document.createElement('a');a.href=url;a.download=result.nombre || 'respaldo';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}
export default function RevisionJornadaModal({open,jornada=null,propiedad,personal=[],limiteHoras=16,onClose,onSaved}) {
  const feedback=useFeedback(),request=useRef('');
  const [busy,setBusy]=useState(false),[puestos,setPuestos]=useState([]),[file,setFile]=useState(null),[history,setHistory]=useState([]);
  const [form,setForm]=useState({empleadoId:'',entradaLocal:'',salidaLocal:'',puestoId:'',motivo:'',accion:'corregir',confirmarExcepcion:false});
  const zone=jornada?.zonaHoraria || propiedad?.asistencia?.zonaHoraria || 'America/Mexico_City';
  useEffect(()=>{
    if(!open) return;
    let alive=true;request.current=crypto.randomUUID();setFile(null);setHistory([]);
    setForm({empleadoId:jornada?.empleadoId || '',entradaLocal:fechaHoraEnZona(jornada?.entradaEn,zone),salidaLocal:fechaHoraEnZona(jornada?.salidaEn,zone),puestoId:jornada?.puestoId || '',motivo:'',accion:'corregir',confirmarExcepcion:false});
    listarPuestos().then(rows=>{if(alive)setPuestos(rows);}).catch(e=>feedback.error(mensajeAsistencia(e)));
    if(jornada?.id) llamarAsistencia('asistenciaHistorialRevision',{jornadaId:jornada.id}).then(r=>{if(alive)setHistory(r.historial || []);}).catch(e=>feedback.error(mensajeAsistencia(e)));
    return ()=>{alive=false;};
  },[open,jornada,zone]); // eslint-disable-line react-hooks/exhaustive-deps
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  async function save(e) {
    e.preventDefault();if(busy)return;
    if(!file || file.size>MAX_RESPALDO_BYTES || !['application/pdf','image/jpeg','image/png'].includes(file.type)) {feedback.warning('Adjunta la hoja firmada o documento de respaldo en PDF, JPG o PNG hasta 4 MB.');return;}
    const ok=await feedback.confirm({title:jornada?'Guardar correccion con respaldo':'Agregar jornada manual',message:'Se conservaran los registros originales y el documento. Revisa fecha de salida, puesto y zona horaria. Esta accion recalcula el reporte, no confirma un pago entregado.',confirmText:'Guardar con respaldo',type:'warning'});
    if(!ok)return;setBusy(true);
    try {
      const payload={solicitudId:request.current,empleadoId:form.empleadoId,propiedadId:propiedad.id};
      const evidence=await llamarAsistencia('asistenciaCargarRespaldo',{...payload,nombre:file.name,contenido:await base64Archivo(file)});
      await llamarAsistencia('asistenciaGuardarJornadaConRespaldo',{...payload,...form,jornadaId:jornada?.id || '',versionEsperada:tiempoMs(jornada?.actualizadoEn) || 0,respaldoId:evidence.respaldoId});
      feedback.success('Jornada guardada con respaldo e historial.');onSaved?.();
    } catch(err) {feedback.error(mensajeAsistencia(err));} finally {setBusy(false);}
  }
  return <FormModal open={open} title={jornada?'Revision / editar jornada':'Agregar jornada manual'} subtitle={`Fecha y hora de la propiedad: ${zone}`} width="860px" busy={busy} onClose={()=>!busy&&onClose()}>
    <form className="gmr-revision-form" onSubmit={save}>
      <p className="gmr-revision-notice">Usa la hoja de registro firmada. No sustituyas la evidencia por una hora estimada. Las correcciones no borran las checadas originales.</p>
      <div className="gmr-revision-grid">
        <label>Eventual<select required disabled={Boolean(jornada)||busy} value={form.empleadoId} onChange={e=>{const p=personal.find(x=>x.id===e.target.value);setForm(f=>({...f,empleadoId:e.target.value,puestoId:p?.puestoId || ''}));}}><option value="">Selecciona persona</option>{personal.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}{jornada&&!personal.some(p=>p.id===jornada.empleadoId)&&<option value={jornada.empleadoId}>{jornada.empleadoNombre}</option>}</select></label>
        <label>Puesto realmente desempenado<select required disabled={busy} value={form.puestoId} onChange={e=>set('puestoId',e.target.value)}><option value="">Selecciona puesto</option>{puestos.filter(p=>p.activo!==false||p.id===form.puestoId).map(p=><option key={p.id} value={p.id}>{p.nombre} - ${Number(p.tarifaHora || 0).toFixed(2)}/h</option>)}</select></label>
        <label>Fecha y hora de entrada<input type="datetime-local" required value={form.entradaLocal} disabled={busy} onChange={e=>set('entradaLocal',e.target.value)}/></label>
        <label>Fecha y hora de salida<input type="datetime-local" required={form.accion==='corregir'} disabled={busy||form.accion==='sin_salida'} value={form.salidaLocal} onChange={e=>set('salidaLocal',e.target.value)}/></label>
      </div>
      {jornada&&<label>Resolucion<select value={form.accion} disabled={busy} onChange={e=>set('accion',e.target.value)}><option value="corregir">Corregir fechas / horas con evidencia</option><option value="sin_salida">Sin salida comprobada (sin pago)</option></select></label>}
      {jornada&&<p className="gmr-revision-help">Si no cambias el puesto, se conserva la tarifa historica de esta jornada. Al cambiarlo, se toma la tarifa del puesto seleccionado. El puesto habitual del expediente no cambia.</p>}
      <label>Motivo obligatorio<textarea required minLength={10} maxLength={1000} rows={3} disabled={busy} value={form.motivo} onChange={e=>set('motivo',e.target.value)} placeholder="Explica la omision o diferencia y que documento respalda la correccion."/></label>
      <label>Documento de respaldo obligatorio<input type="file" required accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={e=>{request.current=crypto.randomUUID();setFile(e.target.files?.[0] || null);}}/><small>PDF, JPG o PNG. Hasta 4 MB. Adjunta una hoja legible con firmas.</small></label>
      <label className="gmr-revision-check"><input type="checkbox" disabled={busy} checked={form.confirmarExcepcion} onChange={e=>set('confirmarExcepcion',e.target.checked)}/><span>Solo para excepciones: confirmo que el respaldo acredita una jornada de {limiteHoras} horas o mas.</span></label>
      <div className="gmr-revision-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy}>{busy?'Guardando respaldo...':'Guardar con respaldo'}</button></div>
    </form>
    {history.length>0&&<section className="gmr-revision-history"><h3>Historial de cambios</h3>{history.map(h=><article key={h.id}><strong>{h.porNombre || h.por} - {h.accion}</strong><small>{fechaHoraEnZona(h.creadaEn,zone).replace('T',' ')}</small><p>{h.motivo}</p><p>Antes: {fechaHoraEnZona(h.anterior?.entradaEn,zone).replace('T',' ') || '-'} / {fechaHoraEnZona(h.anterior?.salidaEn,zone).replace('T',' ') || '-'}</p><p>Despues: {fechaHoraEnZona(h.nuevo?.entradaEn,zone).replace('T',' ') || '-'} / {fechaHoraEnZona(h.nuevo?.salidaEn,zone).replace('T',' ') || '-'}</p>{h.respaldoId&&<button type="button" className="secondary-button" onClick={()=>descargarRespaldo(h.respaldoId).catch(e=>feedback.error(mensajeAsistencia(e)))}>Descargar respaldo</button>}</article>)}</section>}
  </FormModal>;
}
