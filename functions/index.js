import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  puedeRegistrarAsistencia, puedeVerPropiedad, puedeConsultarReportes, validarPersonal,
  normalizarClave, tipoRequiereFoto, fechaEnZona, validarTransicion, personalPuedeOperarEnPropiedad,
  validarPinMexico, MAX_FOTO_BYTES, horasTranscurridasJornada,
  HORAS_CIERRE_MEXICO_DEFAULT, HORAS_PENDIENTE_EVENTUAL_DEFAULT,
  HORAS_PENDIENTE_PRACTICANTE_DEFAULT, MINUTOS_REAPERTURA_TURNO_DEFAULT,
} from './asistenciaDomain.js';

import {
  expandirPerfilAcceso,
  passwordCuentaMexico,
  PERMISOS,
  tienePermiso,
  validarPermisosParaRol,
} from './perfilesAcceso.js';

initializeApp();
const db = getFirestore();
const options = { region: 'us-central1', maxInstances: 3, timeoutSeconds: 60, memory: '256MiB' };
const fail = (code, message) => { throw new HttpsError(code, message); };
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 32);
const idValido = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const personalId = (propiedadId, clave) => `emp_${hash(`${propiedadId}\0${clave}`)}`;
const codigoPersonal = (tipo) => `${tipo === 'eventual' ? 'EVGMR' : 'PRGMR'}-${randomBytes(5).toString('hex').toUpperCase()}`;
const encodeTime = (t) => t?.toDate?.().toISOString() || null;

const PIN_TOKEN_MINUTOS = 10;

function crearCredencialPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const pinHash = scryptSync(pin, salt, 32).toString('hex');
  return { pinSalt: salt, pinHash, pinVersion: 1 };
}

