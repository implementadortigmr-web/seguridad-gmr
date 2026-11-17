import * as operacion from '../functions/operacionEventuales.js';
// Pruebas reales de handlers usando adaptadores en memoria; NO Firebase desplegado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as domain from '../functions/asistenciaDomain.js';
import * as presets from '../functions/perfilesAcceso.js';

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fixture(rol = 'administrador', propiedades = ['*']) {
  const documents = new Map();
  let counter = 0;
  class Timestamp { static now() { return { toMillis: () => 1_700_000_000_000, toDate: () => new Date(1_700_000_000_000) }; } }
  const ref = (path) => ({
    path,
    id: path.split('/').at(-1),
    get: async () => snap(path),
    set: async (data, opts) => { documents.set(path, opts?.merge ? { ...documents.get(path), ...data } : data); },
    update: async (data) => { documents.set(path, { ...documents.get(path), ...data }); },
  });
  const snap = (path) => ({ id: path.split('/').at(-1), exists: documents.has(path), data: () => documents.get(path) });
  const collection = (path, filters = [], max = Infinity) => ({
    doc: (id = `generated_${++counter}`) => ref(`${path}/${id}`),
    where: (field, operator, value) => collection(path, [...filters, [field, operator, value]], max),
    limit: (n) => collection(path, filters, n),
    get: async () => ({ docs: [...documents.keys()]
      .filter((key) => key.startsWith(`${path}/`) && key.split('/').length === 2)
      .filter((key) => filters.every(([field,operator,value]) => operator === '==' && documents.get(key)?.[field] === value))
      .slice(0,max).map((key) => snap(key)) }),
  });
  const fotos = new Map();
  const db = {
    doc: ref, collection,
    runTransaction: async (callback) => {
      const writes = [];
      const result = await callback({
        get: async (reference) => { assert.equal(writes.length, 0, 'Reads before writes'); return snap(reference.path); },
        create: (reference, data) => writes.push(() => { if(documents.has(reference.path)) throw Error('exists'); documents.set(reference.path,data); }),
        set: (reference,data,opts) => writes.push(() => documents.set(reference.path,opts?.merge ? {...documents.get(reference.path), ...data} : data)),
      });
      writes.forEach((write)=>write());
      return result;
    },
  };
  documents.set('usuarios/administrador1', { rol, activo: true, propiedadesPermitidas: propiedades });
  documents.set('propiedades/hrm', { nombre:'Hotel HRM', codigo:'HRM', activo:true });
  documents.set('propiedades/santuario', { nombre:'Santuario', codigo:'SAN', activo:true });
  documents.set('propiedades/mexico', { nombre:'México', codigo:'MEXICO', activo:true });
  documents.set('configuracionAsistencia/mexico',{ propiedadId:'mexico' });
  documents.set('puestos/mesero',{ nombre:'Mesero', activo:true, tarifaHora:100 });
  let code=readFileSync(new URL('../functions/index.js', import.meta.url),'utf8');
  code=code.replace(/import[\s\S]*?from '[^']+';\n/g,'').replaceAll('export const ','const ');
  const names=['eventualFormularioCatalogoPublico','eventualRegistrarSolicitudPublica','eventualConsultarSolicitudPublica','eventualListarSolicitudes','eventualResolverSolicitud','asistenciaProgramacionesReporte'];
  const deps={ initializeApp:()=>{}, getFirestore:()=>db, getAuth:()=>({}),getStorage:()=>({ bucket:()=>({file:(path)=>({
      save:async(data)=>{fotos.set(path,data);},
      download:async()=>[fotos.get(path)],
      delete:async()=>{fotos.delete(path);},
    })})}),
    onCall:(_,handler)=>handler, onSchedule:(_,handler)=>handler,
    HttpsError, Timestamp, createHash, randomBytes, scryptSync, timingSafeEqual, ...domain, ...presets, ...operacion };
  const handlers=new Function(...Object.keys(deps), `${code}\nreturn {${names.join(',')}};`)(...Object.values(deps));
  const auth={ uid:'administrador1' };
  return { documents, handlers, auth, fotos };
}

const FOTO = `data:image/jpeg;base64,${Buffer.concat([
  Buffer.from([0xff,0xd8]), Buffer.alloc(2600,0), Buffer.from([0xff,0xd9]),
]).toString('base64')}`;

