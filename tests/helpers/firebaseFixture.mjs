// Deterministic in-memory adapters. These tests are NOT a Firebase emulator run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import * as domain from '../../functions/asistenciaDomain.js';
import * as permisos from '../../functions/perfilesAcceso.js';
import * as operacion from '../../functions/operacionEventuales.js';
export function fixture() {
  const docs=new Map(),objects=new Map();let clock=Date.parse('2026-10-26T15:00:00Z'),seq=0,queue=Promise.resolve();
  class Timestamp {constructor(ms){this.ms=ms;}toMillis(){return this.ms;}toDate(){return new Date(this.ms);}static now(){return new Timestamp(clock);}static fromMillis(ms){return new Timestamp(ms);}static fromDate(d){return new Timestamp(d.getTime());}}
  class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
  const clone=x=>x instanceof Timestamp?new Timestamp(x.ms):Array.isArray(x)?x.map(clone):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,clone(v)])):x;
  function snap(ref){return {id:ref.id,ref,exists:docs.has(ref.path),data:()=>clone(docs.get(ref.path))};}
  function doc(path){return {path,id:path.split('/').at(-1),get:async()=>snap(doc(path)),set:async(v,o)=>docs.set(path,o?.merge?{...docs.get(path),...clone(v)}:clone(v)),update:async(v)=>{assert(docs.has(path));docs.set(path,{...docs.get(path),...clone(v)});},delete:async()=>docs.delete(path)};}
  const value=(d,k)=>k.split('.').reduce((a,b)=>a?.[b],d);
  const norm=v=>v?.toMillis?.()??v;
  function collection(name,filters=[],orders=[],limit=Infinity){return {_query:true,doc:(id=`auto_${++seq}`)=>doc(`${name}/${id}`),where:(k,op,v)=>collection(name,[...filters,[k,op,v]],orders,limit),orderBy:(k,d='asc')=>collection(name,filters,[...orders,[k,d]],limit),limit:n=>collection(name,filters,orders,n),get:async()=>{
    let rows=[...docs.keys()].filter(p=>p.startsWith(`${name}/`)&&p.split('/').length===name.split('/').length+1).map(p=>snap(doc(p)));
    rows=rows.filter(s=>filters.every(([k,op,v])=>{const a=norm(value(s.data(),k)),b=norm(v);if(op==='==')return a===b;if(op==='>=')return a>=b;if(op==='<=')return a<=b;if(op==='<')return a<b;if(op==='>')return a>b;if(op==='in')return v.includes(a);if(op==='array-contains')return a?.includes(b);throw Error(`Unsupported query ${op}`);}));
    rows.sort((a,b)=>{for(const[k,d]of orders){const aa=norm(value(a.data(),k)),bb=norm(value(b.data(),k));if(aa!==bb)return (aa<bb?-1:1)*(d==='desc'?-1:1);}return 0;});rows=rows.slice(0,limit);return {docs:rows,size:rows.length,empty:!rows.length};}};}
  const db={doc,collection,runTransaction(fn){const op=queue.then(async()=>{const writes=[];const tx={get:async r=>{assert.equal(writes.length,0,'all reads before any write');return r._query?r.get():snap(r);},create:(r,v)=>{assert(!docs.has(r.path));writes.push(()=>docs.set(r.path,clone(v)));},set:(r,v,o)=>writes.push(()=>docs.set(r.path,o?.merge?{...docs.get(r.path),...clone(v)}:clone(v))),update:(r,v)=>{assert(docs.has(r.path));writes.push(()=>docs.set(r.path,{...docs.get(r.path),...clone(v)}));},delete:r=>writes.push(()=>docs.delete(r.path))};const result=await fn(tx);writes.forEach(w=>w());return result;});queue=op.catch(()=>{});return op;}};
  const storage={bucket:()=>({file:path=>({exists:async()=>[objects.has(path)],getMetadata:async()=>{if(!objects.has(path))throw Error('missing object');return [objects.get(path).metadata];},download:async({start,end}={})=>{const b=objects.get(path).bytes;return [start===undefined?b:b.subarray(start,end+1)];},save:async(bytes,opts)=>{if(objects.has(path)&&opts.preconditionOpts?.ifGenerationMatch===0)throw Object.assign(Error('immutable'),{code:412});objects.set(path,{bytes:Buffer.from(bytes),opts,metadata:{...opts.metadata,size:String(bytes.length),generation:String(++seq)}});}})})};
  let source=fs.readFileSync(new URL('../../functions/index.js',import.meta.url),'utf8').replace(/import[\s\S]*?from '[^']+';\n/g,'');
  const names=[...source.matchAll(/export const (\w+) = (?:endpoint|publicEndpoint)/g)].map(m=>m[1]);source=source.replaceAll('export const ','const ');
  const deps={initializeApp:()=>{},getFirestore:()=>db,getAuth:()=>({}),getStorage:()=>storage,onCall:(_,fn)=>fn,onSchedule:(_,fn)=>fn,HttpsError,Timestamp,createHash,randomBytes,scryptSync,timingSafeEqual,...domain,...permisos,...operacion};
  const handlers=new Function(...Object.keys(deps),`${source}\nreturn {${names.join(',')}};`)(...Object.values(deps));
  docs.set('usuarios/admin',{rol:'administrador',nombre:'Admin prueba',activo:true,propiedadesPermitidas:['*']});
  docs.set('usuarios/guardia',{rol:'guardia',nombre:'Guardia prueba',activo:true,modulosPermitidos:['asistencia'],propiedadesPermitidas:['hrm']});
  docs.set('usuarios/rh',{rol:'rh',nombre:'RH prueba',activo:true,perfilAcceso:'rh',permisosSistema:[permisos.PERMISOS.RESOLVER_TURNOS_EVENTUALES,permisos.PERMISOS.REPORTES_EVENTUALES,permisos.PERMISOS.PLANEACION_PERSONAL,permisos.PERMISOS.SOLICITAR_PERSONAL,permisos.PERMISOS.AUTORIZAR_REQUISICIONES_PERSONAL],propiedadesPermitidas:['hrm']});
  docs.set('usuarios/solicitante',{rol:'solicitante',nombre:'Chef prueba',activo:true,perfilAcceso:'solicitante_personal',permisosSistema:[permisos.PERMISOS.SOLICITAR_PERSONAL],propiedadesPermitidas:['hrm']});
  docs.set('propiedades/hrm',{nombre:'Hotel de prueba',codigo:'HRM',activo:true,asistencia:{zonaHoraria:'America/Mexico_City',fotoEntrada:false,fotoSalida:false}});
  docs.set('propiedades/otra',{nombre:'Otra',activo:true,asistencia:{zonaHoraria:'America/Mexico_City'}});
  docs.set('puestos/mesero',{nombre:'Mesero',tarifaHora:100,activo:true});docs.set('puestos/seguridad',{nombre:'Seguridad',tarifaHora:120,activo:true});
  docs.set('horarios/dia',{nombre:'Dia',horaInicio:'07:00',horaFin:'15:00',minutosDuracion:480,cruzaDia:false,activo:true});
  docs.set('asistenciaPersonal/carlos',{nombre:'Persona de prueba',clave:'EVGMR-TEST',tipo:'eventual',activo:true,puestoId:'mesero',puestoNombre:'Mesero',tarifaBase:100,tarifaPersonalizada:150,propiedadId:'hrm',propiedadesPermitidas:['hrm']});
  const call=(name,data={},uid='admin')=>handlers[name]({auth:{uid},data});
  return {docs,objects,call,Timestamp,advance:ms=>clock+=ms,setNow:ms=>clock=ms,clock:()=>clock,permisos};
}