function verificarCredencialPin(pin, credential) {
  if (!credential?.pinSalt || !credential?.pinHash) return false;
  try {
    const expected = Buffer.from(credential.pinHash, 'hex');
    const actual = scryptSync(pin, credential.pinSalt, 32);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function pinValidationRef(uid, empleadoId) {
  return db.doc(`asistenciaValidacionesPin/pin_${hash(`${uid}\0${empleadoId}`)}`);
}

function crearTokenPin() {
  return randomBytes(24).toString('hex');
}


function numeroHorasConfig(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 4 && n <= 72 ? n : fallback;
}

async function limitesAsistencia() {
  const snap = await db.doc('configuracionAsistencia/limites').get();
  const data = snap.exists ? snap.data() : {};
  return {
    mexico: numeroHorasConfig(data?.mexicoHorasSinSalida, HORAS_CIERRE_MEXICO_DEFAULT),
    eventual: numeroHorasConfig(data?.eventualHorasPendiente, HORAS_PENDIENTE_EVENTUAL_DEFAULT),
    practicante: numeroHorasConfig(data?.practicanteHorasPendiente, HORAS_PENDIENTE_PRACTICANTE_DEFAULT),
  };
}

function limitePorTipo(tipo, limites) {
  if (tipo === 'personal_mexico') return limites.mexico;
  if (tipo === 'eventual') return limites.eventual;
  if (tipo === 'practicante') return limites.practicante;
  return null;
}

function esJornadaAbiertaOperativa(jornada) {
  return Boolean(jornada)
    && !jornada.salidaEn
    && ['abierta', 'salida_pendiente'].includes(jornada.estado);
}

function salidaRecienteDesdeEstado(estado, propiedadId, ahoraMs, ventanaMinutos = MINUTOS_REAPERTURA_TURNO_DEFAULT) {
  const jornadaId = estado?.ultimaJornadaCerradaId || '';
  const salidaMs = estado?.ultimaSalidaEn?.toMillis?.();

  if (
    !jornadaId
    || estado?.propiedadId !== propiedadId
    || !Number.isFinite(salidaMs)
    || !Number.isFinite(ahoraMs)
    || ahoraMs < salidaMs
  ) {
    return null;
  }

  const transcurridosMs = ahoraMs - salidaMs;
  if (transcurridosMs >= ventanaMinutos * 60000) return null;

  return {
    jornadaId,
    salidaMs,
    minutosDesdeSalida: Math.floor(transcurridosMs / 60000),
    ventanaMinutos,
  };
}

async function revisarJornadaVencida({ empleadoId, jornadaId, tipoPersonal, limites, now = Timestamp.now() }) {
  if (!jornadaId || !['personal_mexico', 'eventual', 'practicante'].includes(tipoPersonal)) {
    return { accion: 'sin_cambios' };
  }

  const jornadaRef = db.doc(`asistenciaJornadas/${jornadaId}`);
  const stateRef = db.doc(`asistenciaEstado/${empleadoId}`);
  const auditRef = db.collection('asistenciaAuditoria').doc();

  return db.runTransaction(async (tx) => {
    const [jornadaSnap, stateSnap] = await Promise.all([
      tx.get(jornadaRef),
      tx.get(stateRef),
    ]);

    if (!jornadaSnap.exists) {
      if (stateSnap.exists && stateSnap.data()?.jornadaAbiertaId === jornadaId) {
        tx.set(stateRef, { jornadaAbiertaId: null, actualizadoEn: now }, { merge: true });
      }
      return { accion: 'estado_reparado' };
    }

    const jornada = jornadaSnap.data();
    if (!esJornadaAbiertaOperativa(jornada)) {
      if (stateSnap.exists && stateSnap.data()?.jornadaAbiertaId === jornadaId) {
        tx.set(stateRef, { jornadaAbiertaId: null, actualizadoEn: now }, { merge: true });
      }
      return { accion: 'estado_reparado', jornada };
    }

    const horas = horasTranscurridasJornada(jornada, now.toMillis());
    const limite = limitePorTipo(tipoPersonal, limites);
    if (horas === null || limite === null || horas < limite) {
      return { accion: 'sin_cambios', jornada, horas, limite };
    }

    if (tipoPersonal === 'personal_mexico') {
      tx.update(jornadaRef, {
        estado: 'sin_salida',
        salidaEn: null,
        minutos: null,
        cierreAutomatico: true,
        motivoCierre: 'limite_horas_mexico',
        cerradaSistemaEn: now,
        actualizadoEn: now,
      });
      tx.set(stateRef, {
        propiedadId: jornada.propiedadId,
        jornadaAbiertaId: null,
        actualizadoEn: now,
      }, { merge: true });
      tx.create(auditRef, {
        jornadaId,
        empleadoId,
        propiedadId: jornada.propiedadId,
        accion: 'cierre_automatico_sin_salida',
        motivo: `Jornada Mexico excedio ${limite} horas sin salida registrada.`,
        anterior: { estado: jornada.estado, salidaEn: jornada.salidaEn || null },
        nuevo: { estado: 'sin_salida', salidaEn: null },
        por: 'sistema',
        porNombre: 'Sistema',
        creadaEn: now,
      });
      return { accion: 'cerrada_sin_salida', horas, limite, jornada: { ...jornada, estado: 'sin_salida' } };
    }

    if (jornada.estado !== 'salida_pendiente') {
      tx.update(jornadaRef, {
        estado: 'salida_pendiente',
        salidaPendienteDesde: now,
        actualizadoEn: now,
      });
    }

    return {
      accion: 'salida_pendiente',
      horas,
      limite,
      jornada: { ...jornada, estado: 'salida_pendiente' },
    };
  });
}

function datosTurnoPendiente(jornadaId, jornada, horas, limite) {
  return {
    id: jornadaId,
    entradaEn: encodeTime(jornada?.entradaEn),
    propiedadId: jornada?.propiedadId || '',
    propiedadNombre: jornada?.propiedadNombre || '',
    horasTranscurridas: Number.isFinite(horas) ? Math.round(horas * 10) / 10 : null,
    limiteHoras: limite,
    estado: 'salida_pendiente',
  };
}

function endpoint(fn) {
  return onCall(options, async (req) => {
    if (!req.auth?.uid) fail('unauthenticated', 'Inicia sesion nuevamente.');
    try { return await fn(req); }
    catch (error) {
      if (error instanceof HttpsError) throw error;
      // No credentials, names, photos or request bodies in logs.
      const referencia = hash(`${Date.now()}:${Math.random()}`).slice(0, 12);
      console.error('AsistenciaError', { referencia, codigo: String(error?.code || ''), nombre: String(error?.name || 'Error') });
      throw new HttpsError('internal', `No se pudo completar la operacion. Referencia: ${referencia}. Consulta los registros de Cloud Functions.`, { referencia });
    }
  });
}

async function perfil(uid) {
  const snap = await db.doc(`usuarios/${uid}`).get();
  const p = snap.exists ? snap.data() : null;
  if (p?.activo !== true) fail('permission-denied', 'Tu cuenta no esta activa.');
  return { ...p, id: uid };
}
async function administrador(uid) {
  const p = await perfil(uid);
  if (p.rol !== 'administrador') fail('permission-denied', 'Esta accion requiere administrador.');
  return p;
}
async function administradorOPersonal(uid) {
  const p = await perfil(uid);
  if (p.rol !== 'administrador' && !tienePermiso(p, PERMISOS.ADMINISTRAR_PERSONAL)) {
    fail('permission-denied', 'Esta cuenta no puede administrar personal.');
  }
  return p;
}
async function administradorOPuestos(uid) {
  const p = await perfil(uid);
  if (p.rol !== 'administrador' && !tienePermiso(p, PERMISOS.ADMINISTRAR_PUESTOS)) {
    fail('permission-denied', 'Esta cuenta no puede administrar puestos.');
  }
  return p;
}

async function administradorORHResolverEventuales(uid) {
  const p = await perfil(uid);
  if (p.rol !== 'administrador' && !tienePermiso(p, PERMISOS.RESOLVER_TURNOS_EVENTUALES)) {
    fail('permission-denied', 'Esta cuenta no puede resolver turnos de eventuales.');
  }
  return p;
}

async function actorConPermiso(uid, permiso, mensaje) {
  const p = await perfil(uid);
  if (p.rol !== 'administrador' && !tienePermiso(p, permiso)) {
    fail('permission-denied', mensaje || 'No tienes permiso para esta acción.');
  }
  return p;
}

function horaValida(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutosHora(value) {
  const [h, m] = String(value).split(':').map(Number);
  return (h * 60) + m;
}

function datosDuracionHorario(horaInicio, horaFin) {
  const inicio = minutosHora(horaInicio);
  const fin = minutosHora(horaFin);
  let minutos = fin - inicio;
  const cruzaDia = minutos <= 0;
  if (cruzaDia) minutos += 24 * 60;
  return { minutosDuracion: minutos, cruzaDia };
}

function fechaIsoValida(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function sumarDiasIso(value, days) {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function lunesDeFechaIso(value) {
  const d = new Date(`${value}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function plainDoc(docSnap) {
  const data = docSnap.data() || {};
  const result = { id: docSnap.id, ...data };
  for (const key of ['creadoEn', 'actualizadoEn', 'asignadoEn']) {
    if (result[key]?.toDate) result[key] = result[key].toDate().toISOString();
  }
  return result;
}

function propiedadesPermitidasValidas(value) {
  const list = Array.isArray(value) ? [...new Set(value)] : [];
  if (!list.length || list.length > 100) return null;
  if (list.includes('*') && list.length !== 1) return null;
  if (list.some((id) => id !== '*' && !idValido(id))) return null;
  return list;
}

async function validarPropiedadesActivas(ids) {
  if (ids.includes('*')) return;
  const snaps = await Promise.all(ids.map((id) => db.doc(`propiedades/${id}`).get()));
  if (snaps.some((snap) => !snap.exists || snap.data().activo !== true)) {
    fail('failed-precondition', 'Una propiedad no existe o esta inactiva.');
  }
}
async function autorizarPropiedad(p, propiedadId, read = (ref) => ref.get()) {
  if (!idValido(propiedadId) || !puedeVerPropiedad(p, propiedadId)) {
    fail('permission-denied', 'No tienes acceso a esta propiedad.');
  }
  const ps = await read(db.doc(`propiedades/${propiedadId}`));
  const propiedad = ps.data();
  if (!ps.exists || propiedad.activo !== true) {
    fail('failed-precondition', 'La propiedad no existe o esta inactiva.');
  }
  const config = await read(db.doc('configuracionAsistencia/mexico'));
  const esMexico = config.data()?.propiedadId === propiedadId;
  if (p.rol === 'asistencia' && !esMexico) {
    fail('permission-denied', 'El perfil Seguridad Mexico solo puede registrar en Mexico.');
  }
  // The old per-property enable switch is no longer part of authorization.
  // Only the canonical Mexico property requires a photo by default.
  return { ...propiedad, id: propiedadId, asistencia: {
    ...propiedad.asistencia, habilitado: true,
    fotoEntrada: esMexico, fotoSalida: esMexico,
    zonaHoraria: propiedad.asistencia?.zonaHoraria || 'America/Mexico_City',
  } };
}

async function prepararMexico(uid) {
  const all = await db.collection('propiedades').get();
  const found = all.docs.filter((d) =>
    normalizarClave(d.data().nombre) === 'MEXICO' || normalizarClave(d.data().codigo) === 'MEXICO');
  if (found.length > 1) fail('failed-precondition', 'Hay varias propiedades Mexico. Unifica el catalogo antes de continuar.');
  const ref = found[0]?.ref || db.doc('propiedades/mexico');
  await db.runTransaction(async (tx) => {
    const [old, config] = await Promise.all([tx.get(ref), tx.get(db.doc('configuracionAsistencia/mexico'))]);
    if (config.exists && config.data().propiedadId !== ref.id) {
      fail('failed-precondition', 'Mexico ya esta vinculada a otra propiedad. No se modifico la referencia existente.');
    }
    if (!found.length && old.exists && normalizarClave(old.data().nombre) !== 'MEXICO') {
      fail('already-exists', 'El ID mexico pertenece a otra propiedad. Revisa el catalogo.');
    }
    if (old.exists && old.data().activo !== true) {
      fail('failed-precondition', 'La propiedad Mexico esta inactiva. Activala desde Propiedades.');
    }
    const now = Timestamp.now();
    tx.set(ref, {
      ...(old.exists ? {} : { creadoEn: now, creadoPor: uid }),
      nombre: 'M\u00e9xico', codigo: 'MEXICO', activo: true,
      asistencia: { habilitado: true, fotoEntrada: true, fotoSalida: true,
        zonaHoraria: 'America/Mexico_City' },
      actualizadoEn: now, actualizadoPor: uid,
    }, { merge: true });
    tx.set(db.doc('configuracionAsistencia/mexico'), { propiedadId: ref.id, actualizadoEn: now });
  });
  return { propiedadId: ref.id, nombre: 'M\u00e9xico' };
}
export const asistenciaPrepararMexico = endpoint(async (req) => {
  await administrador(req.auth.uid);
  return prepararMexico(req.auth.uid);
});

export const asistenciaConfigurarPropiedad = endpoint(async (req) => {
  await administrador(req.auth.uid);
  fail('failed-precondition', 'Ya no se habilita Asistencia por propiedad. Actualiza el portal y asigna un perfil de acceso en Usuarios.');
});

export const asistenciaCrearAccesoMexico = endpoint(async (req) => {
  await administrador(req.auth.uid);
  const username = normalizarClave(req.data?.usuario);
  if (!/^[A-Z0-9_-]{4,32}$/.test(username)) fail('invalid-argument', 'Usuario: 4 a 32 letras y numeros, sin espacios.');
  let credential;
  try { credential = passwordCuentaMexico(req.data?.password); }
  catch (e) { fail('invalid-argument', e.message); }
  const { password, claveCorta } = credential;
  if (claveCorta && req.data?.aceptaClaveTemporal !== true) {
    fail('failed-precondition', 'Confirma que la clave de 4 digitos es solo provisional.');
  }
  const { propiedadId } = await prepararMexico(req.auth.uid);
  const email = `${username.toLowerCase()}@seguridadgmr.local`;
  let account;
  try {
    account = await getAuth().createUser({ email, password, displayName: 'Seguridad Mexico', disabled: true });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') fail('already-exists', 'Ese usuario ya existe. No se cambio su contrasena.');
    if (['auth/invalid-password', 'auth/password-does-not-meet-requirements'].includes(e.code)) {
      fail('invalid-argument', 'La politica de Authentication rechazo esta clave. Usa una contrasena fuerte que cumpla la politica del proyecto.');
    }
    throw e;
  }
  try {
    await db.doc(`usuarios/${account.uid}`).create({
      nombre: 'Seguridad Mexico', correo: email, usuario: username,
      rol: 'asistencia', perfilAcceso: 'seguridad_mexico', perfilNombre: 'Seguridad Mexico', activo: true, claveTemporal: claveCorta,
      propiedadId, propiedadesPermitidas: [propiedadId], modulosPermitidos: ['asistencia'],
      creadoEn: Timestamp.now(), creadoPor: req.auth.uid,
    });
    await getAuth().updateUser(account.uid, { disabled: false });
  } catch (e) {
    // Keep disabled on partial setup; an administrator can reconcile explicitly.
    await getAuth().updateUser(account.uid, { disabled: true }).catch(() => {});
    fail('internal', `El alta no termino. La cuenta quedo deshabilitada; revisa Authentication. UID: ${account.uid}`);
  }
  return { uid: account.uid, usuario: username, correo: email, propiedadId, claveTemporal: claveCorta };
});

export const seguridadGuardarUsuarioSistema = endpoint(async (req) => {
  await administrador(req.auth.uid);
  const { uid = '', nombre, acceso, clave = '', perfilAcceso, propiedadesPermitidas, permisosSistema, activo = true } = req.data || {};
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 160 || typeof acceso !== 'string'
    || typeof activo !== 'boolean') fail('invalid-argument', 'Completa nombre, acceso y estado.');
  let access;
  try { access = expandirPerfilAcceso(perfilAcceso); } catch (e) { fail('invalid-argument', e.message); }
  const permisos = access.rol === 'administrador' ? ['*'] : propiedadesPermitidasValidas(propiedadesPermitidas);
  if (!permisos) fail('invalid-argument', 'Selecciona propiedades validas.');
  await validarPropiedadesActivas(permisos);
  const shortUser = normalizarClave(acceso);
  const isEmail = acceso.includes('@');
  if (['guardia', 'asistencia'].includes(access.rol) && !isEmail && !/^[A-Z0-9_-]{3,32}$/.test(shortUser)) {
    fail('invalid-argument', 'Usuario corto: 3 a 32 letras, numeros, guiones o guion bajo.');
  }
  if (['administrador', 'supervisor', 'rh', 'nominas'].includes(access.rol) && !isEmail) {
    fail('invalid-argument', 'Administrador, supervisor, RH y Nóminas deben usar un correo válido.');
  }
  const email = isEmail ? acceso.trim().toLowerCase() : `${shortUser.toLowerCase()}@seguridadgmr.local`;
  let account;
  if (uid) {
    if (!idValido(uid)) fail('invalid-argument', 'UID invalido.');
    try { account = await getAuth().getUser(uid); }
    catch (e) { if (e.code === 'auth/user-not-found') fail('not-found', 'La cuenta ya no existe en Authentication.'); throw e; }
    const changes = { displayName: nombre.trim(), disabled: !activo };
    if (clave) {
      try { changes.password = passwordCuentaMexico(clave).password; } catch (e) { fail('invalid-argument', e.message); }
    }
    if (String(account.email || '').toLowerCase() !== email) changes.email = email;
    account = await getAuth().updateUser(uid, changes);
  } else {
    if (!clave) fail('invalid-argument', 'Captura una clave para el nuevo usuario.');
    let password;
    try { password = passwordCuentaMexico(clave).password; } catch (e) { fail('invalid-argument', e.message); }
    try { account = await getAuth().createUser({ email, password, displayName: nombre.trim(), disabled: !activo }); }
    catch (e) {
      if (e.code === 'auth/email-already-exists') fail('already-exists', 'Ese usuario o correo ya existe.');
      throw e;
    }
  }
  if (req.auth.uid === account.uid && (!activo || access.rol !== 'administrador')) {
    fail('failed-precondition', 'No puedes quitar tus propios permisos de administrador.');
  }
  let permisosUsuario;
  try {
    permisosUsuario = permisosSistema === undefined
      ? access.permisosSistema
      : validarPermisosParaRol(access.rol, permisosSistema);
  } catch (e) {
    fail('invalid-argument', e.message);
  }
  if (access.rol === 'administrador') permisosUsuario = ['*'];

  if (['asistencia', 'nominas'].includes(access.rol)) {
    if (permisos.length !== 1 || permisos[0] === '*') {
      fail('failed-precondition', access.rol === 'nominas'
        ? 'Nóminas debe tener solamente la propiedad México.'
        : 'Seguridad México debe tener solamente una propiedad México.');
    }
    const mexicoProperty = await db.doc(`propiedades/${permisos[0]}`).get();
    const data = mexicoProperty.data() || {};
    const esMexico = normalizarClave(data.nombre) === 'MEXICO' || normalizarClave(data.codigo) === 'MEXICO';
    if (!mexicoProperty.exists || !esMexico) fail('failed-precondition', 'Selecciona la propiedad México.');
    await db.doc('configuracionAsistencia/mexico').set({ propiedadId: permisos[0], actualizadoEn: Timestamp.now() }, { merge: true });
  }
  const now = Timestamp.now();
  const ref = db.doc(`usuarios/${account.uid}`);
  const old = await ref.get();
  const values = {
    nombre: nombre.trim(), correo: account.email, usuario: isEmail ? '' : shortUser,
    ...access, perfilAcceso, permisosSistema: permisosUsuario, propiedadesPermitidas: permisos,
    propiedadId: permisos.includes('*') ? 'todas' : permisos[0], activo,
    actualizadoEn: now, actualizadoPor: req.auth.uid,
  };
  await ref.set({ ...values, ...(old.exists ? {} : { creadoEn: now, creadoPor: req.auth.uid }) }, { merge: true });
  await db.collection('auditoria').add({ accion: old.exists ? 'editar_usuario_sistema' : 'crear_usuario_sistema',
    usuarioId: account.uid, por: req.auth.uid, creadaEn: now, rol: access.rol, propiedadesPermitidas: permisos });
  return { uid: account.uid, correo: account.email, usuario: isEmail ? '' : shortUser };
});

export const seguridadActualizarPermisosUsuario = endpoint(async (req) => {
  const actor = await administrador(req.auth.uid);
  const uid = String(req.data?.uid || '').trim();
  if (!idValido(uid)) fail('invalid-argument', 'Usuario inválido.');

  const ref = db.doc(`usuarios/${uid}`);
  const old = await ref.get();
  if (!old.exists) fail('not-found', 'El usuario ya no existe.');
  const data = old.data();
  if (data.rol === 'administrador') fail('failed-precondition', 'El Administrador conserva acceso total.');
  let permisos;
  try { permisos = validarPermisosParaRol(data.rol, req.data?.permisosSistema); }
  catch (e) { fail('invalid-argument', e.message); }

  const now = Timestamp.now();
  await ref.update({ permisosSistema: permisos, actualizadoEn: now, actualizadoPor: actor.id });
  await db.collection('auditoria').add({
    accion: 'actualizar_permisos_usuario',
    usuarioId: uid,
    por: actor.id,
    creadaEn: now,
    anterior: Array.isArray(data.permisosSistema) ? data.permisosSistema : null,
    nuevo: permisos,
  });
  return { ok: true, uid, permisosSistema: permisos };
});

export const asistenciaGuardarPuesto = endpoint(async (req) => {
  const actor = await administradorOPuestos(req.auth.uid);
  const { puestoId = '', nombre, descripcion = '', tarifaHora, activo = true } = req.data || {};
  const tarifa = Number(tarifaHora);
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 120
    || typeof descripcion !== 'string' || descripcion.length > 500 || !Number.isFinite(tarifa) || tarifa < 0
    || typeof activo !== 'boolean') fail('invalid-argument', 'Revisa nombre, tarifa y estado del puesto.');
  const ref = puestoId ? db.doc(`puestos/${puestoId}`) : db.collection('puestos').doc();
  if (puestoId && !idValido(puestoId)) fail('invalid-argument', 'Puesto invalido.');
  const now = Timestamp.now();
  const old = await ref.get();
  await ref.set({ nombre: nombre.trim(), descripcion: descripcion.trim(), tarifaHora: tarifa, activo,
    actualizadoEn: now, actualizadoPor: actor.id,
    ...(old.exists ? {} : { creadoEn: now, creadoPor: actor.id }) }, { merge: true });
  return { puestoId: ref.id };
});


export const planeacionListarHorarios = endpoint(async (req) => {
  const actor = await perfil(req.auth.uid);
  const allowed = actor.rol === 'administrador'
    || tienePermiso(actor, PERMISOS.ADMINISTRAR_HORARIOS)
    || tienePermiso(actor, PERMISOS.PLANEACION_PERSONAL);
  if (!allowed) fail('permission-denied', 'No tienes permiso para consultar horarios.');

  const snap = await db.collection('horarios').orderBy('horaInicio').get();
  return { rows: snap.docs.map(plainDoc) };
});

export const planeacionGuardarHorario = endpoint(async (req) => {
  const actor = await actorConPermiso(
    req.auth.uid,
    PERMISOS.ADMINISTRAR_HORARIOS,
    'Esta cuenta no puede administrar horarios.'
  );
  const {
    horarioId = '',
    nombre,
    horaInicio,
    horaFin,
    activo = true,
  } = req.data || {};

  if (
    typeof nombre !== 'string'
    || !nombre.trim()
    || nombre.trim().length > 80
    || !horaValida(horaInicio)
    || !horaValida(horaFin)
    || typeof activo !== 'boolean'
  ) {
    fail('invalid-argument', 'Revisa nombre, hora de entrada, hora de salida y estado.');
  }

  if (horarioId && !idValido(horarioId)) fail('invalid-argument', 'Horario inválido.');
  const duracion = datosDuracionHorario(horaInicio, horaFin);
  if (duracion.minutosDuracion < 30 || duracion.minutosDuracion > 24 * 60) {
    fail('invalid-argument', 'La duración del horario debe estar entre 30 minutos y 24 horas.');
  }

  const ref = horarioId ? db.doc(`horarios/${horarioId}`) : db.collection('horarios').doc();
  const old = await ref.get();
  const now = Timestamp.now();
  await ref.set({
    nombre: nombre.trim(),
    horaInicio,
    horaFin,
    ...duracion,
    activo,
    actualizadoEn: now,
    actualizadoPor: actor.id,
    ...(old.exists ? {} : { creadoEn: now, creadoPor: actor.id }),
  }, { merge: true });

  await db.collection('auditoria').add({
    accion: old.exists ? 'editar_horario' : 'crear_horario',
    horarioId: ref.id,
    por: actor.id,
    creadaEn: now,
  });
  return { horarioId: ref.id };
});

export const planeacionListarSemana = endpoint(async (req) => {
  const actor = await actorConPermiso(
    req.auth.uid,
    PERMISOS.PLANEACION_PERSONAL,
    'Esta cuenta no puede consultar la planeación de personal.'
  );
  const propiedadId = String(req.data?.propiedadId || '').trim();
  const semanaInicio = String(req.data?.semanaInicio || '').trim();
  if (!fechaIsoValida(semanaInicio)) fail('invalid-argument', 'Semana inválida.');
  await autorizarPropiedad(actor, propiedadId);
  const semanaFin = sumarDiasIso(semanaInicio, 6);

  const [needsSnap, assignmentsSnap, horariosSnap, puestosSnap, eventualesSnap] = await Promise.all([
    db.collection('necesidadesPersonal')
      .where('propiedadId', '==', propiedadId)
      .where('fecha', '>=', semanaInicio)
      .where('fecha', '<=', semanaFin)
      .get(),
    db.collection('programacionPersonal')
      .where('propiedadId', '==', propiedadId)
      .where('fecha', '>=', semanaInicio)
      .where('fecha', '<=', semanaFin)
      .get(),
    db.collection('horarios').orderBy('horaInicio').get(),
    db.collection('puestos').orderBy('nombre').get(),
    db.collection('asistenciaPersonal').where('tipo', '==', 'eventual').where('activo', '==', true).get(),
  ]);

  const eventuales = eventualesSnap.docs
    .map(plainDoc)
    .filter((item) => {
      const props = Array.isArray(item.propiedadesPermitidas) && item.propiedadesPermitidas.length
        ? item.propiedadesPermitidas
        : item.propiedadId ? [item.propiedadId] : [];
      return props.includes(propiedadId);
    })
    .map((item) => ({
      id: item.id,
      nombre: item.nombre || '',
      puestoId: item.puestoId || '',
      puestoNombre: item.puestoNombre || '',
      tarifaPersonalizada: item.tarifaPersonalizada !== null && item.tarifaPersonalizada !== '' && Number.isFinite(Number(item.tarifaPersonalizada)) ? Number(item.tarifaPersonalizada) : null,
      activo: item.activo !== false,
    }));

  return {
    semanaInicio,
    semanaFin,
    necesidades: needsSnap.docs.map(plainDoc).filter((item) => item.activo !== false),
    asignaciones: assignmentsSnap.docs.map(plainDoc).filter((item) => item.activo !== false),
    horarios: horariosSnap.docs.map(plainDoc),
    puestos: puestosSnap.docs.map(plainDoc),
    eventuales,
  };
});


function fechaHoraLocalSeguimiento(value, timeZone) {
  const date = value?.toDate?.() || (value instanceof Date ? value : value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  const fecha = `${values.year}-${values.month}-${values.day}`;
  const hora = `${values.hour}:${values.minute}`;
  return {
    fecha,
    hora,
    minutosDia: (Number(values.hour) * 60) + Number(values.minute),
  };
}

function indiceMinutosPlaneacion(fecha, hora) {
  const [year, month, day] = String(fecha || '').split('-').map(Number);
  if (![year, month, day].every(Number.isFinite) || !horaValida(hora)) return null;
  const dayIndex = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  return (dayIndex * 1440) + minutosHora(hora);
}

function jornadaParaSeguimiento(docSnap, timeZone) {
  const row = docSnap.data() || {};
  const entrada = fechaHoraLocalSeguimiento(row.entradaEn, timeZone);
  const salida = fechaHoraLocalSeguimiento(row.salidaEn, timeZone);
  return {
    id: docSnap.id,
    empleadoId: row.empleadoId || '',
    empleadoNombre: row.empleadoNombre || '',
    puestoId: row.puestoId || '',
    puestoNombre: row.puestoNombre || '',
    fechaJornada: row.fechaJornada || entrada?.fecha || '',
    entradaEn: encodeTime(row.entradaEn),
    salidaEn: encodeTime(row.salidaEn),
    entradaHora: entrada?.hora || '',
    salidaHora: salida?.hora || '',
    entradaIndice: entrada ? indiceMinutosPlaneacion(entrada.fecha, entrada.hora) : null,
    estado: row.estado || '',
    minutos: Number.isFinite(Number(row.minutos)) ? Number(row.minutos) : null,
  };
}

function estadoSeguimientoProgramacion(asignacion, jornada, ahoraIndice) {
  const inicioIndice = indiceMinutosPlaneacion(asignacion.fecha, asignacion.horaInicio);
  const duracion = datosDuracionHorario(asignacion.horaInicio, asignacion.horaFin).minutosDuracion;
  const finIndice = inicioIndice === null ? null : inicioIndice + duracion;

  if (jornada) {
    const diferencia = jornada.entradaIndice === null || inicioIndice === null
      ? null
      : jornada.entradaIndice - inicioIndice;
    const retardoMinutos = diferencia !== null && diferencia > 0 ? diferencia : 0;
    const anticipacionMinutos = diferencia !== null && diferencia < 0 ? Math.abs(diferencia) : 0;
    let estadoSeguimiento = retardoMinutos > 0 ? 'llego_tarde' : 'llego';
    if (jornada.estado === 'salida_pendiente') estadoSeguimiento = 'turno_pendiente';
    else if (jornada.estado === 'sin_salida') estadoSeguimiento = 'sin_salida';

    return {
      estadoSeguimiento,
      retardoMinutos,
      anticipacionMinutos,
      inicioIndice,
      finIndice,
    };
  }

  if (inicioIndice === null || finIndice === null || ahoraIndice === null) {
    return { estadoSeguimiento: 'programado', retardoMinutos: 0, anticipacionMinutos: 0, inicioIndice, finIndice };
  }
  if (ahoraIndice < inicioIndice) {
    return { estadoSeguimiento: 'programado', retardoMinutos: 0, anticipacionMinutos: 0, inicioIndice, finIndice };
  }
  if (ahoraIndice <= finIndice) {
    return { estadoSeguimiento: 'no_ha_llegado', retardoMinutos: 0, anticipacionMinutos: 0, inicioIndice, finIndice };
  }
  return { estadoSeguimiento: 'no_llego', retardoMinutos: 0, anticipacionMinutos: 0, inicioIndice, finIndice };
}

async function construirSeguimientoPlaneacion(propiedadId, semanaInicio, zonaHoraria) {
  const semanaFin = sumarDiasIso(semanaInicio, 6);
  const [assignmentsSnap, jornadasSnap] = await Promise.all([
    db.collection('programacionPersonal')
      .where('propiedadId', '==', propiedadId)
      .where('fecha', '>=', semanaInicio)
      .where('fecha', '<=', semanaFin)
      .get(),
    db.collection('asistenciaJornadas')
      .where('propiedadId', '==', propiedadId)
      .where('tipoPersonal', '==', 'eventual')
      .where('fechaJornada', '>=', semanaInicio)
      .where('fechaJornada', '<=', semanaFin)
      .orderBy('fechaJornada', 'desc')
      .get(),
  ]);

  const asignaciones = assignmentsSnap.docs
    .map(plainDoc)
    .filter((item) => item.activo !== false)
    .sort((a, b) => `${a.fecha || ''}${a.horaInicio || ''}${a.empleadoNombre || ''}`
      .localeCompare(`${b.fecha || ''}${b.horaInicio || ''}${b.empleadoNombre || ''}`, 'es'));
  const jornadas = jornadasSnap.docs.map((docSnap) => jornadaParaSeguimiento(docSnap, zonaHoraria));
  const jornadasPorId = new Map(jornadas.map((jornada) => [jornada.id, jornada]));
  const jornadasPorEmpleado = new Map();
  jornadas.forEach((jornada) => {
    const list = jornadasPorEmpleado.get(jornada.empleadoId) || [];
    list.push(jornada);
    jornadasPorEmpleado.set(jornada.empleadoId, list);
  });

  const jornadasReservadasComoReemplazo = new Set();
  asignaciones.forEach((asignacion) => {
    const jornadaId = String(asignacion.reemplazoJornadaId || '').trim();
    const jornada = jornadaId ? jornadasPorId.get(jornadaId) : null;
    if (jornada && jornada.fechaJornada === asignacion.fecha) jornadasReservadasComoReemplazo.add(jornadaId);
  });

  const ahoraLocal = fechaHoraLocalSeguimiento(Timestamp.now(), zonaHoraria);
  const ahoraIndice = ahoraLocal ? indiceMinutosPlaneacion(ahoraLocal.fecha, ahoraLocal.hora) : null;
  const usadas = new Set();
  const seguimiento = asignaciones.map((asignacion) => {
    const inicioIndice = indiceMinutosPlaneacion(asignacion.fecha, asignacion.horaInicio);
    const candidates = (jornadasPorEmpleado.get(asignacion.empleadoId) || [])
      .filter((jornada) => !usadas.has(jornada.id)
        && !jornadasReservadasComoReemplazo.has(jornada.id)
        && jornada.fechaJornada === asignacion.fecha)
      .sort((a, b) => {
        const da = a.entradaIndice === null || inicioIndice === null ? Number.MAX_SAFE_INTEGER : Math.abs(a.entradaIndice - inicioIndice);
        const dbb = b.entradaIndice === null || inicioIndice === null ? Number.MAX_SAFE_INTEGER : Math.abs(b.entradaIndice - inicioIndice);
        return da - dbb;
      });
    const jornadaOriginal = candidates[0] || null;
    if (jornadaOriginal) usadas.add(jornadaOriginal.id);
    const resultadoOriginal = estadoSeguimientoProgramacion(asignacion, jornadaOriginal, ahoraIndice);

    const reemplazoJornadaId = String(asignacion.reemplazoJornadaId || '').trim();
    const jornadaReemplazo = reemplazoJornadaId ? jornadasPorId.get(reemplazoJornadaId) : null;
    const reemplazoValido = Boolean(jornadaReemplazo && jornadaReemplazo.fechaJornada === asignacion.fecha);
    if (reemplazoValido) usadas.add(jornadaReemplazo.id);
    const resultadoCobertura = reemplazoValido
      ? estadoSeguimientoProgramacion(asignacion, jornadaReemplazo, ahoraIndice)
      : resultadoOriginal;

    const reemplazo = reemplazoValido ? {
      jornadaId: jornadaReemplazo.id,
      empleadoId: asignacion.reemplazoEmpleadoId || jornadaReemplazo.empleadoId || '',
      empleadoNombre: asignacion.reemplazoEmpleadoNombre || jornadaReemplazo.empleadoNombre || '',
      puestoId: asignacion.reemplazoPuestoId || jornadaReemplazo.puestoId || '',
      puestoNombre: asignacion.reemplazoPuestoNombre || jornadaReemplazo.puestoNombre || '',
      motivo: asignacion.reemplazoMotivo || '',
      asignadoPor: asignacion.reemplazoPor || '',
      asignadoEn: encodeTime(asignacion.reemplazoEn),
      estadoJornada: resultadoCobertura.estadoSeguimiento,
    } : null;

    return {
      id: asignacion.id,
      necesidadId: asignacion.necesidadId || '',
      fecha: asignacion.fecha || '',
      horarioId: asignacion.horarioId || '',
      horarioNombre: asignacion.horarioNombre || '',
      horaInicio: asignacion.horaInicio || '',
      horaFin: asignacion.horaFin || '',
      puestoId: asignacion.puestoId || '',
      puestoNombre: asignacion.puestoNombre || '',
      empleadoId: asignacion.empleadoId || '',
      empleadoNombre: asignacion.empleadoNombre || '',
      estadoSeguimiento: reemplazo ? 'reemplazado' : resultadoOriginal.estadoSeguimiento,
      estadoOriginal: resultadoOriginal.estadoSeguimiento,
      retardoMinutos: resultadoCobertura.retardoMinutos,
      anticipacionMinutos: resultadoCobertura.anticipacionMinutos,
      jornada: reemplazo ? jornadaReemplazo : jornadaOriginal,
      jornadaOriginal,
      reemplazo,
    };
  });

  const sinProgramacion = jornadas
    .filter((jornada) => !usadas.has(jornada.id))
    .sort((a, b) => `${a.fechaJornada}${a.entradaHora}${a.empleadoNombre}`
      .localeCompare(`${b.fechaJornada}${b.entradaHora}${b.empleadoNombre}`, 'es'));

  const resumen = seguimiento.reduce((acc, item) => {
    acc.programados += 1;
    const estadoOriginal = item.estadoOriginal || item.estadoSeguimiento;
    if (['llego', 'llego_tarde', 'turno_pendiente', 'sin_salida'].includes(estadoOriginal)) acc.llegaron += 1;
    if (estadoOriginal === 'llego_tarde') acc.tarde += 1;
    if (estadoOriginal === 'no_llego') acc.noLlegaron += 1;
    if (estadoOriginal === 'no_ha_llegado') acc.noHanLlegado += 1;
    if (estadoOriginal === 'turno_pendiente') acc.turnosPendientes += 1;
    if (item.reemplazo) acc.reemplazados += 1;
    return acc;
  }, {
    programados: 0,
    llegaron: 0,
    tarde: 0,
    noLlegaron: 0,
    noHanLlegado: 0,
    turnosPendientes: 0,
    reemplazados: 0,
    sinProgramacion: sinProgramacion.length,
  });

  return {
    semanaInicio,
    semanaFin,
    zonaHoraria,
    criterioRetardoMinutos: 0,
    seguimiento,
    sinProgramacion,
    resumen,
  };
}

export const planeacionListarSeguimientoSemana = endpoint(async (req) => {
  const actor = await actorConPermiso(
    req.auth.uid,
    PERMISOS.PLANEACION_PERSONAL,
    'Esta cuenta no puede consultar el seguimiento de planeación.'
  );
  const propiedadId = String(req.data?.propiedadId || '').trim();
  const semanaInicio = String(req.data?.semanaInicio || '').trim();
  if (!fechaIsoValida(semanaInicio)) fail('invalid-argument', 'Semana inválida.');

  const propiedad = await autorizarPropiedad(actor, propiedadId);
  const zonaHoraria = propiedad.asistencia?.zonaHoraria || 'America/Mexico_City';
  return construirSeguimientoPlaneacion(propiedadId, semanaInicio, zonaHoraria);
});

export const planeacionAsignarReemplazo = endpoint(async (req) => {
  const actor = await actorConPermiso(
    req.auth.uid,
    PERMISOS.PLANEACION_PERSONAL,
    'Esta cuenta no puede registrar reemplazos de personal.'
  );
  const asignacionId = String(req.data?.asignacionId || '').trim();
  const jornadaId = String(req.data?.jornadaId || '').trim();
  const motivo = typeof req.data?.motivo === 'string' ? req.data.motivo.trim() : '';
  if (!idValido(asignacionId) || !idValido(jornadaId) || motivo.length > 500) {
    fail('invalid-argument', 'Revisa la asignación, la jornada y el comentario del reemplazo.');
  }

  const asignacionRef = db.doc(`programacionPersonal/${asignacionId}`);
  const jornadaRef = db.doc(`asistenciaJornadas/${jornadaId}`);
  const [asignacionSnap, jornadaSnap] = await Promise.all([asignacionRef.get(), jornadaRef.get()]);
  if (!asignacionSnap.exists || asignacionSnap.data()?.activo === false) fail('not-found', 'La asignación programada ya no está disponible.');
  if (!jornadaSnap.exists) fail('not-found', 'La jornada seleccionada ya no existe.');

  const asignacion = asignacionSnap.data();
  const jornada = jornadaSnap.data();
  const propiedad = await autorizarPropiedad(actor, asignacion.propiedadId);
  if (String(asignacion.reemplazoJornadaId || '').trim()) {
    fail('failed-precondition', 'Esta asignación ya tiene un reemplazo. Quita el reemplazo actual antes de cambiarlo.');
  }
  if (jornada.propiedadId !== asignacion.propiedadId || jornada.tipoPersonal !== 'eventual') {
    fail('failed-precondition', 'La jornada seleccionada no corresponde a un Eventual de esta propiedad.');
  }
  if ((jornada.fechaJornada || '') !== asignacion.fecha) {
    fail('failed-precondition', 'El reemplazo debe corresponder al mismo día de la asignación.');
  }
  if (!jornada.empleadoId || jornada.empleadoId === asignacion.empleadoId) {
    fail('failed-precondition', 'Selecciona a otra persona como reemplazo.');
  }
  if (asignacion.puestoId && jornada.puestoId && asignacion.puestoId !== jornada.puestoId) {
    fail('failed-precondition', 'El reemplazo debe tener el mismo puesto de la asignación.');
  }

  const zonaHoraria = propiedad.asistencia?.zonaHoraria || 'America/Mexico_City';
  const seguimientoActual = await construirSeguimientoPlaneacion(
    asignacion.propiedadId,
    lunesDeFechaIso(asignacion.fecha),
    zonaHoraria
  );
  const filaActual = seguimientoActual.seguimiento.find((item) => item.id === asignacionId);
  if (!filaActual) fail('failed-precondition', 'La asignación ya no aparece en el seguimiento actual.');
  if (filaActual.reemplazo) {
    fail('failed-precondition', 'Esta asignación ya tiene un reemplazo. Actualiza la pantalla antes de continuar.');
  }
  if (!['no_ha_llegado', 'no_llego'].includes(filaActual.estadoOriginal || filaActual.estadoSeguimiento)) {
    fail('failed-precondition', 'La persona programada no está pendiente de llegada. Actualiza el seguimiento antes de asignar un reemplazo.');
  }
  const candidatoActual = seguimientoActual.sinProgramacion.find((item) => item.id === jornadaId);
  if (!candidatoActual) {
    fail('failed-precondition', 'La jornada seleccionada ya no está disponible como llegada sin programación. Actualiza el seguimiento.');
  }
  if (candidatoActual.fechaJornada !== asignacion.fecha) {
    fail('failed-precondition', 'El reemplazo debe corresponder al mismo día de la asignación.');
  }
  if (asignacion.puestoId && candidatoActual.puestoId && asignacion.puestoId !== candidatoActual.puestoId) {
    fail('failed-precondition', 'El reemplazo debe tener el mismo puesto de la asignación.');
  }

  const now = Timestamp.now();
  const replacement = {
    reemplazoActivo: true,
    reemplazoJornadaId: jornadaId,
    reemplazoEmpleadoId: jornada.empleadoId || '',
    reemplazoEmpleadoNombre: jornada.empleadoNombre || '',
    reemplazoPuestoId: jornada.puestoId || asignacion.puestoId || '',
    reemplazoPuestoNombre: jornada.puestoNombre || asignacion.puestoNombre || '',
    reemplazoMotivo: motivo,
    reemplazoEn: now,
    reemplazoPor: actor.id,
    actualizadoEn: now,
    actualizadoPor: actor.id,
  };
  const auditRef = db.collection('auditoria').doc();
  const batch = db.batch();
  batch.set(asignacionRef, replacement, { merge: true });
  batch.create(auditRef, {
    accion: 'asignar_reemplazo_planeacion',
    asignacionId,
    necesidadId: asignacion.necesidadId || '',
    propiedadId: asignacion.propiedadId,
    fecha: asignacion.fecha || '',
    programado: {
      empleadoId: asignacion.empleadoId || '',
      empleadoNombre: asignacion.empleadoNombre || '',
      puestoId: asignacion.puestoId || '',
      puestoNombre: asignacion.puestoNombre || '',
    },
    reemplazo: {
      jornadaId,
      empleadoId: jornada.empleadoId || '',
      empleadoNombre: jornada.empleadoNombre || '',
      puestoId: jornada.puestoId || '',
      puestoNombre: jornada.puestoNombre || '',
    },
    motivo,
    por: actor.id,
    creadaEn: now,
  });
  await batch.commit();
  return { ok: true, asignacionId, jornadaId };
});

export const planeacionQuitarReemplazo = endpoint(async (req) => {
  const actor = await actorConPermiso(
    req.auth.uid,
    PERMISOS.PLANEACION_PERSONAL,
    'Esta cuenta no puede quitar reemplazos de personal.'
  );
  const asignacionId = String(req.data?.asignacionId || '').trim();
  if (!idValido(asignacionId)) fail('invalid-argument', 'Asignación inválida.');

  const ref = db.doc(`programacionPersonal/${asignacionId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.activo === false) return { ok: true };
  const item = snap.data();
  await autorizarPropiedad(actor, item.propiedadId);
  if (!String(item.reemplazoJornadaId || '').trim()) return { ok: true };

  const now = Timestamp.now();
  const auditRef = db.collection('auditoria').doc();
  const batch = db.batch();
  batch.set(ref, {
    reemplazoActivo: false,
    reemplazoJornadaId: '',
    reemplazoEmpleadoId: '',
    reemplazoEmpleadoNombre: '',
    reemplazoPuestoId: '',
    reemplazoPuestoNombre: '',
    reemplazoMotivo: '',
    reemplazoEn: null,
    reemplazoPor: '',
    actualizadoEn: now,
    actualizadoPor: actor.id,
  }, { merge: true });
  batch.create(auditRef, {
    accion: 'quitar_reemplazo_planeacion',
    asignacionId,
    necesidadId: item.necesidadId || '',
    propiedadId: item.propiedadId || '',
    fecha: item.fecha || '',
    programado: {
      empleadoId: item.empleadoId || '',
      empleadoNombre: item.empleadoNombre || '',
    },
    reemplazoAnterior: {
      jornadaId: item.reemplazoJornadaId || '',
      empleadoId: item.reemplazoEmpleadoId || '',
      empleadoNombre: item.reemplazoEmpleadoNombre || '',
      motivo: item.reemplazoMotivo || '',
      asignadoPor: item.reemplazoPor || '',
    },
    por: actor.id,
    creadaEn: now,
  });
  await batch.commit();
  return { ok: true, asignacionId };
});

export const planeacionGuardarNecesidad = endpoint(async (req) => {
  const actor = await actorConPermiso(
    req.auth.uid,
    PERMISOS.PLANEACION_PERSONAL,
    'Esta cuenta no puede modificar la planeación de personal.'
  );
  const {
    necesidadId = '',
    propiedadId = '',
    fecha = '',
    horarioId = '',
    puestoId = '',
    cantidadNecesaria,
    observaciones = '',
  } = req.data || {};

  if (
    !idValido(propiedadId)
    || !fechaIsoValida(fecha)
    || !idValido(horarioId)
    || !idValido(puestoId)
    || !Number.isInteger(Number(cantidadNecesaria))
    || Number(cantidadNecesaria) < 1
    || Number(cantidadNecesaria) > 100
    || typeof observaciones !== 'string'
    || observaciones.length > 500
  ) {
    fail('invalid-argument', 'Revisa fecha, horario, puesto y cantidad necesaria.');
  }

  const propertySnap = await autorizarPropiedad(actor, propiedadId);
  const [horarioSnap, puestoSnap] = await Promise.all([
    db.doc(`horarios/${horarioId}`).get(),
    db.doc(`puestos/${puestoId}`).get(),
  ]);
  if (!horarioSnap.exists || horarioSnap.data()?.activo === false) fail('failed-precondition', 'El horario no existe o está inactivo.');
  if (!puestoSnap.exists || puestoSnap.data()?.activo === false) fail('failed-precondition', 'El puesto no existe o está inactivo.');

  const horario = horarioSnap.data();
  const puesto = puestoSnap.data();
  const generatedId = `nec_${hash(`${propiedadId}\0${fecha}\0${horarioId}\0${puestoId}`)}`;
  if (!idValido(generatedId) || (necesidadId && !idValido(necesidadId))) {
    fail('invalid-argument', 'Necesidad inválida.');
  }

  const sourceRef = necesidadId ? db.doc(`necesidadesPersonal/${necesidadId}`) : null;
  const sourceSnap = sourceRef ? await sourceRef.get() : null;
  if (necesidadId && !sourceSnap?.exists) fail('not-found', 'La necesidad ya no existe.');
  if (sourceSnap?.exists && sourceSnap.data()?.propiedadId !== propiedadId) {
    fail('failed-precondition', 'La necesidad pertenece a otra propiedad.');
  }
  if (necesidadId && necesidadId !== generatedId) {
    const assignments = await db.collection('programacionPersonal').where('necesidadId', '==', necesidadId).limit(1).get();
    if (!assignments.empty) {
      fail('failed-precondition', 'Quita las personas asignadas antes de cambiar fecha, horario o puesto.');
    }
    const collision = await db.doc(`necesidadesPersonal/${generatedId}`).get();
    if (collision.exists && collision.data()?.activo !== false) {
      fail('already-exists', 'Ya existe una necesidad con ese día, horario y puesto.');
    }
  }

  const cantidad = Number(cantidadNecesaria);
  if (necesidadId && necesidadId === generatedId) {
    const assignments = await db.collection('programacionPersonal').where('necesidadId', '==', necesidadId).get();
    if (assignments.size > cantidad) {
      fail('failed-precondition', `Ya hay ${assignments.size} personas asignadas. Quita asignaciones antes de reducir la cantidad.`);
    }
  }

  const now = Timestamp.now();
  const minutos = Number(horario.minutosDuracion || datosDuracionHorario(horario.horaInicio, horario.horaFin).minutosDuracion);
  const tarifa = Number(puesto.tarifaHora || 0);
  const costoEstimado = Math.round(((minutos / 60) * tarifa * cantidad) * 100) / 100;

  // If an edited record changes day, schedule or job, retire the old identity and create the new one.
  if (sourceRef && necesidadId !== generatedId) {
    await sourceRef.set({ activo: false, actualizadoEn: now, actualizadoPor: actor.id }, { merge: true });
  }

  const targetRef = db.doc(`necesidadesPersonal/${generatedId}`);
  const targetOld = await targetRef.get();
  await targetRef.set({
    propiedadId,
    propiedadNombre: propertySnap.nombre || propiedadId,
    fecha,
    horarioId,
    horarioNombre: horario.nombre || '',
    horaInicio: horario.horaInicio,
    horaFin: horario.horaFin,
    minutosDuracion: minutos,
    cruzaDia: horario.cruzaDia === true,
    puestoId,
    puestoNombre: puesto.nombre || '',
    tarifaHora: tarifa,
    cantidadNecesaria: cantidad,
    costoEstimado,
    observaciones: observaciones.trim(),
    activo: true,
    actualizadoEn: now,
    actualizadoPor: actor.id,
    ...(targetOld.exists ? {} : { creadoEn: now, creadoPor: actor.id }),
  }, { merge: true });

  return { necesidadId: targetRef.id };
});

export const planeacionEliminarNecesidad = endpoint(async (req) => {
  const actor = await actorConPermiso(
    req.auth.uid,
    PERMISOS.PLANEACION_PERSONAL,
    'Esta cuenta no puede modificar la planeación de personal.'
  );
  const necesidadId = String(req.data?.necesidadId || '').trim();
  if (!idValido(necesidadId)) fail('invalid-argument', 'Necesidad inválida.');
  const ref = db.doc(`necesidadesPersonal/${necesidadId}`);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  await autorizarPropiedad(actor, snap.data().propiedadId);

  const assignments = await db.collection('programacionPersonal').where('necesidadId', '==', necesidadId).get();
  const batch = db.batch();
  batch.set(ref, { activo: false, actualizadoEn: Timestamp.now(), actualizadoPor: actor.id }, { merge: true });
  assignments.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  await batch.commit();
  return { ok: true };
});

export const planeacionAsignarEventual = endpoint(async (req) => {
  const actor = await actorConPermiso(
    req.auth.uid,
    PERMISOS.PLANEACION_PERSONAL,
    'Esta cuenta no puede asignar Eventuales.'
  );
  const necesidadId = String(req.data?.necesidadId || '').trim();
  const empleadoId = String(req.data?.empleadoId || '').trim();
  if (!idValido(necesidadId) || !idValido(empleadoId)) fail('invalid-argument', 'Necesidad o empleado inválido.');

  const [needSnap, personSnap] = await Promise.all([
    db.doc(`necesidadesPersonal/${necesidadId}`).get(),
    db.doc(`asistenciaPersonal/${empleadoId}`).get(),
  ]);
  if (!needSnap.exists || needSnap.data()?.activo === false) fail('not-found', 'La necesidad ya no está disponible.');
  if (!personSnap.exists || personSnap.data()?.activo === false || personSnap.data()?.tipo !== 'eventual') {
    fail('failed-precondition', 'El Eventual no existe o está inactivo.');
  }

  const need = needSnap.data();
  const person = personSnap.data();
  await autorizarPropiedad(actor, need.propiedadId);
  const props = Array.isArray(person.propiedadesPermitidas) && person.propiedadesPermitidas.length
    ? person.propiedadesPermitidas
    : person.propiedadId ? [person.propiedadId] : [];
  if (!props.includes(need.propiedadId)) fail('failed-precondition', 'El Eventual no está asignado a esta propiedad.');
  if (!person.puestoId || person.puestoId !== need.puestoId) fail('failed-precondition', 'El Eventual debe tener el mismo puesto de la necesidad.');

  const assignmentId = `asg_${hash(`${necesidadId}\0${empleadoId}`)}`;
  const assignmentRef = db.doc(`programacionPersonal/${assignmentId}`);
  const existing = await assignmentRef.get();
  if (existing.exists) return { asignacionId: assignmentId, yaExistia: true };

  const currentAssignments = await db.collection('programacionPersonal').where('necesidadId', '==', necesidadId).get();
  if (currentAssignments.size >= Number(need.cantidadNecesaria || 0)) {
    fail('failed-precondition', 'La necesidad ya tiene todas las personas requeridas.');
  }

  const now = Timestamp.now();
  await assignmentRef.set({
    necesidadId,
    propiedadId: need.propiedadId,
    propiedadNombre: need.propiedadNombre || '',
    fecha: need.fecha,
    horarioId: need.horarioId,
    horarioNombre: need.horarioNombre || '',
    horaInicio: need.horaInicio,
    horaFin: need.horaFin,
    puestoId: need.puestoId,
    puestoNombre: need.puestoNombre || '',
    empleadoId,
    empleadoNombre: person.nombre || '',
    tarifaHoraPlanificada: person.tarifaPersonalizada !== null && person.tarifaPersonalizada !== ''
      && Number.isFinite(Number(person.tarifaPersonalizada)) && Number(person.tarifaPersonalizada) >= 0
      ? Number(person.tarifaPersonalizada)
      : Number(need.tarifaHora || 0),
    costoEstimado: Math.round(((Number(need.minutosDuracion || 0) / 60)
      * (person.tarifaPersonalizada !== null && person.tarifaPersonalizada !== ''
        && Number.isFinite(Number(person.tarifaPersonalizada)) && Number(person.tarifaPersonalizada) >= 0
        ? Number(person.tarifaPersonalizada)
        : Number(need.tarifaHora || 0))) * 100) / 100,
    estado: 'programado',
    activo: true,
    asignadoEn: now,
    asignadoPor: actor.id,
  });
  return { asignacionId: assignmentId };
});

export const planeacionQuitarAsignacion = endpoint(async (req) => {
  const actor = await actorConPermiso(
    req.auth.uid,
    PERMISOS.PLANEACION_PERSONAL,
    'Esta cuenta no puede modificar asignaciones.'
  );
  const asignacionId = String(req.data?.asignacionId || '').trim();
  if (!idValido(asignacionId)) fail('invalid-argument', 'Asignación inválida.');
  const ref = db.doc(`programacionPersonal/${asignacionId}`);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  await autorizarPropiedad(actor, snap.data().propiedadId);
  await ref.delete();
  return { ok: true };
});

async function copiarNecesidades({ actor, propiedadId, origenInicio, origenFin, destinoInicio }) {
  await autorizarPropiedad(actor, propiedadId);
  const source = await db.collection('necesidadesPersonal')
    .where('propiedadId', '==', propiedadId)
    .where('fecha', '>=', origenInicio)
    .where('fecha', '<=', origenFin)
    .get();

  let creadas = 0;
  let omitidas = 0;
  const now = Timestamp.now();
  const batch = db.batch();

  for (const sourceDoc of source.docs) {
    const item = sourceDoc.data();
    if (item.activo === false) continue;
    const offsetMs = new Date(`${item.fecha}T12:00:00Z`).getTime() - new Date(`${origenInicio}T12:00:00Z`).getTime();
    const offsetDays = Math.round(offsetMs / 86400000);
    const fechaDestino = sumarDiasIso(destinoInicio, offsetDays);
    const targetId = `nec_${hash(`${propiedadId}\0${fechaDestino}\0${item.horarioId}\0${item.puestoId}`)}`;
    const targetRef = db.doc(`necesidadesPersonal/${targetId}`);
    const target = await targetRef.get();
    if (target.exists && target.data()?.activo !== false) {
      omitidas += 1;
      continue;
    }
    batch.set(targetRef, {
      ...item,
      fecha: fechaDestino,
      activo: true,
      creadoEn: now,
      creadoPor: actor.id,
      actualizadoEn: now,
      actualizadoPor: actor.id,
    }, { merge: false });
    creadas += 1;
  }

  if (creadas) await batch.commit();
  return { creadas, omitidas };
}

export const planeacionCopiarDia = endpoint(async (req) => {
  const actor = await actorConPermiso(req.auth.uid, PERMISOS.PLANEACION_PERSONAL, 'Esta cuenta no puede copiar planeación.');
  const propiedadId = String(req.data?.propiedadId || '').trim();
  const fechaOrigen = String(req.data?.fechaOrigen || '').trim();
  const fechaDestino = String(req.data?.fechaDestino || '').trim();
  if (!fechaIsoValida(fechaOrigen) || !fechaIsoValida(fechaDestino)) fail('invalid-argument', 'Fechas inválidas.');
  return copiarNecesidades({ actor, propiedadId, origenInicio: fechaOrigen, origenFin: fechaOrigen, destinoInicio: fechaDestino });
});

export const planeacionCopiarSemana = endpoint(async (req) => {
  const actor = await actorConPermiso(req.auth.uid, PERMISOS.PLANEACION_PERSONAL, 'Esta cuenta no puede copiar planeación.');
  const propiedadId = String(req.data?.propiedadId || '').trim();
  const semanaOrigen = String(req.data?.semanaOrigen || '').trim();
  const semanaDestino = String(req.data?.semanaDestino || '').trim();
  if (!fechaIsoValida(semanaOrigen) || !fechaIsoValida(semanaDestino)) fail('invalid-argument', 'Semanas inválidas.');
  return copiarNecesidades({
    actor,
    propiedadId,
    origenInicio: semanaOrigen,
    origenFin: sumarDiasIso(semanaOrigen, 6),
    destinoInicio: semanaDestino,
  });
});

export const asistenciaGuardarPerfilUsuario = endpoint(async (req) => {
  await administrador(req.auth.uid);
  const { uid, nombre, correo, perfilAcceso, propiedadesPermitidas, activo } = req.data || {};
  if (!idValido(uid) || typeof nombre !== 'string' || !nombre.trim() || nombre.length > 160
    || typeof correo !== 'string' || correo.length > 254 || typeof activo !== 'boolean') {
    fail('invalid-argument', 'Completa UID, nombre, correo y estado.');
  }
  let access;
  try { access = expandirPerfilAcceso(perfilAcceso); } catch (e) { fail('invalid-argument', e.message); }
  if (req.auth.uid === uid && (!activo || access.rol !== 'administrador')) {
    fail('failed-precondition', 'No puedes desactivar ni quitar permisos a tu propia cuenta administradora.');
  }
  let cuenta;
  try { cuenta = await getAuth().getUser(uid); }
  catch (e) { if (e.code === 'auth/user-not-found') fail('not-found', 'Primero crea la cuenta en Authentication.'); throw e; }
  if (String(cuenta.email || '').toLowerCase() !== correo.trim().toLowerCase()) {
    fail('failed-precondition', 'El correo debe coincidir con el de Authentication. Este formulario no cambia el correo de inicio de sesion.');
  }
  const permisos = access.rol === 'administrador' ? ['*'] :
    Array.isArray(propiedadesPermitidas) ? [...new Set(propiedadesPermitidas)] : [];
  if (!permisos.length || permisos.length > 100 || permisos.some((id) => id !== '*' && !idValido(id))
    || (permisos.includes('*') && permisos.length !== 1)) fail('invalid-argument', 'Selecciona propiedades validas.');
  const reference = db.doc(`usuarios/${uid}`);
  const audit = db.collection('auditoria').doc();
  await db.runTransaction(async (tx) => {
    const [caller, old, config, ...properties] = await Promise.all([
      tx.get(db.doc(`usuarios/${req.auth.uid}`)), tx.get(reference), tx.get(db.doc('configuracionAsistencia/mexico')),
      ...permisos.filter((id) => id !== '*').map((id) => tx.get(db.doc(`propiedades/${id}`))),
    ]);
    if (caller.data()?.rol !== 'administrador' || caller.data()?.activo !== true) fail('permission-denied', 'Tus permisos cambiaron.');
    if (properties.some((p) => !p.exists || p.data().activo !== true)) fail('failed-precondition', 'Una propiedad no existe o esta inactiva.');
    if (['asistencia', 'nominas'].includes(access.rol) && (permisos.length !== 1 || permisos[0] !== config.data()?.propiedadId)) {
      fail('failed-precondition', access.rol === 'nominas'
        ? 'Nóminas debe tener solamente la propiedad México configurada.'
        : 'Seguridad México debe tener solamente la propiedad México configurada.');
    }
    const now = Timestamp.now();
    const values = { nombre: nombre.trim(), correo: cuenta.email, ...access, perfilAcceso,
      propiedadesPermitidas: permisos, propiedadId: permisos.includes('*') ? 'todas' : permisos[0],
      activo, actualizadoEn: now, actualizadoPor: req.auth.uid };
    tx.set(reference, { ...values, ...(old.exists ? {} : { creadoEn: now, creadoPor: req.auth.uid }) }, { merge: true });
    tx.create(audit, { accion: 'actualizar_perfil', usuarioId: uid, por: req.auth.uid, creadaEn: now,
      anterior: old.exists ? { rol: old.data().rol || '', propiedadesPermitidas: old.data().propiedadesPermitidas || [], modulosPermitidos: old.data().modulosPermitidos || [] } : null,
      nuevo: { rol: access.rol, propiedadesPermitidas: permisos, modulosPermitidos: access.modulosPermitidos } });
  });
  return { ok: true, uid };
});

export const asistenciaListarPersonal = endpoint(async (req) => {
  const actor = await perfil(req.auth.uid);
  const tipo = String(req.data?.tipo || '').trim();
  const propiedadId = String(req.data?.propiedadId || '').trim();
  const permisoTipo = tipo === 'eventual'
    ? PERMISOS.REPORTES_EVENTUALES
    : tipo === 'practicante'
      ? PERMISOS.REPORTES_PRACTICANTES
      : tipo === 'personal_mexico'
        ? PERMISOS.REPORTES_MEXICO
        : '';
  const puedeLeer = actor.rol === 'administrador'
    || tienePermiso(actor, PERMISOS.ADMINISTRAR_PERSONAL)
    || (permisoTipo ? tienePermiso(actor, permisoTipo) : puedeConsultarReportes(actor));

  if (!puedeLeer) fail('permission-denied', 'No tienes permiso para consultar este personal.');
  if (tipo && !['eventual', 'practicante', 'personal_mexico'].includes(tipo)) {
    fail('invalid-argument', 'Tipo de personal no permitido.');
  }
  if (propiedadId && (!idValido(propiedadId) || !puedeVerPropiedad(actor, propiedadId))) {
    fail('permission-denied', 'No tienes acceso a esa propiedad.');
  }

  // Consultas acotadas: evitamos descargar hasta 1500 documentos para filtrarlos
  // completamente en memoria. El segundo query conserva compatibilidad con fichas
  // antiguas que solo tengan propiedadId y no propiedadesPermitidas.
  let primary = db.collection('asistenciaPersonal');
  if (tipo) primary = primary.where('tipo', '==', tipo);
  if (propiedadId) primary = primary.where('propiedadesPermitidas', 'array-contains', propiedadId);
  primary = primary.orderBy('nombre').limit(600);

  const requests = [primary.get()];

  if (propiedadId) {
    let legacy = db.collection('asistenciaPersonal').where('propiedadId', '==', propiedadId);
    if (tipo) legacy = legacy.where('tipo', '==', tipo);
    requests.push(legacy.orderBy('nombre').limit(250).get());
  }

  const snapshots = await Promise.all(requests);
  const merged = new Map();

  for (const snap of snapshots) {
    for (const document of snap.docs) {
      merged.set(document.id, { id: document.id, ...document.data() });
    }
  }

  const rows = [...merged.values()]
    .filter((item) => {
      const propiedades = Array.isArray(item.propiedadesPermitidas) && item.propiedadesPermitidas.length
        ? item.propiedadesPermitidas
        : item.propiedadId ? [item.propiedadId] : [];
      const visible = actor.rol === 'administrador' || propiedades.some((id) => puedeVerPropiedad(actor, id));
      return visible && (!propiedadId || propiedades.includes(propiedadId));
    })
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));

  return { rows };
});

export const asistenciaGuardarPersonal = endpoint(async (req) => {
  const actor = await administradorOPersonal(req.auth.uid);
  const { empleadoId = '' } = req.data || {};
  const tipo = String(req.data?.tipo || '').trim();

  if (!['eventual', 'practicante', 'personal_mexico'].includes(tipo)) {
    fail('invalid-argument', 'Tipo de personal no permitido.');
  }
  if (actor.rol === 'rh' && !['eventual', 'practicante'].includes(tipo)) {
    fail('permission-denied', 'RH solo puede administrar eventuales y practicantes.');
  }

  let oldSnap = null;
  if (empleadoId) {
    if (!idValido(empleadoId)) fail('invalid-argument', 'Registro de personal invalido.');
    oldSnap = await db.doc(`asistenciaPersonal/${empleadoId}`).get();
    if (!oldSnap.exists) fail('not-found', 'La persona ya no existe. Actualiza.');
    if (oldSnap.data().tipo !== tipo) fail('failed-precondition', 'No se puede cambiar el tipo de personal.');
  }

  let propiedades;
  let propiedadPrincipal;
  let clave;
  let pinCredential = null;

  if (tipo === 'personal_mexico') {
    const propiedadId = String(req.data?.propiedadId || '').trim();
    if (!idValido(propiedadId) || !puedeVerPropiedad(actor, propiedadId)) {
      fail('permission-denied', 'No tienes acceso a esta propiedad.');
    }
    const mexicoConfig = await db.doc('configuracionAsistencia/mexico').get();
    if (mexicoConfig.data()?.propiedadId !== propiedadId) {
      fail('failed-precondition', 'El personal Mexico solo puede pertenecer a la propiedad Mexico.');
    }

    propiedades = [propiedadId];
    propiedadPrincipal = propiedadId;
    clave = oldSnap?.data()?.clave || normalizarClave(req.data?.clave);

    if (!/^[A-Z0-9_-]{1,32}$/.test(clave)) {
      fail('invalid-argument', 'Captura una clave valida para personal Mexico.');
    }

    const rawPin = typeof req.data?.pin === 'string' ? req.data.pin.trim() : '';
    if (!empleadoId && !rawPin) {
      fail('invalid-argument', 'Captura un PIN de 4 digitos para el nuevo empleado.');
    }
    if (rawPin) {
      let pin;
      try { pin = validarPinMexico(rawPin); }
      catch (e) { fail('invalid-argument', e.message); }
      pinCredential = crearCredencialPin(pin);
    }
  } else {
    propiedades = propiedadesPermitidasValidas(req.data?.propiedadesPermitidas);
    if (!propiedades || propiedades.includes('*')) {
      fail('invalid-argument', 'Selecciona una o varias propiedades validas.');
    }
    for (const propiedadId of propiedades) {
      if (!puedeVerPropiedad(actor, propiedadId)) {
        fail('permission-denied', 'No tienes acceso a una de las propiedades seleccionadas.');
      }
    }
    await validarPropiedadesActivas(propiedades);

    const mexicoConfig = await db.doc('configuracionAsistencia/mexico').get();
    if (propiedades.includes(mexicoConfig.data()?.propiedadId)) {
      fail('failed-precondition', 'Mexico no se asigna a eventuales ni practicantes.');
    }

    propiedadPrincipal = propiedades[0];
    clave = oldSnap?.data()?.clave || codigoPersonal(tipo);
  }

  let fields;
  try {
    fields = validarPersonal({ ...req.data, clave, propiedadesPermitidas: propiedades });
  } catch (e) {
    fail('invalid-argument', e.message);
  }

  let enriched = { ...fields };
  if (fields.tipo === 'eventual') {
    if (!idValido(fields.puestoId)) fail('invalid-argument', 'Selecciona un puesto valido.');
    const puesto = await db.doc(`puestos/${fields.puestoId}`).get();
    if (!puesto.exists || puesto.data().activo !== true) {
      fail('failed-precondition', 'El puesto no existe o esta inactivo.');
    }
    const data = puesto.data();
    enriched = {
      ...enriched,
      puestoNombre: data.nombre,
      tarifaBase: Number(data.tarifaHora || 0),
    };
  }

  const ref = empleadoId
    ? db.doc(`asistenciaPersonal/${empleadoId}`)
    : db.collection('asistenciaPersonal').doc();

  const claveRef = db.doc(`asistenciaClaves/${clave}`);
  const credRef = db.doc(`asistenciaCredenciales/${ref.id}`);

  await db.runTransaction(async (tx) => {
    const [old, keyOld, oldCredential] = await Promise.all([
      tx.get(ref),
      tx.get(claveRef),
      tx.get(credRef),
    ]);

    if (!empleadoId && old.exists) fail('already-exists', 'El registro ya existe.');
    if (keyOld.exists && keyOld.data()?.empleadoId !== ref.id) {
      fail('already-exists', 'El identificador ya esta asignado. Reintenta el alta.');
    }

    if (tipo === 'personal_mexico' && !pinCredential && !oldCredential.exists) {
      fail('failed-precondition', 'Este empleado necesita un PIN de registro.');
    }

    const now = Timestamp.now();

    tx.set(ref, {
      ...enriched,
      propiedadesPermitidas: propiedades,
      propiedadId: propiedadPrincipal,
      ...(tipo === 'personal_mexico'
        ? { pinConfigurado: Boolean(pinCredential || oldCredential.exists) }
        : {}),
      actualizadoEn: now,
      actualizadoPor: req.auth.uid,
      ...(old.exists ? {} : { creadoEn: now, creadoPor: req.auth.uid }),
    }, { merge: true });

    tx.set(claveRef, {
      empleadoId: ref.id,
      clave,
      tipo,
      actualizadoEn: now,
      ...(keyOld.exists ? {} : { creadoEn: now }),
    }, { merge: true });

    if (pinCredential) {
      tx.set(credRef, {
        ...pinCredential,
        actualizadoEn: now,
        actualizadoPor: req.auth.uid,
        ...(oldCredential.exists ? {} : { creadoEn: now, creadoPor: req.auth.uid }),
      }, { merge: true });
    }
  });

  return {
    empleadoId: ref.id,
    pinActualizado: Boolean(pinCredential),
  };
});

export const asistenciaConsultarEmpleado = endpoint(async (req) => {
  const p = await perfil(req.auth.uid);
  if (!puedeRegistrarAsistencia(p)) {
    fail('permission-denied', 'Tu perfil no puede registrar asistencia.');
  }

  const propiedad = await autorizarPropiedad(p, req.data?.propiedadId);
  const clave = normalizarClave(req.data?.clave);

  if (!/^[A-Z0-9_-]{1,64}$/.test(clave)) {
    fail('invalid-argument', 'Escribe o escanea un codigo valido.');
  }

  let empleadoId = '';
  const keySnap = await db.doc(`asistenciaClaves/${clave}`).get();
  if (keySnap.exists) empleadoId = keySnap.data()?.empleadoId || '';

  let emp = empleadoId
    ? await db.doc(`asistenciaPersonal/${empleadoId}`).get()
    : null;

  if (!emp?.exists) {
    const legacy = await db.doc(`asistenciaPersonal/${personalId(propiedad.id, clave)}`).get();
    if (legacy.exists) {
      emp = legacy;
      empleadoId = legacy.id;
    }
  }

  if (!emp?.exists) {
    const matches = await db
      .collection('asistenciaPersonal')
      .where('clave', '==', clave)
      .limit(10)
      .get();

    const match = matches.docs.find((d) =>
      personalPuedeOperarEnPropiedad(d.data(), propiedad.id)
    );

    if (match) {
      emp = match;
      empleadoId = match.id;
    }
  }

  if (!emp?.exists) {
    fail('not-found', 'No se encontro esa persona en esta propiedad.');
  }

  const e = emp.data();

  if (!personalPuedeOperarEnPropiedad(e, propiedad.id)) {
    fail('permission-denied', 'La persona no esta asignada a esta propiedad.');
  }

  let validacionPin = '';
  const requierePin = e.tipo === 'personal_mexico';

  if (requierePin) {
    let pin;
    try { pin = validarPinMexico(req.data?.pin); }
    catch {
      fail('permission-denied', 'PIN incorrecto.');
    }

    const credential = await db.doc(`asistenciaCredenciales/${empleadoId}`).get();
    if (!credential.exists) {
      fail('failed-precondition', 'Este empleado no tiene PIN configurado. Solicita al administrador establecerlo.');
    }

    if (!verificarCredencialPin(pin, credential.data())) {
      fail('permission-denied', 'PIN incorrecto.');
    }

    validacionPin = crearTokenPin();
    await pinValidationRef(req.auth.uid, empleadoId).set({
      tokenHash: hash(validacionPin),
      operadorId: req.auth.uid,
      empleadoId,
      propiedadId: propiedad.id,
      venceEn: Timestamp.fromMillis(Date.now() + PIN_TOKEN_MINUTOS * 60 * 1000),
      actualizadoEn: Timestamp.now(),
    });
  }

  const stateRef = db.doc(`asistenciaEstado/${empleadoId}`);
  let state = await stateRef.get();
  let openId = state.data()?.jornadaAbiertaId || null;
  let turno = null;
  let turnoPendiente = null;

  if (openId) {
    const limites = await limitesAsistencia();
    const revision = await revisarJornadaVencida({
      empleadoId,
      jornadaId: openId,
      tipoPersonal: e.tipo,
      limites,
    });

    if (revision.accion === 'cerrada_sin_salida' || revision.accion === 'estado_reparado') {
      state = await stateRef.get();
      openId = state.data()?.jornadaAbiertaId || null;
    } else if (revision.accion === 'salida_pendiente') {
      turno = revision.jornada;
      turnoPendiente = datosTurnoPendiente(
        openId,
        turno,
        revision.horas,
        revision.limite
      );
    }
  }

  if (openId && !turno) {
    const turnoSnap = await db.doc(`asistenciaJornadas/${openId}`).get();
    turno = turnoSnap.exists ? turnoSnap.data() : null;

    if (!turno || !esJornadaAbiertaOperativa(turno)) {
      await stateRef.set({ jornadaAbiertaId: null, actualizadoEn: Timestamp.now() }, { merge: true });
      openId = null;
      turno = null;
    }
  }

  if (openId && turno && ['eventual', 'practicante'].includes(e.tipo)) {
    const limites = await limitesAsistencia();
    const horas = horasTranscurridasJornada(turno, Date.now());
    const limite = limitePorTipo(e.tipo, limites);
    if (turno.estado === 'salida_pendiente' || (horas !== null && limite !== null && horas >= limite)) {
      turnoPendiente = datosTurnoPendiente(openId, turno, horas, limite);
    }
  }

  if (openId && turno && !turnoPendiente && turno.propiedadId && turno.propiedadId !== propiedad.id) {
    fail(
      'failed-precondition',
      `La persona tiene una jornada abierta en ${turno.propiedadNombre || 'otra propiedad'}. Registra la salida en esa propiedad.`
    );
  }

  let turnoReciente = null;
  if (!openId && ['eventual', 'practicante'].includes(e.tipo)) {
    const estadoActual = state.data() || {};
    const reciente = salidaRecienteDesdeEstado(
      estadoActual,
      propiedad.id,
      Timestamp.now().toMillis()
    );

    if (reciente) {
      const recienteSnap = await db.doc(`asistenciaJornadas/${reciente.jornadaId}`).get();
      const row = recienteSnap.exists ? recienteSnap.data() : null;
      const salidaMs = row?.salidaEn?.toMillis?.();

      if (
        row
        && row.empleadoId === empleadoId
        && row.propiedadId === propiedad.id
        && row.estado === 'completa'
        && Number.isFinite(salidaMs)
        && salidaMs === reciente.salidaMs
      ) {
        turnoReciente = {
          id: reciente.jornadaId,
          entradaEn: encodeTime(row.entradaEn),
          salidaEn: encodeTime(row.salidaEn),
          minutos: Number.isFinite(Number(row.minutos)) ? Number(row.minutos) : null,
          minutosDesdeSalida: reciente.minutosDesdeSalida,
          ventanaMinutos: reciente.ventanaMinutos,
          propiedadId: row.propiedadId,
          propiedadNombre: row.propiedadNombre || propiedad.nombre,
        };
      }
    }
  }

  if (!e.activo && !openId) {
    fail('failed-precondition', 'La persona esta inactiva.');
  }

  return {
    empleado: {
      id: empleadoId,
      clave: e.clave,
      nombre: e.nombre,
      tipo: e.tipo,
      area: e.area || '',
      puestoNombre: e.puestoNombre || '',
      activo: e.activo,
    },
    propiedad: {
      id: propiedad.id,
      nombre: propiedad.nombre,
      codigo: propiedad.codigo || '',
      asistencia: propiedad.asistencia,
    },
    jornadaAbierta: openId
      ? {
          id: openId,
          entradaEn: encodeTime(turno?.entradaEn),
          entradaSinFecha: !turno?.entradaEn,
          propiedadId: turno?.propiedadId || '',
          propiedadNombre: turno?.propiedadNombre || '',
          estado: turno?.estado || 'abierta',
        }
      : null,
    turnoPendiente,
    turnoReciente,
    movimiento: turnoPendiente
      ? 'resolver_pendiente'
      : openId
        ? 'salida'
        : turnoReciente
          ? 'confirmar_turno_reciente'
          : 'entrada',
    requierePin,
    validacionPin,
  };
});

export const asistenciaRegistrarMovimiento = endpoint(async (req) => {
  const uid = req.auth.uid;
  const {
    solicitudId,
    empleadoId,
    propiedadId,
    tipo,
    jornadaEsperadaId = null,
    fotoPath = '',
    capturadaEnCliente = null,
    validacionPin = '',
    confirmarNuevoTurnoReciente = false,
    jornadaRecienteId = null,
  } = req.data || {};

  if (
    ![solicitudId, empleadoId, propiedadId].every(idValido)
    || !['entrada', 'salida'].includes(tipo)
  ) {
    fail('invalid-argument', 'Registro incompleto. Vuelve a consultar al empleado.');
  }

  const p = await perfil(uid);
  if (!puedeRegistrarAsistencia(p)) {
    fail('permission-denied', 'Este perfil no puede registrar asistencia.');
  }

  const property = await autorizarPropiedad(p, propiedadId);
  const movRef = db.doc(`asistenciaMovimientos/${solicitudId}`);
  const expectedPath = `asistencia/${propiedadId}/${empleadoId}/${uid}/${solicitudId}.jpg`;

  function validateExisting(snap) {
    const m = snap.data();
    if (
      m.registradoPor !== uid
      || m.empleadoId !== empleadoId
      || m.propiedadId !== propiedadId
      || m.tipo !== tipo
    ) {
      fail('already-exists', 'El identificador pertenece a otra operacion.');
    }
    return {
      id: snap.id,
      jornadaId: m.jornadaId,
      tipo: m.tipo,
      empleadoNombre: m.empleadoNombre,
      registradaEn: encodeTime(m.registradaEn),
      repetido: true,
    };
  }

  const prior = await movRef.get();
  if (prior.exists) return validateExisting(prior);

  const requiereFoto = tipoRequiereFoto(property, tipo);
  if (requiereFoto && fotoPath !== expectedPath) {
    fail('failed-precondition', 'Toma la fotografia para confirmar.');
  }

  if (fotoPath) {
    if (fotoPath !== expectedPath) {
      fail('invalid-argument', 'La fotografia no pertenece a este registro.');
    }

    const file = getStorage().bucket().file(fotoPath);
    const [exists] = await file.exists();

    if (!exists) {
      fail('failed-precondition', 'La fotografia no termino de subir. Reintenta.');
    }

    const [metadata] = await file.getMetadata();
    const [header] = await file.download({ start: 0, end: 2 });

    if (
      header.length !== 3
      || header[0] !== 0xff
      || header[1] !== 0xd8
      || header[2] !== 0xff
    ) {
      fail('failed-precondition', 'El archivo no es una fotografia JPEG valida.');
    }

    if (
      Number(metadata.size) <= 0
      || Number(metadata.size) > MAX_FOTO_BYTES
      || metadata.contentType !== 'image/jpeg'
      || metadata.metadata?.registradoPor !== uid
      || metadata.metadata?.empleadoId !== empleadoId
      || metadata.metadata?.solicitudId !== solicitudId
    ) {
      fail('failed-precondition', 'La evidencia fotografica no es valida.');
    }
  }

  const validationRef = pinValidationRef(uid, empleadoId);

  return db.runTransaction(async (tx) => {
    const [
      freshProfile,
      ps,
      empSnap,
      stateSnap,
      existing,
      mexicoConfig,
      pinValidationSnap,
    ] = await Promise.all([
      tx.get(db.doc(`usuarios/${uid}`)),
      tx.get(db.doc(`propiedades/${propiedadId}`)),
      tx.get(db.doc(`asistenciaPersonal/${empleadoId}`)),
      tx.get(db.doc(`asistenciaEstado/${empleadoId}`)),
      tx.get(movRef),
      tx.get(db.doc('configuracionAsistencia/mexico')),
      tx.get(validationRef),
    ]);

    const fresh = freshProfile.data();

    if (!puedeRegistrarAsistencia(fresh) || !puedeVerPropiedad(fresh, propiedadId)) {
      fail('permission-denied', 'Tus permisos cambiaron.');
    }

    if (!ps.exists || ps.data().activo !== true) {
      fail('failed-precondition', 'La propiedad esta inactiva.');
    }

    const esMexico = mexicoConfig.data()?.propiedadId === propiedadId;

    if (esMexico && !fotoPath) {
      fail('failed-precondition', 'La fotografia es obligatoria en Mexico.');
    }

    if (fresh.rol === 'asistencia' && !esMexico) {
      fail('permission-denied', 'Cuenta restringida a Mexico.');
    }

    if (existing.exists) return validateExisting(existing);

    const emp = empSnap.data();

    if (!empSnap.exists || !personalPuedeOperarEnPropiedad(emp, propiedadId)) {
      fail('not-found', 'Empleado no encontrado en esta propiedad.');
    }

    if (esMexico || emp.tipo === 'personal_mexico') {
      const pinData = pinValidationSnap.data();
      const tokenValido =
        pinValidationSnap.exists
        && typeof validacionPin === 'string'
        && /^[a-f0-9]{48}$/.test(validacionPin)
        && pinData?.operadorId === uid
        && pinData?.empleadoId === empleadoId
        && pinData?.propiedadId === propiedadId
        && pinData?.tokenHash === hash(validacionPin)
        && Number(pinData?.venceEn?.toMillis?.()) > Date.now();

      if (!tokenValido) {
        fail('permission-denied', 'Vuelve a ingresar la clave y el PIN del empleado.');
      }
    }

    const state = stateSnap.data() || {};
    const jornadaId = tipo === 'entrada' ? solicitudId : state.jornadaAbiertaId;
    const jornadaRef = jornadaId ? db.doc(`asistenciaJornadas/${jornadaId}`) : null;
    const jornadaSnap =
      tipo === 'salida' && jornadaRef ? await tx.get(jornadaRef) : null;
    const jornada = jornadaSnap?.data();
    const now = Timestamp.now();

    if (tipo === 'salida' && jornada?.propiedadId && jornada.propiedadId !== propiedadId) {
      fail('failed-precondition', 'La salida debe registrarse en la propiedad donde se abrió el turno.');
    }

    let nuevaJornadaTrasSalidaReciente = null;
    if (tipo === 'entrada' && ['eventual', 'practicante'].includes(emp.tipo)) {
      const reciente = salidaRecienteDesdeEstado(state, propiedadId, now.toMillis());
      if (reciente) {
        if (
          confirmarNuevoTurnoReciente !== true
          || jornadaRecienteId !== reciente.jornadaId
        ) {
          fail(
            'failed-precondition',
            `La ultima jornada termino hace ${reciente.minutosDesdeSalida} min. Vuelve a escanear y confirma si deseas continuarla o iniciar un turno nuevo.`
          );
        }
        nuevaJornadaTrasSalidaReciente = reciente;
      }
    }

    try {
      validarTransicion({
        tipo,
        empleado: emp,
        estado: state,
        jornada,
        jornadaEsperadaId,
        ahoraMs: now.toMillis(),
      });
    } catch (e) {
      fail('failed-precondition', e.message);
    }

    const movimiento = {
      solicitudId,
      jornadaId,
      empleadoId,
      empleadoNombre: emp.nombre,
      claveEmpleado: emp.clave,
      propiedadId,
      propiedadNombre: ps.data().nombre,
      tipo,
      registradoPor: uid,
      registradoPorNombre: fresh.nombre || '',
      registradaEn: now,
      capturadaEnCliente:
        typeof capturadaEnCliente === 'string'
        && !Number.isNaN(Date.parse(capturadaEnCliente))
          ? capturadaEnCliente.slice(0, 40)
          : null,
      fotoPath: fotoPath || null,
      fotoRequerida: esMexico,
      validacion:
        esMexico || emp.tipo === 'personal_mexico'
          ? 'pin_y_fotografia'
          : fotoPath
            ? 'evidencia_fotografica'
            : 'identificador_personal',
      nuevoTurnoTrasSalidaReciente: Boolean(nuevaJornadaTrasSalidaReciente),
      jornadaAnteriorCerradaId: nuevaJornadaTrasSalidaReciente?.jornadaId || null,
      version: 3,
    };

    tx.create(movRef, movimiento);

    if (tipo === 'entrada') {
      tx.create(jornadaRef, {
        empleadoId,
        empleadoNombre: emp.nombre,
        claveEmpleado: emp.clave,
        tipoPersonal: emp.tipo,
        puestoId: emp.tipo === 'eventual' ? (emp.puestoId || '') : '',
        puestoNombre: emp.tipo === 'eventual' ? (emp.puestoNombre || '') : '',
        area: emp.area || '',
        tarifaHoraAplicada:
          emp.tipo === 'eventual'
            ? Number(emp.tarifaPersonalizada ?? emp.tarifaBase ?? 0)
            : null,
        propiedadId,
        propiedadNombre: ps.data().nombre,
        zonaHoraria:
          ps.data().asistencia?.zonaHoraria || 'America/Mexico_City',
        fechaJornada: fechaEnZona(
          now.toDate(),
          ps.data().asistencia?.zonaHoraria
        ),
        entradaEn: now,
        salidaEn: null,
        entradaFotoPath: fotoPath || null,
        salidaFotoPath: null,
        entradaRegistradaPor: uid,
        salidaRegistradaPor: null,
        minutos: null,
        estado: 'abierta',
        nuevoTurnoTrasSalidaReciente: Boolean(nuevaJornadaTrasSalidaReciente),
        jornadaAnteriorCerradaId: nuevaJornadaTrasSalidaReciente?.jornadaId || null,
        creadaEn: now,
        actualizadoEn: now,
        origen: 'seguridad_gmr',
      });

      tx.set(db.doc(`asistenciaEstado/${empleadoId}`), {
        propiedadId,
        jornadaAbiertaId: jornadaId,
        actualizadoEn: now,
      });
    } else {
      tx.update(jornadaRef, {
        salidaEn: now,
        salidaFotoPath: fotoPath || null,
        salidaRegistradaPor: uid,
        minutos: Math.floor(
          (now.toMillis() - jornada.entradaEn.toMillis()) / 60000
        ),
        estado: 'completa',
        actualizadoEn: now,
      });

      tx.set(db.doc(`asistenciaEstado/${empleadoId}`), {
        propiedadId,
        jornadaAbiertaId: null,
        ultimaJornadaCerradaId: jornadaId,
        ultimaSalidaEn: now,
        actualizadoEn: now,
      });
    }

    if (esMexico || emp.tipo === 'personal_mexico') {
      tx.delete(validationRef);
    }

    return {
      id: solicitudId,
      jornadaId,
      tipo,
      empleadoNombre: emp.nombre,
      registradaEn: now.toDate().toISOString(),
      nuevoTurnoTrasSalidaReciente: Boolean(nuevaJornadaTrasSalidaReciente),
      repetido: false,
    };
  });
});


export const asistenciaReabrirJornadaReciente = endpoint(async (req) => {
  const uid = req.auth.uid;
  const { solicitudId, empleadoId, propiedadId, jornadaCerradaId } = req.data || {};

  if (![solicitudId, empleadoId, propiedadId, jornadaCerradaId].every(idValido)) {
    fail('invalid-argument', 'No fue posible continuar el turno. Vuelve a escanear el QR.');
  }

  const p = await perfil(uid);
  if (!puedeRegistrarAsistencia(p)) {
    fail('permission-denied', 'Tu perfil no puede registrar asistencia.');
  }

  await autorizarPropiedad(p, propiedadId);

  const movRef = db.doc(`asistenciaMovimientos/${solicitudId}`);
  const jornadaRef = db.doc(`asistenciaJornadas/${jornadaCerradaId}`);
  const stateRef = db.doc(`asistenciaEstado/${empleadoId}`);
  const empRef = db.doc(`asistenciaPersonal/${empleadoId}`);
  const auditRef = db.collection('asistenciaAuditoria').doc();

  return db.runTransaction(async (tx) => {
    const [freshProfile, propertySnap, empSnap, stateSnap, jornadaSnap, existing] = await Promise.all([
      tx.get(db.doc(`usuarios/${uid}`)),
      tx.get(db.doc(`propiedades/${propiedadId}`)),
      tx.get(empRef),
      tx.get(stateRef),
      tx.get(jornadaRef),
      tx.get(movRef),
    ]);

    const fresh = freshProfile.data();
    if (!puedeRegistrarAsistencia(fresh) || !puedeVerPropiedad(fresh, propiedadId)) {
      fail('permission-denied', 'Tus permisos cambiaron.');
    }

    if (!propertySnap.exists || propertySnap.data().activo !== true) {
      fail('failed-precondition', 'La propiedad esta inactiva.');
    }

    if (existing.exists) {
      const m = existing.data();
      if (
        m.registradoPor !== uid
        || m.empleadoId !== empleadoId
        || m.propiedadId !== propiedadId
        || m.tipo !== 'reapertura'
        || m.jornadaId !== jornadaCerradaId
      ) {
        fail('already-exists', 'El identificador pertenece a otra operacion.');
      }
      return {
        id: existing.id,
        jornadaId: jornadaCerradaId,
        tipo: 'reapertura',
        jornadaReabierta: true,
        empleadoNombre: m.empleadoNombre,
        registradaEn: encodeTime(m.registradaEn),
        repetido: true,
      };
    }

    if (!empSnap.exists) fail('not-found', 'Empleado no encontrado.');
    const emp = empSnap.data();
    if (!['eventual', 'practicante'].includes(emp.tipo)) {
      fail('failed-precondition', 'Este flujo solo aplica a eventuales y practicantes.');
    }
    if (!emp.activo || !personalPuedeOperarEnPropiedad(emp, propiedadId)) {
      fail('permission-denied', 'La persona no esta activa o no pertenece a esta propiedad.');
    }

    if (!jornadaSnap.exists) {
      fail('failed-precondition', 'La jornada anterior ya no existe. Vuelve a escanear el QR.');
    }

    const state = stateSnap.data() || {};
    const old = jornadaSnap.data();
    const now = Timestamp.now();
    const reciente = salidaRecienteDesdeEstado(state, propiedadId, now.toMillis());
    const salidaMs = old.salidaEn?.toMillis?.();

    if (state.jornadaAbiertaId) {
      fail('failed-precondition', 'La persona ya tiene una jornada abierta. Vuelve a escanear el QR.');
    }
    if (!reciente || reciente.jornadaId !== jornadaCerradaId) {
      fail('failed-precondition', 'La salida ya no esta dentro del tiempo permitido para continuar el turno.');
    }
    if (
      old.empleadoId !== empleadoId
      || old.propiedadId !== propiedadId
      || old.estado !== 'completa'
      || !Number.isFinite(salidaMs)
      || salidaMs !== reciente.salidaMs
    ) {
      fail('failed-precondition', 'La jornada cambio y ya no puede reabrirse desde esta pantalla.');
    }

    tx.create(movRef, {
      solicitudId,
      jornadaId: jornadaCerradaId,
      empleadoId,
      empleadoNombre: emp.nombre,
      claveEmpleado: emp.clave,
      propiedadId,
      propiedadNombre: propertySnap.data().nombre,
      tipo: 'reapertura',
      registradoPor: uid,
      registradoPorNombre: fresh.nombre || '',
      registradaEn: now,
      fotoPath: null,
      fotoRequerida: false,
      validacion: 'continuar_turno_tras_salida_reciente',
      version: 3,
    });

    tx.update(jornadaRef, {
      salidaEn: null,
      salidaFotoPath: null,
      salidaRegistradaPor: null,
      minutos: null,
      estado: 'abierta',
      ultimaSalidaAnuladaEn: old.salidaEn,
      ultimaSalidaAnuladaFotoPath: old.salidaFotoPath || null,
      ultimaSalidaAnuladaRegistradaPor: old.salidaRegistradaPor || null,
      reabiertaEn: now,
      reabiertaPor: uid,
      reabiertaPorNombre: fresh.nombre || '',
      actualizadoEn: now,
    });

    tx.set(stateRef, {
      propiedadId,
      jornadaAbiertaId: jornadaCerradaId,
      ultimaJornadaCerradaId: null,
      ultimaSalidaEn: null,
      actualizadoEn: now,
    });

    tx.create(auditRef, {
      jornadaId: jornadaCerradaId,
      empleadoId,
      propiedadId,
      accion: 'reabrir_jornada_salida_reciente',
      motivo: 'Seguridad confirmo que la salida reciente fue accidental y continuo el mismo turno.',
      anterior: {
        estado: old.estado,
        salidaEn: old.salidaEn,
        minutos: old.minutos ?? null,
        salidaFotoPath: old.salidaFotoPath || null,
        salidaRegistradaPor: old.salidaRegistradaPor || null,
      },
      nuevo: { estado: 'abierta', salidaEn: null, minutos: null },
      por: uid,
      porNombre: fresh.nombre || '',
      creadaEn: now,
    });

    return {
      id: solicitudId,
      jornadaId: jornadaCerradaId,
      tipo: 'reapertura',
      jornadaReabierta: true,
      empleadoNombre: emp.nombre,
      registradaEn: now.toDate().toISOString(),
      repetido: false,
    };
  });
});


export const asistenciaListarTurnosPendientes = endpoint(async (req) => {
  const p = await perfil(req.auth.uid);
  if (!puedeRegistrarAsistencia(p)) {
    fail('permission-denied', 'Tu perfil no puede consultar turnos pendientes.');
  }

  const propiedad = await autorizarPropiedad(p, req.data?.propiedadId);
  const snap = await db.collection('asistenciaJornadas')
    .where('propiedadId', '==', propiedad.id)
    .where('estado', '==', 'salida_pendiente')
    .orderBy('entradaEn', 'asc')
    .limit(50)
    .get();

  return {
    rows: snap.docs.map((docSnap) => {
      const row = docSnap.data();
      return {
        id: docSnap.id,
        empleadoId: row.empleadoId,
        empleadoNombre: row.empleadoNombre,
        claveEmpleado: row.claveEmpleado,
        tipoPersonal: row.tipoPersonal,
        puestoNombre: row.puestoNombre || '',
        entradaEn: encodeTime(row.entradaEn),
        propiedadId: row.propiedadId,
        propiedadNombre: row.propiedadNombre,
      };
    }),
  };
});

export const asistenciaResolverTurnoPendiente = endpoint(async (req) => {
  const uid = req.auth.uid;
  const {
    solicitudId,
    empleadoId,
    propiedadId,
    jornadaPendienteId,
  } = req.data || {};

  if (![solicitudId, empleadoId, propiedadId, jornadaPendienteId].every(idValido)) {
    fail('invalid-argument', 'No fue posible resolver el turno pendiente. Vuelve a escanear el QR.');
  }

  const p = await perfil(uid);
  if (!puedeRegistrarAsistencia(p)) {
    fail('permission-denied', 'Tu perfil no puede resolver turnos pendientes.');
  }

  const propiedad = await autorizarPropiedad(p, propiedadId);
  const limites = await limitesAsistencia();
  const movRef = db.doc(`asistenciaMovimientos/${solicitudId}`);
  const jornadaAnteriorRef = db.doc(`asistenciaJornadas/${jornadaPendienteId}`);
  const jornadaNuevaRef = db.doc(`asistenciaJornadas/${solicitudId}`);
  const stateRef = db.doc(`asistenciaEstado/${empleadoId}`);
  const empRef = db.doc(`asistenciaPersonal/${empleadoId}`);
  const auditRef = db.collection('asistenciaAuditoria').doc();

  return db.runTransaction(async (tx) => {
    const [freshProfile, empSnap, oldSnap, stateSnap, existing] = await Promise.all([
      tx.get(db.doc(`usuarios/${uid}`)),
      tx.get(empRef),
      tx.get(jornadaAnteriorRef),
      tx.get(stateRef),
      tx.get(movRef),
    ]);

    const fresh = freshProfile.data();
    if (!puedeRegistrarAsistencia(fresh) || !puedeVerPropiedad(fresh, propiedadId)) {
      fail('permission-denied', 'Tus permisos cambiaron.');
    }

    if (existing.exists) {
      const oldMovement = existing.data();
      return {
        id: existing.id,
        jornadaId: oldMovement.jornadaId,
        tipo: oldMovement.tipo,
        empleadoNombre: oldMovement.empleadoNombre,
        registradaEn: encodeTime(oldMovement.registradaEn),
        turnoAnteriorSinSalida: true,
        repetido: true,
      };
    }

    if (!empSnap.exists) fail('not-found', 'Empleado no encontrado.');
    const emp = empSnap.data();
    if (!['eventual', 'practicante'].includes(emp.tipo)) {
      fail('failed-precondition', 'Este flujo solo aplica a eventuales y practicantes.');
    }
    if (!personalPuedeOperarEnPropiedad(emp, propiedadId)) {
      fail('permission-denied', 'La persona no esta asignada a esta propiedad.');
    }

    if (!oldSnap.exists) fail('failed-precondition', 'El turno anterior ya no existe. Actualiza la consulta.');
    const old = oldSnap.data();
    const state = stateSnap.data() || {};
    if (state.jornadaAbiertaId !== jornadaPendienteId || old.salidaEn) {
      fail('failed-precondition', 'El turno anterior ya fue modificado. Vuelve a escanear el QR.');
    }

    const horas = horasTranscurridasJornada(old, Date.now());
    const limite = limitePorTipo(emp.tipo, limites);
    if (horas === null || limite === null || horas < limite) {
      fail('failed-precondition', 'El turno todavia no cumple el tiempo para marcarse como salida pendiente.');
    }

    const now = Timestamp.now();

    tx.update(jornadaAnteriorRef, {
      estado: 'sin_salida',
      salidaEn: null,
      minutos: null,
      motivoCierre: 'no_checo_salida',
      salidaOmitidaConfirmadaPor: uid,
      salidaOmitidaConfirmadaPorNombre: fresh.nombre || '',
      salidaOmitidaConfirmadaEn: now,
      siguienteJornadaId: solicitudId,
      actualizadoEn: now,
    });

    tx.create(jornadaNuevaRef, {
      empleadoId,
      empleadoNombre: emp.nombre,
      claveEmpleado: emp.clave,
      tipoPersonal: emp.tipo,
      puestoId: emp.tipo === 'eventual' ? (emp.puestoId || '') : '',
      puestoNombre: emp.tipo === 'eventual' ? (emp.puestoNombre || '') : '',
      area: emp.area || '',
      tarifaHoraAplicada:
        emp.tipo === 'eventual'
          ? Number(emp.tarifaPersonalizada ?? emp.tarifaBase ?? 0)
          : null,
      propiedadId,
      propiedadNombre: propiedad.nombre,
      zonaHoraria: propiedad.asistencia?.zonaHoraria || 'America/Mexico_City',
      fechaJornada: fechaEnZona(now.toDate(), propiedad.asistencia?.zonaHoraria),
      entradaEn: now,
      salidaEn: null,
      entradaFotoPath: null,
      salidaFotoPath: null,
      entradaRegistradaPor: uid,
      salidaRegistradaPor: null,
      minutos: null,
      estado: 'abierta',
      jornadaAnteriorSinSalidaId: jornadaPendienteId,
      creadaEn: now,
      actualizadoEn: now,
      origen: 'seguridad_gmr',
    });

    tx.create(movRef, {
      solicitudId,
      jornadaId: solicitudId,
      empleadoId,
      empleadoNombre: emp.nombre,
      claveEmpleado: emp.clave,
      propiedadId,
      propiedadNombre: propiedad.nombre,
      tipo: 'entrada',
      registradoPor: uid,
      registradoPorNombre: fresh.nombre || '',
      registradaEn: now,
      capturadaEnCliente: null,
      fotoPath: null,
      fotoRequerida: false,
      validacion: 'turno_anterior_sin_salida',
      jornadaAnteriorSinSalidaId: jornadaPendienteId,
      version: 3,
    });

    tx.set(stateRef, {
      propiedadId,
      jornadaAbiertaId: solicitudId,
      actualizadoEn: now,
    }, { merge: true });

    tx.create(auditRef, {
      jornadaId: jornadaPendienteId,
      empleadoId,
      propiedadId: old.propiedadId,
      accion: 'sin_salida_y_nueva_entrada',
      motivo: 'Seguridad confirmo que el turno anterior no tuvo checada de salida y registro una nueva entrada.',
      anterior: { estado: old.estado, salidaEn: old.salidaEn || null },
      nuevo: { estado: 'sin_salida', salidaEn: null, nuevaJornadaId: solicitudId },
      por: uid,
      porNombre: fresh.nombre || '',
      creadaEn: now,
    });

    return {
      id: solicitudId,
      jornadaId: solicitudId,
      tipo: 'entrada',
      empleadoNombre: emp.nombre,
      registradaEn: now.toDate().toISOString(),
      turnoAnteriorSinSalida: true,
      repetido: false,
    };
  });
});


export const asistenciaResolverTurnoAdministrativo = endpoint(async (req) => {
  const p = await administradorORHResolverEventuales(req.auth.uid);
  const { jornadaId, accion, salidaIso, motivo } = req.data || {};

  if (!idValido(jornadaId)) {
    fail('invalid-argument', 'Selecciona un turno válido.');
  }
  if (!['corregir_salida', 'sin_salida'].includes(accion)) {
    fail('invalid-argument', 'Selecciona cómo resolver el turno.');
  }
  if (typeof motivo !== 'string' || motivo.trim().length < 10 || motivo.length > 1000) {
    fail('invalid-argument', 'Describe el motivo de la corrección con al menos 10 caracteres.');
  }

  const ref = db.doc(`asistenciaJornadas/${jornadaId}`);
  const now = Timestamp.now();
  const limites = await limitesAsistencia();
  const auditRef = db.collection('asistenciaAuditoria').doc();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'El turno ya no existe. Actualiza el reporte.');

    const old = snap.data();
    if (old.tipoPersonal !== 'eventual') {
      fail('failed-precondition', 'Este permiso de RH solo aplica a turnos de Eventuales.');
    }
    if (p.rol !== 'administrador' && !puedeVerPropiedad(p, old.propiedadId)) {
      fail('permission-denied', 'No tienes permiso para esta propiedad.');
    }
    if (old.salidaEn || !['abierta', 'salida_pendiente', 'sin_salida'].includes(old.estado)) {
      fail('failed-precondition', 'El turno ya no admite corrección. Actualiza el reporte.');
    }

    const stateRef = db.doc(`asistenciaEstado/${old.empleadoId}`);
    const stateSnap = await tx.get(stateRef);
    const state = stateSnap.exists ? (stateSnap.data() || {}) : {};

    // Un turno aún abierto solo puede resolverlo RH cuando ya alcanzó el umbral operativo.
    if (old.estado === 'abierta') {
      const horas = horasTranscurridasJornada(old, now.toMillis());
      if (horas === null || horas < limites.eventual) {
        fail('failed-precondition', `El turno todavía no cumple ${limites.eventual} horas para resolución administrativa.`);
      }
    }

    let siguienteSnap = null;
    const siguienteId = old.siguienteJornadaId
      || (state.jornadaAbiertaId && state.jornadaAbiertaId !== jornadaId ? state.jornadaAbiertaId : '');
    if (siguienteId && idValido(siguienteId)) {
      siguienteSnap = await tx.get(db.doc(`asistenciaJornadas/${siguienteId}`));
    }

    const motivoLimpio = motivo.trim();

    if (accion === 'sin_salida') {
      tx.update(ref, {
        estado: 'sin_salida',
        salidaEn: null,
        minutos: null,
        resueltoAdministrativamente: true,
        resueltoPor: p.id,
        resueltoPorNombre: p.nombre || '',
        resueltoEn: now,
        motivoResolucion: motivoLimpio,
        motivoCierre: 'no_checo_salida_rh',
        actualizadoEn: now,
      });

      if (stateSnap.exists && state.jornadaAbiertaId === jornadaId) {
        tx.update(stateRef, { jornadaAbiertaId: null, actualizadoEn: now });
      }

      tx.create(auditRef, {
        jornadaId,
        empleadoId: old.empleadoId,
        propiedadId: old.propiedadId,
        accion: 'resolucion_administrativa_sin_salida',
        motivo: motivoLimpio,
        anterior: { estado: old.estado, salidaEn: old.salidaEn || null },
        nuevo: { estado: 'sin_salida', salidaEn: null },
        por: p.id,
        porNombre: p.nombre || '',
        creadaEn: now,
      });

      return { ok: true, estado: 'sin_salida', jornadaId };
    }

    const fin = new Date(salidaIso);
    if (!Number.isFinite(fin.getTime())) {
      fail('invalid-argument', 'Captura la fecha y hora real de salida.');
    }
    if (fin.getTime() > now.toMillis()) {
      fail('invalid-argument', 'La salida no puede estar en el futuro.');
    }

    const inicio = old.entradaEn?.toMillis?.();
    if (!Number.isFinite(inicio) || fin.getTime() < inicio) {
      fail('invalid-argument', 'La salida debe ser posterior a la entrada.');
    }

    if (siguienteSnap?.exists) {
      const siguienteEntrada = siguienteSnap.data()?.entradaEn?.toMillis?.();
      if (Number.isFinite(siguienteEntrada) && fin.getTime() > siguienteEntrada) {
        fail('invalid-argument', 'La salida corregida no puede quedar después de la siguiente entrada registrada.');
      }
    }

    const salidaTs = Timestamp.fromDate(fin);
    const minutos = Math.floor((fin.getTime() - inicio) / 60000);

    tx.update(ref, {
      salidaEn: salidaTs,
      minutos,
      estado: 'corregida',
      salidaManual: true,
      salidaRegistradaPor: p.id,
      corregidaEn: now,
      motivoCorreccion: motivoLimpio,
      resueltoAdministrativamente: true,
      resueltoPor: p.id,
      resueltoPorNombre: p.nombre || '',
      resueltoEn: now,
      actualizadoEn: now,
    });

    if (stateSnap.exists && state.jornadaAbiertaId === jornadaId) {
      tx.update(stateRef, { jornadaAbiertaId: null, actualizadoEn: now });
    }

    tx.create(auditRef, {
      jornadaId,
      empleadoId: old.empleadoId,
      propiedadId: old.propiedadId,
      accion: 'correccion_administrativa_salida',
      motivo: motivoLimpio,
      anterior: { estado: old.estado, salidaEn: old.salidaEn || null },
      nuevo: { estado: 'corregida', salidaEn: salidaTs, minutos },
      por: p.id,
      porNombre: p.nombre || '',
      creadaEn: now,
    });

    return { ok: true, estado: 'corregida', jornadaId, minutos };
  });
});

