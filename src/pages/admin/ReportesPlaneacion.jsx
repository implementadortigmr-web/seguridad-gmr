import { useMemo, useState } from 'react';
import FormModal from '../../components/admin/FormModal';
import { useFeedback } from '../../context/FeedbackContext';
import { resumenPrenomina } from '../../../shared/operacionEventuales';
import { crearHojaRegistroPDF, crearPrenominaPDF } from '../../services/pdfPlaneacionService';
import './reportesPlaneacion.css';
export default function ReportesPlaneacion({propiedad,semanaInicio,dias,necesidades,asignaciones,disabled=false}) {
  const feedback=useFeedback();
  const [mode,setMode]=useState(''),[evento,setEvento]=useState(''),[date,setDate]=useState(''),[puesto,setPuesto]=useState(''),[extra,setExtra]=useState(2),[busy,setBusy]=useState(false);
  const resumen=useMemo(()=>resumenPrenomina(necesidades,asignaciones),[necesidades,asignaciones]);
  const jobs=[...new Map(necesidades.map(n=>[n.puestoId,n.puestoNombre])).entries()];
  async function generar(){
    if(busy)return;setBusy(true);
    try {
      if(mode==='registro') {
        const filtered=necesidades.filter(n=>(!date||n.fecha===date)&&(!puesto||n.puestoId===puesto));
        const doc=await crearHojaRegistroPDF({propiedad,necesidades:filtered,asignaciones,evento,renglonesExtra:extra});doc.save(`registro_eventuales_${propiedad.codigo||propiedad.id}_${date||semanaInicio}.pdf`);
      } else {
        const doc=await crearPrenominaPDF({propiedad,semanaInicio,semanaFin:dias[6],necesidades,asignaciones});doc.save(`prenomina_${propiedad.codigo||propiedad.id}_${semanaInicio}.pdf`);
      }
    }catch(e){feedback.error(e.message || 'No fue posible generar el PDF.');}finally{setBusy(false);}
  }
  const t=resumen.total;
  return <div className="gmr-planning-reports">
    <button type="button" className="secondary-button" disabled={disabled||!necesidades.length} onClick={()=>setMode('registro')}>Imprimir hoja de registro</button>
    <button type="button" className="secondary-button" disabled={disabled||!necesidades.length} onClick={()=>setMode('prenomina')}>Pren&oacute;mina semanal / solicitar efectivo</button>
    <FormModal open={Boolean(mode)} title={mode==='registro'?'Hoja de registro de Eventuales':'Solicitud de efectivo / pren\u00f3mina'} subtitle={propiedad?.nombre} onClose={()=>!busy&&setMode('')} busy={busy} width="820px">
      {mode==='registro'?<div className="gmr-planning-report-options">
        <label>Evento / servicio<input value={evento} maxLength={85} onChange={e=>setEvento(e.target.value)} placeholder="Opcional. Se deja una linea en blanco si no se captura."/></label>
        <label>Fecha<select value={date} onChange={e=>setDate(e.target.value)}><option value="">Toda la semana (una hoja por dia y puesto)</option>{dias.map(d=><option key={d}>{d}</option>)}</select></label>
        <label>Puesto<select value={puesto} onChange={e=>setPuesto(e.target.value)}><option value="">Todos los puestos</option>{jobs.map(([id,nombre])=><option key={id} value={id}>{nombre}</option>)}</select></label>
        <label>Renglones extra para personal no programado<input type="number" min="0" max="5" value={extra} onChange={e=>setExtra(e.target.value)}/></label>
        <p>Se imprimen nombres y horarios citados. Entrada, salida, fecha de salida y firmas quedan en blanco para llenarse presencialmente.</p>
      </div>:<div className="gmr-planning-prenomina">
        <p><strong>{semanaInicio} a {dias[6]}</strong></p>
        <dl><dt>Turnos requeridos</dt><dd>{t.turnosRequeridos}</dd><dt>Horas programadas</dt><dd>{t.horas.toFixed(2)}</dd><dt>Efectivo estimado</dt><dd>{t.importe.toLocaleString('es-MX',{style:'currency',currency:'MXN'})}</dd></dl>
        <p>Resumen semanal y detalle por d&iacute;a, puesto y horario. Sin listado de personas.</p>
      </div>}
      <div className="gmr-planning-report-actions"><button type="button" className="primary-button" disabled={busy} onClick={generar}>{busy?'Generando...':'Generar PDF'}</button></div>
    </FormModal>
  </div>;
}