test('eventual backend: alta inmediata asigna propiedades operativas y crea foto privada', async () => {
  const f=fixture();
  const catalogo=await f.handlers.eventualFormularioCatalogoPublico({data:{}});
  assert.deepEqual(catalogo.puestos,[{id:'mesero',nombre:'Mesero'}]);
  const alta=await f.handlers.eventualRegistrarSolicitudPublica({data:{
    nombre:'Carlos Martínez', telefono:'4151234567', puestoId:'mesero', aceptaRegistro:true,
    encargadoNombre:'Capitán',fotoRostro:FOTO,
  },rawRequest:{ip:'127.0.0.1'}});
  assert.equal(alta.estado,'aprobada');
  const record=f.documents.get(`solicitudesEventuales/${alta.solicitudId}`);
  assert.equal(record.estado,'aprobada');
  assert.equal(record.alcancePropiedades,'todas_operativas');
  const person=f.documents.get(`asistenciaPersonal/${record.empleadoId}`);
  assert.equal(person.nombre,'CARLOS MARTÍNEZ');
  assert.deepEqual(person.propiedadesPermitidas,['hrm','santuario']);
  assert(!person.propiedadesPermitidas.includes('mexico'));
  assert.equal(person.activo,true);
  assert.equal(person.encargadoNombre,'Capitán');
  assert.equal(person.qr,alta.clave);
  assert.equal(person.requiereCotejoVisual,true);
  assert(f.fotos.has(person.fotoRostroPath));
  const consulta=await f.handlers.eventualConsultarSolicitudPublica({data:{
    solicitudId:alta.solicitudId, consultaToken:alta.consultaToken,
  }});
  assert.equal(consulta.estado,'aprobada');
  assert.equal(consulta.qr,alta.clave);
  assert.match(consulta.fotoRostro,/^data:image\/jpeg;base64,/);
  const pendientes=await f.handlers.eventualListarSolicitudes({auth:f.auth,data:{estado:'pendiente'}});
  assert.equal(pendientes.rows.length,0);
});

test('eventual backend: impide duplicar nombre en alta publica', async () => {
  const f=fixture();
  const a={nombre:'Ana López García',telefono:'4152222222',puestoId:'mesero',aceptaRegistro:true,fotoRostro:FOTO};
  await f.handlers.eventualRegistrarSolicitudPublica({data:a,rawRequest:{ip:'127.0.0.1'}});
  await assert.rejects(
    f.handlers.eventualRegistrarSolicitudPublica({data:{...a, telefono:'4153333333'},rawRequest:{ip:'127.0.0.1'}}),
    /ya esta registrado/
  );
  assert.equal([...f.documents.keys()].filter(k=>k.startsWith('asistenciaPersonal/')).length,1);
});

test('eventual backend: sin foto o con archivo invalido no crea personal', async () => {
  const f=fixture();
  const a={nombre:'Ana López García',telefono:'4152222222',puestoId:'mesero',aceptaRegistro:true};
  await assert.rejects(f.handlers.eventualRegistrarSolicitudPublica({data:a}), /fotografia|Fotografia/);
  await assert.rejects(f.handlers.eventualRegistrarSolicitudPublica({data:{...a,fotoRostro:'data:image/jpeg;base64,Zm9v'}}), /fotografia|Fotografia/);
  assert.equal([...f.documents.keys()].filter(k=>k.startsWith('asistenciaPersonal/')).length,0);
});


test('eventual backend: reporte puede recuperar turno historico asignado para calcular horas normales', async () => {
  const f=fixture();
  f.documents.set('programacionPersonal/asg_turno10', {
    propiedadId:'hrm', fecha:'2026-11-17', horarioId:'h10', horarioNombre:'Turno 10 horas',
    horaInicio:'09:00', horaFin:'19:00', minutosDuracion:600, cruzaDia:false, puestoId:'mesero', puestoNombre:'Mesero',
  });
  const result=await f.handlers.asistenciaProgramacionesReporte({auth:f.auth,data:{propiedadId:'hrm',programacionIds:['asg_turno10']}});
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].horaInicio,'09:00');
  assert.equal(result.rows[0].horaFin,'19:00');
  assert.equal(result.rows[0].minutosDuracion,600);
});