export const asistenciaRevisarJornadasAbiertas = onSchedule({
  schedule: 'every 60 minutes',
  region: 'us-central1',
  timeZone: 'America/Mexico_City',
  timeoutSeconds: 300,
  memory: '256MiB',
}, async () => {
  const limites = await limitesAsistencia();
  const minimo = Math.min(limites.mexico, limites.eventual, limites.practicante);
  const cutoff = Timestamp.fromMillis(Date.now() - minimo * 3600000);
  const snap = await db.collection('asistenciaJornadas')
    .where('estado', '==', 'abierta')
    .where('entradaEn', '<=', cutoff)
    .orderBy('entradaEn', 'asc')
    .limit(250)
    .get();

  let mexicoCerradas = 0;
  let pendientes = 0;

  for (const docSnap of snap.docs) {
    const row = docSnap.data();
    if (!['personal_mexico', 'eventual', 'practicante'].includes(row.tipoPersonal)) continue;
    const result = await revisarJornadaVencida({
      empleadoId: row.empleadoId,
      jornadaId: docSnap.id,
      tipoPersonal: row.tipoPersonal,
      limites,
    });
    if (result.accion === 'cerrada_sin_salida') mexicoCerradas += 1;
    if (result.accion === 'salida_pendiente') pendientes += 1;
  }

  console.log('RevisionAsistencia', { revisadas: snap.size, mexicoCerradas, pendientes });
});

