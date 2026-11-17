// Pure rules shared by portal and Cloud Functions. No network or Firebase SDK.
export const LIMITE_REVISION_HORAS = 16;
export const MAX_RESPALDO_BYTES = 4 * 1024 * 1024;
export function tiempoMs(value) {
  if (value == null || value === '') return null;
  const ms = value?.toMillis?.() ?? value?.toDate?.()?.getTime?.()
    ?? (typeof value?.seconds === 'number' ? value.seconds * 1000 : new Date(value).getTime());
  return Number.isFinite(ms) ? ms : null;
}
export function fechaHoraEnZona(value, zona = 'America/Mexico_City') {
  const ms = tiempoMs(value);
  if (ms === null) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function fechaHoraLocalAMs(local, zona = 'America/Mexico_City') {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(local || ''))) throw new Error('Captura fecha y hora completas.');
  const [y,m,d,h,min] = local.match(/\d+/g).map(Number);
  const naive = Date.UTC(y,m-1,d,h,min);
  if (new Date(naive).toISOString().slice(0,16) !== local) throw new Error('La fecha u hora no es valida.');
  let result = naive;
  for (let i=0;i<4;i++) {
    const projected = fechaHoraEnZona(result,zona);
    const delta = naive - Date.parse(`${projected}:00Z`);
    result += delta;
    if (delta === 0) break;
  }
  if (fechaHoraEnZona(result,zona) !== local) throw new Error('La hora no existe en la zona horaria de la propiedad.');
  return result;
}
export function fechaSalidaTexto(value, zona = 'America/Mexico_City') {
  const local = fechaHoraEnZona(value,zona);
  return local ? local.slice(0,10).split('-').reverse().join('/') : '-';
}
export function revisionJornada(row, now = Date.now(), limite = LIMITE_REVISION_HORAS) {
  const inicio = tiempoMs(row?.entradaEn), fin = tiempoMs(row?.salidaEn);
  const excedida = inicio !== null && ((fin ?? now) - inicio) >= Number(row?.limiteRevisionHoras || limite) * 3600000;
  const validada = row?.revisionValidada === true && Boolean(row?.respaldoId) && row?.estado === 'corregida';
  const sinSalidaResuelta = row?.estado === 'sin_salida' && row?.resueltoAdministrativamente === true && Boolean(row?.respaldoId);
  const cerrada = ['completa','corregida'].includes(row?.estado) && fin !== null;
  const inconsistente = inicio === null || (fin !== null && fin < inicio);
  const requiereRevision = row?.requiereRevision === true || inconsistente || (!validada && !sinSalidaResuelta && (excedida || ['salida_pendiente','sin_salida'].includes(row?.estado)));
  return { requiereRevision, excedida, validada, sinSalidaResuelta, pagable: Boolean(cerrada && !requiereRevision), horasRegistradas: inicio !== null && fin !== null ? (fin-inicio)/3600000 : null };
}
export function intervaloPlaneado(item) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item?.fecha || '')) || !/^\d{2}:\d{2}$/.test(String(item?.horaInicio || '')) || !/^\d{2}:\d{2}$/.test(String(item?.horaFin || ''))) return null;
  const inicio = Date.parse(`${item.fecha}T${item.horaInicio}:00Z`);
  let fin = Date.parse(`${item.fecha}T${item.horaFin}:00Z`);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null;
  if (fin <= inicio) fin += 86400000;
  return { inicio, fin, minutos: (fin-inicio)/60000 };
}
export function seTraslapan(a,b) { return a.inicio < b.fin && b.inicio < a.fin; }
export function tarifaPlanificada(asignacion, necesidad) {
  const value = asignacion?.versionTarifa === 2 ? asignacion.tarifaHoraPlanificada : necesidad?.tarifaHora;
  const n = Number(value ?? asignacion?.tarifaHoraPlanificada ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
export function candidatosDeEntrada(asignaciones, ahoraMs, zona = 'America/Mexico_City') {
  const local = fechaHoraEnZona(ahoraMs,zona);
  const now = Date.parse(`${local}:00Z`);
  const rows = asignaciones.filter(a => a.activo !== false && !a.jornadaId).filter(a => {
    const it = intervaloPlaneado(a);
    // Matching window only; this is NOT a lateness tolerance.
    return it && now >= it.inicio - 60*60000 && now < it.fin;
  });
  return rows.sort((a,b) => `${a.fecha}T${a.horaInicio}`.localeCompare(`${b.fecha}T${b.horaInicio}`));
}
export function resumenPrenomina(necesidades = [], asignaciones = []) {
  const cents = n => Math.round(Number(n || 0)*100);
  const personas = new Map(), dias = new Map(), puestos = new Map();
  const total = { turnosRequeridos:0, turnosAsignados:0, faltantes:0, personasUnicas:0, horas:0, importe:0, importeAsignado:0, importeVacantes:0 };
  const detalle = necesidades.filter(n => n.activo !== false).map(n => {
    const list = asignaciones.filter(a => a.necesidadId === n.id && a.activo !== false);
    const horas = Number(n.minutosDuracion || intervaloPlaneado(n)?.minutos || 0)/60;
    const cantidad = Number(n.cantidadNecesaria || 0);
    const faltantes = Math.max(0,cantidad-list.length);
    const asignadoC = list.reduce((s,a) => s+cents(horas*tarifaPlanificada(a,n)),0);
    const vacantesC = cents(faltantes*horas*Number(n.tarifaHora || 0));
    for (const a of list) {
      const p = personas.get(a.empleadoId) || { empleadoId:a.empleadoId,nombre:a.empleadoNombre,turnos:0,horas:0,importeCentavos:0,detalle:[] };
      const pago = cents(horas*tarifaPlanificada(a,n));
      p.turnos++; p.horas += horas; p.importeCentavos += pago;
      p.detalle.push({ fecha:n.fecha,puesto:n.puestoNombre,horario:`${n.horaInicio}-${n.horaFin}`,horas,tarifa:tarifaPlanificada(a,n),importe:pago/100 });
      personas.set(a.empleadoId,p);
    }
    const row = { ...n, necesarios:cantidad,asignados:list.length,faltantes,horas:cantidad*horas,horasPorTurno:horas,importe:(asignadoC+vacantesC)/100,importeAsignado:asignadoC/100,importeVacantes:vacantesC/100 };
    total.turnosRequeridos += cantidad; total.turnosAsignados += list.length; total.faltantes += faltantes; total.horas += row.horas;
    total.importe += asignadoC+vacantesC; total.importeAsignado += asignadoC; total.importeVacantes += vacantesC;
    for (const [map,key,label] of [[dias,n.fecha,n.fecha],[puestos,n.puestoId,n.puestoNombre]]) {
      const g = map.get(key) || {id:key,nombre:label,necesarios:0,asignados:0,faltantes:0,horas:0,importeCentavos:0};
      g.necesarios += cantidad; g.asignados += list.length; g.faltantes += faltantes; g.horas += row.horas; g.importeCentavos += asignadoC+vacantesC; map.set(key,g);
    }
    return row;
  });
  total.personasUnicas = personas.size;
  for (const k of ['importe','importeAsignado','importeVacantes']) total[k] /= 100;
  const convert = map => [...map.values()].map(x => ({...x,importe:x.importeCentavos/100}));
  return { total,detalle,personas:convert(personas),dias:convert(dias).sort((a,b)=>a.id.localeCompare(b.id)),puestos:convert(puestos) };
}
