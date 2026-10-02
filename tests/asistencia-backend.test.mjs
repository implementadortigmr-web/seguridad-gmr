// Executes actual handlers with deterministic in-memory adapters. Not a Firebase emulator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as domain from '../functions/asistenciaDomain.js';
import * as presets from '../functions/perfilesAcceso.js';

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function harness() {
  const docs = new Map(); const objects = new Map(); const accounts = new Map(); let generated = 0; let clock = Date.parse('2026-09-07T15:00:00Z'); let queue = Promise.resolve();
  class Stamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } toDate() { return new Date(this.ms); } static now() { return new Stamp(clock); } static fromDate(d) { return new Stamp(d.getTime()); } static fromMillis(ms) { return new Stamp(ms); } }
  function snapshot(ref) { return { id: ref.id, ref, exists: docs.has(ref.path), data: () => docs.get(ref.path) }; }
  function doc(path) { return { path, id: path.split('/').at(-1), get: async () => snapshot(doc(path)),
    create: async (data) => { if(docs.has(path)) throw new Error('exists'); docs.set(path, data); },
    update: async (data) => { if(!docs.has(path)) throw new Error('missing'); docs.set(path, {...docs.get(path), ...data}); },
    set: async (data, opts) => { docs.set(path, opts?.merge ? {...(docs.get(path) || {}), ...data} : data); },
  }; }
  const db = { doc, collection: (name) => ({ doc: (id = `generated_${++generated}`) => doc(`${name}/${id}`),
    get: async () => ({ docs: [...docs.keys()].filter((p) => p.split('/').length === 2 && p.startsWith(`${name}/`)).map((p) => snapshot(doc(p))) }),
    }),
    runTransaction(fn) {
      const operation = queue.then(async () => {
        const changes = [];
        const result = await fn({
          get: async (ref) => { assert.equal(changes.length, 0, 'all reads must precede writes'); return snapshot(ref); },
          create: (ref, data) => { if (docs.has(ref.path)) throw new Error('exists'); changes.push(() => docs.set(ref.path, data)); },
          update: (ref, data) => { if (!docs.has(ref.path)) throw new Error('missing'); changes.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...data })); },
          set: (ref, data, opts) => changes.push(() => docs.set(ref.path, opts?.merge ? { ...(docs.get(ref.path) || {}), ...data } : data)),
          delete: (ref) => changes.push(() => docs.delete(ref.path)),
        });
        changes.forEach((apply) => apply()); return result;
      });
      queue = operation.catch(() => {}); return operation;
    } };
  const storage = { bucket: () => ({ file: (path) => ({
    exists: async () => [objects.has(path)], getMetadata: async () => [objects.get(path)],
    download: async () => [objects.get(path)?.bad ? Buffer.from('bad') : Buffer.from([255,216,255])],
  }) }) };
  const auth = {
    getUser: async (id) => {
      if (!accounts.has(id)) throw Object.assign(new Error('No user'), { code: 'auth/user-not-found' });
      return accounts.get(id);
    },
    createUser: async (values) => {
      if ([...accounts.values()].some((u) => u.email === values.email)) throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
      const uid = `auth_${++generated}`; const user = { ...values, uid }; accounts.set(uid, user); return user;
    },
    updateUser: async (id, values) => { accounts.set(id, { ...accounts.get(id), ...values }); return accounts.get(id); },
  };
  let source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  source = source.replace(/import[\s\S]*?from '[^']+';\n/g, '').replaceAll('export const ', 'const ');
  const names = [...source.matchAll(/const (asistencia\w+) = endpoint/g)].map((m) => m[1]);
  const deps = { initializeApp: () => {}, getFirestore: () => db, getStorage: () => storage,
    getAuth: () => auth, onCall: (_options, handler) => handler, onSchedule: (_options, handler) => handler,
    HttpsError, Timestamp: Stamp, createHash, randomBytes, scryptSync, timingSafeEqual, ...domain, ...presets };
  const handlers = new Function(...Object.keys(deps), `${source}\nreturn {${names.join(',')}};`)(...Object.values(deps));
  const uid = 'operador'; const empleadoId = 'emp_prueba';
  docs.set(`usuarios/${uid}`, { activo: true, rol: 'asistencia', nombre: 'Seguridad Mexico', propiedadesPermitidas: ['mexico'] });
  docs.set('configuracionAsistencia/mexico', { propiedadId: 'mexico' });
  docs.set('propiedades/mexico', { activo: true, nombre: 'Mexico', asistencia: { habilitado: true, fotoEntrada: true, fotoSalida: true, zonaHoraria: 'America/Mexico_City' } });
  docs.set(`asistenciaPersonal/${empleadoId}`, { propiedadId: 'mexico', activo: true, nombre: 'Persona prueba', clave: 'P01', tipo: 'personal_mexico' });
  docs.set('asistenciaClaves/P01', { empleadoId, clave: 'P01', tipo: 'personal_mexico' });
  const testSalt = '00112233445566778899aabbccddeeff';
  docs.set(`asistenciaCredenciales/${empleadoId}`, {
    pinSalt: testSalt,
    pinHash: scryptSync('1234', testSalt, 32).toString('hex'),
    pinVersion: 1,
  });

  const pinToken = 'a'.repeat(48);
  const hash32 = (value) => createHash('sha256').update(value).digest('hex').slice(0, 32);
  function autorizarPin(propiedadId = 'mexico') {
    docs.set(`asistenciaValidacionesPin/pin_${hash32(`${uid}\0${empleadoId}`)}`, {
      tokenHash: hash32(pinToken),
      operadorId: uid,
      empleadoId,
      propiedadId,
      venceEn: new Stamp(Date.now() + 10 * 60 * 1000),
    });
    return pinToken;
  }

  function request(solicitudId, tipo = 'entrada', extra = {}) {
    const propiedadId = extra.propiedadId || 'mexico';
    const fotoPath = propiedadId === 'mexico'
      ? `asistencia/mexico/${empleadoId}/${uid}/${solicitudId}.jpg`
      : '';
    if (fotoPath) {
      objects.set(fotoPath, { size: '1000', contentType: 'image/jpeg', metadata: { registradoPor: uid, empleadoId, solicitudId } });
    }
    const validacionPin = propiedadId === 'mexico' ? autorizarPin(propiedadId) : '';
    return { auth: { uid }, data: { solicitudId, empleadoId, propiedadId, tipo, fotoPath, validacionPin, ...extra } };
  }
  return { handlers, docs, objects, accounts, request, advance: (ms) => { clock += ms; } };
}
test('backend: valid entry and retry use same record', async () => {
  const h = harness(); const req = h.request('req1');
  const a = await h.handlers.asistenciaRegistrarMovimiento(req); const b = await h.handlers.asistenciaRegistrarMovimiento(req);
  assert.equal(a.jornadaId, b.jornadaId); assert.equal(b.repetido, true);
  assert.equal([...h.docs.keys()].filter((k) => k.startsWith('asistenciaJornadas/')).length, 1);
});
test('backend: simultaneous distinct entries cannot create two open shifts', async () => {
  const h = harness(); const result = await Promise.allSettled([
    h.handlers.asistenciaRegistrarMovimiento(h.request('req1')), h.handlers.asistenciaRegistrarMovimiento(h.request('req2')),
  ]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal([...h.docs.keys()].filter((k) => k.startsWith('asistenciaJornadas/')).length, 1);
});
test('backend: exit closes original shift and calculates server duration', async () => {
  const h = harness(); await h.handlers.asistenciaRegistrarMovimiento(h.request('in1')); h.advance(8*3600000);
  await h.handlers.asistenciaRegistrarMovimiento(h.request('out1','salida',{ jornadaEsperadaId:'in1' }));
  const jornada=h.docs.get('asistenciaJornadas/in1'); assert.equal(jornada.estado,'completa'); assert.equal(jornada.minutos,480);
  assert.equal(h.docs.get('asistenciaEstado/emp_prueba').jornadaAbiertaId,null);
});
test('backend: missing required photo rejected, no writes', async () => {
  const h = harness(); await assert.rejects(h.handlers.asistenciaRegistrarMovimiento(h.request('in1','entrada',{fotoPath:''})), /fotografia/);
  assert(!h.docs.has('asistenciaJornadas/in1'));
});
test('backend: object must exist, not just a path', async () => {
  const h = harness(); const req=h.request('in1'); h.objects.clear();
  await assert.rejects(h.handlers.asistenciaRegistrarMovimiento(req), /no termino/);
});
test('backend: fake JPEG bytes rejected', async () => {
  const h=harness(); const req=h.request('in1'); h.objects.get(req.data.fotoPath).bad=true;
  await assert.rejects(h.handlers.asistenciaRegistrarMovimiento(req), /JPEG/);
});
test('backend: shared account cannot mark employee from another property', async () => {
  const h=harness(); h.docs.get('asistenciaPersonal/emp_prueba').propiedadId='hrm';
  await assert.rejects(h.handlers.asistenciaRegistrarMovimiento(h.request('in1')), /Empleado no encontrado/);
});
test('backend: revoked module/profile denied', async () => {
  const h=harness(); h.docs.get('usuarios/operador').activo=false;
  await assert.rejects(h.handlers.asistenciaRegistrarMovimiento(h.request('in1')), /no esta activa/);
});
test('backend: absence of auth token denied', async () => {
  const h=harness(); const req=h.request('in1'); req.auth=null;
  await assert.rejects(h.handlers.asistenciaRegistrarMovimiento(req), /Inicia sesion/);
});
test('backend: stale exit cannot close a different new shift', async () => {
  const h=harness(); await h.handlers.asistenciaRegistrarMovimiento(h.request('in1'));
  await assert.rejects(h.handlers.asistenciaRegistrarMovimiento(h.request('out1','salida',{jornadaEsperadaId:'otro'})), /cambio/);
  assert.equal(h.docs.get('asistenciaJornadas/in1').estado,'abierta');
});
test('backend: no-photo property can register without changing Mexico requirement', async () => {
  const h=harness(); h.docs.set('usuarios/operador',{activo:true,rol:'guardia',modulosPermitidos:['asistencia'],propiedadesPermitidas:['hrm']});
  h.docs.set('propiedades/hrm',{activo:true,nombre:'HRM',asistencia:{habilitado:true,fotoEntrada:false,fotoSalida:false}});
  Object.assign(h.docs.get('asistenciaPersonal/emp_prueba'), { propiedadId:'hrm', tipo:'eventual' });
  const req=h.request('in1','entrada',{propiedadId:'hrm',fotoPath:'',validacionPin:''});
  const result=await h.handlers.asistenciaRegistrarMovimiento(req); assert.equal(result.tipo,'entrada');
});

function admin(h) {
  h.docs.set('usuarios/admin', { activo: true, rol: 'administrador', nombre: 'Admin' });
  h.accounts.set('admin', { uid: 'admin', email: 'admin@example.test' });
  return (data = {}) => ({ auth: { uid: 'admin' }, data });
}
test('backend: administrator cannot clock a normal attendance entry', async () => {
  const h = harness(); admin(h); const request = h.request('in_admin'); request.auth.uid = 'admin';
  await assert.rejects(h.handlers.asistenciaRegistrarMovimiento(request), /perfil no puede registrar/);
  assert(!h.docs.has('asistenciaJornadas/in_admin'));
});
test('backend: active ordinary property does not need an enable switch', async () => {
  const h = harness();
  h.docs.set('usuarios/operador', { activo: true, rol: 'guardia', modulosPermitidos: ['asistencia'], propiedadesPermitidas: ['hrm'] });
  h.docs.set('propiedades/hrm', { activo: true, nombre: 'HRM' });
  Object.assign(h.docs.get('asistenciaPersonal/emp_prueba'), { propiedadId: 'hrm', tipo: 'eventual' });
  const result = await h.handlers.asistenciaRegistrarMovimiento(h.request('in1', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' }));
  assert.equal(result.tipo, 'entrada');
});
test('backend: Mexico photo is required even if old property flags are disabled', async () => {
  const h = harness(); h.docs.get('propiedades/mexico').asistencia = { habilitado: false, fotoEntrada: false };
  await assert.rejects(h.handlers.asistenciaRegistrarMovimiento(h.request('in1', 'entrada', { fotoPath: '' })), /fotografia/);
});
test('backend: uses existing Mexico property ID instead of creating a second property', async () => {
  const h = harness(); const call = admin(h); h.docs.delete('propiedades/mexico'); h.docs.delete('configuracionAsistencia/mexico');
  h.docs.set('propiedades/existing_id', { nombre: 'Mexico', codigo: 'MX', activo: true });
  const result = await h.handlers.asistenciaPrepararMexico(call());
  assert.equal(result.propiedadId, 'existing_id'); assert(!h.docs.has('propiedades/mexico'));
});
test('backend: Mexico preparation refuses to move a preexisting canonical ID', async () => {
  const h = harness(); const call = admin(h); h.docs.get('configuracionAsistencia/mexico').propiedadId = 'other';
  await assert.rejects(h.handlers.asistenciaPrepararMexico(call()), /otra propiedad/);
});
test('backend: inactive Mexico not silently reactivated', async () => {
  const h = harness(); const call = admin(h); h.docs.get('propiedades/mexico').activo = false;
  await assert.rejects(h.handlers.asistenciaPrepararMexico(call()), /inactiva/);
});
test('backend: short operational PIN requires explicit provisional acknowledgement', async () => {
  const h = harness(); const call = admin(h);
  await assert.rejects(h.handlers.asistenciaCrearAccesoMexico(call({ usuario: 'SegMEX', password: '1234' })), /provisional/);
  assert.equal(h.accounts.size, 1);
});
test('backend: SegMEX test account is restricted and does not expose password in profile/result', async () => {
  const h = harness(); const call = admin(h);
  const result = await h.handlers.asistenciaCrearAccesoMexico(call({ usuario: 'SegMEX', password: '1234', aceptaClaveTemporal: true }));
  const user = h.docs.get(`usuarios/${result.uid}`);
  assert.equal(user.rol, 'asistencia'); assert.deepEqual(user.propiedadesPermitidas, ['mexico']);
  assert.deepEqual(user.modulosPermitidos, ['asistencia']); assert.equal(user.claveTemporal, true);
  assert.equal(h.accounts.get(result.uid).disabled, false); assert.equal(h.accounts.get(result.uid).password, 'GMR1234');
  assert.equal(user.password, undefined); assert.equal(result.password, undefined);
  await assert.rejects(h.handlers.asistenciaCrearAccesoMexico(call({ usuario: 'SegMEX', password: '6789', aceptaClaveTemporal: true })), /ya existe/);
  assert.equal(h.accounts.get(result.uid).password, 'GMR1234');
});
test('backend: guard cannot change a profile', async () => {
  const h = harness(); await assert.rejects(h.handlers.asistenciaGuardarPerfilUsuario(h.request('x')), /administrador/);
});
test('backend: preset expands on server, ignores arbitrary role/module escalation', async () => {
  const h = harness(); const call = admin(h); h.accounts.set('new_guard', { uid: 'new_guard', email: 'guard@example.test' });
  await h.handlers.asistenciaGuardarPerfilUsuario(call({ uid: 'new_guard', nombre: 'Guardia', correo: 'guard@example.test', perfilAcceso: 'guardia', rol: 'administrador', modulosPermitidos: ['asistencia'], propiedadesPermitidas: ['mexico'], activo: true }));
  assert.equal(h.docs.get('usuarios/new_guard').rol, 'guardia'); assert.deepEqual(h.docs.get('usuarios/new_guard').modulosPermitidos, []);
  assert.equal([...h.docs.keys()].filter((k) => k.startsWith('auditoria/')).length, 1);
});
test('backend: restricted Mexico profile cannot target HRM', async () => {
  const h = harness(); const call = admin(h); h.accounts.set('new_guard', { uid: 'new_guard', email: 'guard@example.test' });
  h.docs.set('propiedades/hrm', { nombre: 'HRM', activo: true });
  await assert.rejects(h.handlers.asistenciaGuardarPerfilUsuario(call({ uid: 'new_guard', nombre: 'Guardia', correo: 'guard@example.test', perfilAcceso: 'seguridad_mexico', propiedadesPermitidas: ['hrm'], activo: true })), /solamente/);
  assert(!h.docs.has('usuarios/new_guard'));
});
test('backend: administrator cannot disable own profile', async () => {
  const h = harness(); const call = admin(h);
  await assert.rejects(h.handlers.asistenciaGuardarPerfilUsuario(call({ uid: 'admin', nombre: 'Admin', correo: 'admin@example.test', perfilAcceso: 'administrador', propiedadesPermitidas: ['*'], activo: false })), /propia cuenta/);
});
test('backend: Authentication email mismatch rejected before profile write', async () => {
  const h = harness(); const call = admin(h); h.accounts.set('new_guard', { email: 'real@example.test' });
  await assert.rejects(h.handlers.asistenciaGuardarPerfilUsuario(call({ uid: 'new_guard', nombre: 'Guardia', correo: 'other@example.test', perfilAcceso: 'guardia', propiedadesPermitidas: ['mexico'], activo: true })), /coincidir/);
});


test('backend: Mexico closes automatically after 16 hours and next scan becomes entry', async () => {
  const h = harness();
  await h.handlers.asistenciaRegistrarMovimiento(h.request('mx_old'));
  h.advance(17 * 3600000);
  const result = await h.handlers.asistenciaConsultarEmpleado({
    auth: { uid: 'operador' },
    data: { propiedadId: 'mexico', clave: 'P01', pin: '1234' },
  });
  assert.equal(result.movimiento, 'entrada');
  assert.equal(h.docs.get('asistenciaJornadas/mx_old').estado, 'sin_salida');
  assert.equal(h.docs.get('asistenciaJornadas/mx_old').salidaEn, null);
  assert.equal(h.docs.get('asistenciaEstado/emp_prueba').jornadaAbiertaId, null);
});

test('backend: eventual becomes pending after 16 hours instead of inventing an exit', async () => {
  const h = harness();
  h.docs.set('usuarios/operador', { activo: true, rol: 'guardia', modulosPermitidos: ['asistencia'], propiedadesPermitidas: ['hrm'], nombre: 'Guardia' });
  h.docs.set('propiedades/hrm', { activo: true, nombre: 'HRM', asistencia: { zonaHoraria: 'America/Mexico_City' } });
  h.docs.set('asistenciaClaves/P01', { empleadoId: 'emp_prueba', clave: 'P01', tipo: 'eventual' });
  Object.assign(h.docs.get('asistenciaPersonal/emp_prueba'), {
    propiedadId: 'hrm', propiedadesPermitidas: ['hrm'], tipo: 'eventual', puestoId: 'mesero', puestoNombre: 'Mesero', tarifaBase: 100,
  });
  await h.handlers.asistenciaRegistrarMovimiento(h.request('ev_old', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' }));
  h.advance(17 * 3600000);
  const result = await h.handlers.asistenciaConsultarEmpleado({
    auth: { uid: 'operador' }, data: { propiedadId: 'hrm', clave: 'P01' },
  });
  assert.equal(result.movimiento, 'resolver_pendiente');
  assert.equal(result.turnoPendiente.id, 'ev_old');
  assert.equal(h.docs.get('asistenciaJornadas/ev_old').estado, 'salida_pendiente');
  assert.equal(h.docs.get('asistenciaJornadas/ev_old').salidaEn, null);
});

test('backend: security can mark missing exit and start a new eventual shift without choosing a time', async () => {
  const h = harness();
  h.docs.set('usuarios/operador', { activo: true, rol: 'guardia', modulosPermitidos: ['asistencia'], propiedadesPermitidas: ['hrm'], nombre: 'Guardia' });
  h.docs.set('propiedades/hrm', { activo: true, nombre: 'HRM', asistencia: { zonaHoraria: 'America/Mexico_City' } });
  h.docs.set('asistenciaClaves/P01', { empleadoId: 'emp_prueba', clave: 'P01', tipo: 'eventual' });
  Object.assign(h.docs.get('asistenciaPersonal/emp_prueba'), {
    propiedadId: 'hrm', propiedadesPermitidas: ['hrm'], tipo: 'eventual', puestoId: 'mesero', puestoNombre: 'Mesero', tarifaBase: 100,
  });
  await h.handlers.asistenciaRegistrarMovimiento(h.request('ev_old', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' }));
  h.advance(17 * 3600000);
  await h.handlers.asistenciaConsultarEmpleado({
    auth: { uid: 'operador' }, data: { propiedadId: 'hrm', clave: 'P01' },
  });
  const result = await h.handlers.asistenciaResolverTurnoPendiente({
    auth: { uid: 'operador' },
    data: { solicitudId: 'ev_new', empleadoId: 'emp_prueba', propiedadId: 'hrm', jornadaPendienteId: 'ev_old' },
  });
  assert.equal(result.tipo, 'entrada');
  assert.equal(result.turnoAnteriorSinSalida, true);
  assert.equal(h.docs.get('asistenciaJornadas/ev_old').estado, 'sin_salida');
  assert.equal(h.docs.get('asistenciaJornadas/ev_old').salidaEn, null);
  assert.equal(h.docs.get('asistenciaJornadas/ev_new').estado, 'abierta');
  assert.equal(h.docs.get('asistenciaEstado/emp_prueba').jornadaAbiertaId, 'ev_new');
});


test('backend: RH can mark an old eventual shift as no exit and remove it from operational pending state', async () => {
  const h = harness();
  h.docs.set('usuarios/operador', { activo: true, rol: 'guardia', modulosPermitidos: ['asistencia'], propiedadesPermitidas: ['hrm'], nombre: 'Guardia' });
  h.docs.set('propiedades/hrm', { activo: true, nombre: 'HRM', asistencia: { zonaHoraria: 'America/Mexico_City' } });
  h.docs.set('asistenciaClaves/P01', { empleadoId: 'emp_prueba', clave: 'P01', tipo: 'eventual' });
  Object.assign(h.docs.get('asistenciaPersonal/emp_prueba'), {
    propiedadId: 'hrm', propiedadesPermitidas: ['hrm'], tipo: 'eventual', puestoId: 'mesero', puestoNombre: 'Mesero', tarifaBase: 100,
  });
  await h.handlers.asistenciaRegistrarMovimiento(h.request('ev_rh_old', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' }));
  h.advance(17 * 3600000);
  await h.handlers.asistenciaConsultarEmpleado({ auth: { uid: 'operador' }, data: { propiedadId: 'hrm', clave: 'P01' } });

  h.docs.set('usuarios/rh1', {
    activo: true, rol: 'rh', nombre: 'RH', perfilAcceso: 'rh', propiedadesPermitidas: ['hrm'],
    permisosSistema: [presets.PERMISOS.REPORTES_EVENTUALES, presets.PERMISOS.RESOLVER_TURNOS_EVENTUALES],
  });
  const result = await h.handlers.asistenciaResolverTurnoAdministrativo({
    auth: { uid: 'rh1' },
    data: { jornadaId: 'ev_rh_old', accion: 'sin_salida', motivo: 'El eventual no registró salida y RH cerró el pendiente.' },
  });
  assert.equal(result.estado, 'sin_salida');
  const row = h.docs.get('asistenciaJornadas/ev_rh_old');
  assert.equal(row.estado, 'sin_salida');
  assert.equal(row.salidaEn, null);
  assert.equal(row.resueltoAdministrativamente, true);
  assert.equal(h.docs.get('asistenciaEstado/emp_prueba').jornadaAbiertaId, null);
});

test('backend: RH can correct the real exit time of a pending eventual shift and recalculate duration', async () => {
  const h = harness();
  h.docs.set('usuarios/operador', { activo: true, rol: 'guardia', modulosPermitidos: ['asistencia'], propiedadesPermitidas: ['hrm'], nombre: 'Guardia' });
  h.docs.set('propiedades/hrm', { activo: true, nombre: 'HRM', asistencia: { zonaHoraria: 'America/Mexico_City' } });
  h.docs.set('asistenciaClaves/P01', { empleadoId: 'emp_prueba', clave: 'P01', tipo: 'eventual' });
  Object.assign(h.docs.get('asistenciaPersonal/emp_prueba'), {
    propiedadId: 'hrm', propiedadesPermitidas: ['hrm'], tipo: 'eventual', puestoId: 'mesero', puestoNombre: 'Mesero', tarifaBase: 100,
  });
  await h.handlers.asistenciaRegistrarMovimiento(h.request('ev_rh_correct', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' }));
  h.advance(17 * 3600000);
  await h.handlers.asistenciaConsultarEmpleado({ auth: { uid: 'operador' }, data: { propiedadId: 'hrm', clave: 'P01' } });

  h.docs.set('usuarios/rh1', {
    activo: true, rol: 'rh', nombre: 'RH', perfilAcceso: 'rh', propiedadesPermitidas: ['hrm'],
    permisosSistema: [presets.PERMISOS.REPORTES_EVENTUALES, presets.PERMISOS.RESOLVER_TURNOS_EVENTUALES],
  });
  const result = await h.handlers.asistenciaResolverTurnoAdministrativo({
    auth: { uid: 'rh1' },
    data: {
      jornadaId: 'ev_rh_correct',
      accion: 'corregir_salida',
      salidaIso: '2026-09-07T23:00:00.000Z',
      motivo: 'RH confirmó la salida real con el responsable del evento.',
    },
  });
  assert.equal(result.estado, 'corregida');
  assert.equal(result.minutos, 480);
  const row = h.docs.get('asistenciaJornadas/ev_rh_correct');
  assert.equal(row.estado, 'corregida');
  assert.equal(row.minutos, 480);
  assert.equal(row.resueltoAdministrativamente, true);
});

test('backend: Nominas cannot resolve eventual shifts', async () => {
  const h = harness();
  h.docs.set('usuarios/nom1', {
    activo: true, rol: 'nominas', nombre: 'Nominas', perfilAcceso: 'nominas', propiedadesPermitidas: ['hrm'],
    permisosSistema: [presets.PERMISOS.REPORTES_MEXICO],
  });
  h.docs.set('asistenciaJornadas/ev_nom', {
    empleadoId: 'emp_prueba', empleadoNombre: 'Persona', tipoPersonal: 'eventual', propiedadId: 'hrm',
    entradaEn: { toMillis: () => Date.parse('2026-09-06T15:00:00Z') }, salidaEn: null, estado: 'salida_pendiente',
  });
  await assert.rejects(h.handlers.asistenciaResolverTurnoAdministrativo({
    auth: { uid: 'nom1' },
    data: { jornadaId: 'ev_nom', accion: 'sin_salida', motivo: 'Intento sin permiso de resolver turno eventual.' },
  }), /no puede resolver turnos/);
});

function prepararEventualHrmReciente(h) {
  h.docs.set('usuarios/operador', {
    activo: true,
    rol: 'guardia',
    modulosPermitidos: ['asistencia'],
    propiedadesPermitidas: ['hrm'],
    nombre: 'Guardia',
  });
  h.docs.set('propiedades/hrm', {
    activo: true,
    nombre: 'HRM',
    asistencia: { zonaHoraria: 'America/Mexico_City' },
  });
  h.docs.set('asistenciaClaves/P01', {
    empleadoId: 'emp_prueba',
    clave: 'P01',
    tipo: 'eventual',
  });
  Object.assign(h.docs.get('asistenciaPersonal/emp_prueba'), {
    propiedadId: 'hrm',
    propiedadesPermitidas: ['hrm'],
    activo: true,
    tipo: 'eventual',
    puestoId: 'mesero',
    puestoNombre: 'Mesero',
    tarifaBase: 100,
  });
}

test('backend: recent eventual exit asks whether to continue or start another shift', async () => {
  const h = harness();
  prepararEventualHrmReciente(h);

  await h.handlers.asistenciaRegistrarMovimiento(
    h.request('recent_in', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' })
  );
  h.advance(3 * 3600000);
  await h.handlers.asistenciaRegistrarMovimiento(
    h.request('recent_out', 'salida', {
      propiedadId: 'hrm', fotoPath: '', validacionPin: '', jornadaEsperadaId: 'recent_in',
    })
  );
  h.advance(5 * 60000);

  const result = await h.handlers.asistenciaConsultarEmpleado({
    auth: { uid: 'operador' },
    data: { propiedadId: 'hrm', clave: 'P01' },
  });

  assert.equal(result.movimiento, 'confirmar_turno_reciente');
  assert.equal(result.turnoReciente.id, 'recent_in');
  assert.equal(result.turnoReciente.minutosDesdeSalida, 5);
  assert.equal(result.turnoReciente.ventanaMinutos, 60);
});

test('backend: recent eventual exit cannot silently create another shift', async () => {
  const h = harness();
  prepararEventualHrmReciente(h);

  await h.handlers.asistenciaRegistrarMovimiento(
    h.request('guard_in', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' })
  );
  h.advance(2 * 3600000);
  await h.handlers.asistenciaRegistrarMovimiento(
    h.request('guard_out', 'salida', {
      propiedadId: 'hrm', fotoPath: '', validacionPin: '', jornadaEsperadaId: 'guard_in',
    })
  );
  h.advance(2 * 60000);

  await assert.rejects(
    h.handlers.asistenciaRegistrarMovimiento(
      h.request('guard_new_blocked', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' })
    ),
    /confirma si deseas continuarla o iniciar un turno nuevo/
  );
  assert(!h.docs.has('asistenciaJornadas/guard_new_blocked'));

  const created = await h.handlers.asistenciaRegistrarMovimiento(
    h.request('guard_new_confirmed', 'entrada', {
      propiedadId: 'hrm',
      fotoPath: '',
      validacionPin: '',
      confirmarNuevoTurnoReciente: true,
      jornadaRecienteId: 'guard_in',
    })
  );

  assert.equal(created.tipo, 'entrada');
  assert.equal(created.nuevoTurnoTrasSalidaReciente, true);
  assert.equal(h.docs.get('asistenciaJornadas/guard_in').estado, 'completa');
  assert.equal(h.docs.get('asistenciaJornadas/guard_new_confirmed').estado, 'abierta');
  assert.equal(h.docs.get('asistenciaJornadas/guard_new_confirmed').jornadaAnteriorCerradaId, 'guard_in');
});

test('backend: security can reopen the same recently closed eventual shift with audit trail', async () => {
  const h = harness();
  prepararEventualHrmReciente(h);

  await h.handlers.asistenciaRegistrarMovimiento(
    h.request('reopen_in', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' })
  );
  h.advance(4 * 3600000);
  await h.handlers.asistenciaRegistrarMovimiento(
    h.request('reopen_out', 'salida', {
      propiedadId: 'hrm', fotoPath: '', validacionPin: '', jornadaEsperadaId: 'reopen_in',
    })
  );
  h.advance(7 * 60000);

  const result = await h.handlers.asistenciaReabrirJornadaReciente({
    auth: { uid: 'operador' },
    data: {
      solicitudId: 'reopen_action',
      empleadoId: 'emp_prueba',
      propiedadId: 'hrm',
      jornadaCerradaId: 'reopen_in',
    },
  });

  const jornada = h.docs.get('asistenciaJornadas/reopen_in');
  assert.equal(result.tipo, 'reapertura');
  assert.equal(result.jornadaReabierta, true);
  assert.equal(jornada.estado, 'abierta');
  assert.equal(jornada.salidaEn, null);
  assert.equal(jornada.minutos, null);
  assert(jornada.ultimaSalidaAnuladaEn);
  assert.equal(h.docs.get('asistenciaEstado/emp_prueba').jornadaAbiertaId, 'reopen_in');
  assert([...h.docs.entries()].some(([path, row]) => path.startsWith('asistenciaAuditoria/') && row.accion === 'reabrir_jornada_salida_reciente'));
});

test('backend: after 60 minutes a closed eventual shift is treated as a normal new shift', async () => {
  const h = harness();
  prepararEventualHrmReciente(h);

  await h.handlers.asistenciaRegistrarMovimiento(
    h.request('old_in', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' })
  );
  h.advance(2 * 3600000);
  await h.handlers.asistenciaRegistrarMovimiento(
    h.request('old_out', 'salida', {
      propiedadId: 'hrm', fotoPath: '', validacionPin: '', jornadaEsperadaId: 'old_in',
    })
  );
  h.advance(60 * 60000);

  const result = await h.handlers.asistenciaConsultarEmpleado({
    auth: { uid: 'operador' },
    data: { propiedadId: 'hrm', clave: 'P01' },
  });
  assert.equal(result.movimiento, 'entrada');
  assert.equal(result.turnoReciente, null);

  const created = await h.handlers.asistenciaRegistrarMovimiento(
    h.request('old_new', 'entrada', { propiedadId: 'hrm', fotoPath: '', validacionPin: '' })
  );
  assert.equal(created.tipo, 'entrada');
  assert.equal(h.docs.get('asistenciaJornadas/old_new').estado, 'abierta');
});