export const asistenciaCerrarJornadaManual = endpoint(async (req) => {
  const p = await administrador(req.auth.uid);
  const { jornadaId, salidaIso, motivo } = req.data || {};
  if (!idValido(jornadaId) || typeof motivo !== 'string' || motivo.trim().length < 10 || motivo.length > 1000) {
    fail('invalid-argument', 'Selecciona jornada y justifica el cierre con al menos 10 caracteres.');
  }
  const fin = new Date(salidaIso);
  if (!Number.isFinite(fin.getTime()) || fin.getTime() > Date.now()) fail('invalid-argument', 'La salida no puede estar en el futuro.');
  const auditRef = db.collection('asistenciaAuditoria').doc();
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`asistenciaJornadas/${jornadaId}`);
    const snap = await tx.get(ref);
    const old = snap.data();
    if (!snap.exists || !['abierta', 'salida_pendiente', 'sin_salida'].includes(old.estado)) fail('failed-precondition', 'La jornada ya no admite correccion manual. Actualiza el reporte.');
    const stateRef = db.doc(`asistenciaEstado/${old.empleadoId}`);
    const state = await tx.get(stateRef);
    const inicio = old.entradaEn?.toMillis?.();
    if (!Number.isFinite(inicio) || fin.getTime() < inicio) fail('invalid-argument', 'La salida debe ser posterior a la entrada.');
    const now = Timestamp.now();
    tx.update(ref, { salidaEn: Timestamp.fromDate(fin), salidaManual: true, estado: 'corregida',
      salidaRegistradaPor: p.id, motivoCorreccion: motivo.trim(), corregidaEn: now,
      minutos: Math.floor((fin.getTime() - inicio) / 60000), actualizadoEn: now });
    if (state.data()?.jornadaAbiertaId === jornadaId) tx.update(stateRef, { jornadaAbiertaId: null, actualizadoEn: now });
    tx.create(auditRef, { jornadaId, empleadoId: old.empleadoId, propiedadId: old.propiedadId,
      accion: 'cierre_manual', motivo: motivo.trim(), anterior: { salidaEn: old.salidaEn || null, estado: old.estado },
      nuevo: { salidaEn: Timestamp.fromDate(fin), estado: 'corregida' }, por: p.id, porNombre: p.nombre, creadaEn: now });
    return { ok: true };
  });
});

export const asistenciaConsultarSolicitud = endpoint(async (req) => {
  const p = await perfil(req.auth.uid);
  if (!puedeRegistrarAsistencia(p) || !idValido(req.data?.solicitudId)) fail('permission-denied', 'Consulta no permitida.');
  const snap = await db.doc(`asistenciaMovimientos/${req.data.solicitudId}`).get();
  if (!snap.exists) return { confirmado: false };
  const m = snap.data();
  if (m.registradoPor !== req.auth.uid || !puedeVerPropiedad(p, m.propiedadId)) fail('permission-denied', 'Consulta no permitida.');
  return { confirmado: true, id: snap.id, tipo: m.tipo, empleadoNombre: m.empleadoNombre,
    registradaEn: encodeTime(m.registradaEn) };
});
