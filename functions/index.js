import { tiempoMs, fechaHoraEnZona, fechaHoraLocalAMs, intervaloPlaneado, seTraslapan, candidatosDeEntrada, tarifaPlanificada, MAX_RESPALDO_BYTES } from './operacionEventuales.js';
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

    if (jornada.estado !== 'salida_pendiente' || (tipoPersonal === 'eventual' && jornada.requiereRevision !== true)) {
      tx.update(jornadaRef, {
        estado: 'salida_pendiente',
        salidaPendienteDesde: jornada.salidaPendienteDesde || now,
        ...(tipoPersonal === 'eventual' ? {requiereRevision: true,limiteRevisionHoras:limite} : {}),
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

function publicEndpoint(fn) {
  return onCall({ ...options, cors: true, invoker: 'public' }, async (req) => {
    try { return await fn(req); }
    catch (error) {
      if (error instanceof HttpsError) throw error;
      const referencia = hash(`${Date.now()}:${Math.random()}`).slice(0, 12);
      console.error('PublicFormError', { referencia, codigo: String(error?.code || ''), nombre: String(error?.name || 'Error') });
      throw new HttpsError('internal', `No se pudo completar la operacion. Referencia: ${referencia}.`, { referencia });
    }
  });
}

function textoLimitado(value, max, required = false, label = 'Dato') {
  const text = String(value ?? '').trim();
  if ((required && !text) || text.length > max) fail('invalid-argument', `${label} no es valido.`);
  return text;
}

function datosExtraEventual(data = {}) {
  return {
    grupoNombre: textoLimitado(data.grupoNombre, 120, false, 'Grupo'),
    encargadoNombre: textoLimitado(data.encargadoNombre, 160, false, 'Encargado'),
  };
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
  if (['administrador', 'supervisor', 'rh', 'solicitante', 'nominas'].includes(access.rol) && !isEmail) {
    fail('invalid-argument', 'Administrador, supervisor, RH, solicitantes y Nóminas deben usar un correo válido.');
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
    programacionId: row.programacionId || '',
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
      .where('fechaJornada', '>=', sumarDiasIso(semanaInicio,-1))
      .where('fechaJornada', '<=', sumarDiasIso(semanaFin,1))
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
        && (jornada.programacionId === asignacion.id || asignacion.jornadaId === jornada.id || (!jornada.programacionId && !asignacion.jornadaId && jornada.fechaJornada === asignacion.fecha)))
      .sort((a, b) => {
        const exactA=a.programacionId===asignacion.id || a.id===asignacion.jornadaId;
        const exactB=b.programacionId===asignacion.id || b.id===asignacion.jornadaId;
        if(exactA!==exactB)return exactA?-1:1;
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
    .filter((jornada) => !usadas.has(jornada.id) && !jornada.programacionId && jornada.fechaJornada >= semanaInicio && jornada.fechaJornada <= semanaFin)
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

export const planeacionGuardarNecesidad = endpoint(async req => {
  const actor=await actorConPermiso(req.auth.uid,PERMISOS.PLANEACION_PERSONAL);
  const {necesidadId='',propiedadId='',fecha='',horarioId='',puestoId='',cantidadNecesaria,observaciones=''}=req.data || {};
  if(![propiedadId,horarioId,puestoId].every(idValido)||!fechaIsoValida(fecha)||(necesidadId&&!idValido(necesidadId))||!Number.isInteger(Number(cantidadNecesaria))||Number(cantidadNecesaria)<1||Number(cantidadNecesaria)>100||typeof observaciones!=='string'||observaciones.length>500)fail('invalid-argument','Revisa fecha, horario, puesto y cantidad necesaria.');
  const generatedId=`nec_${hash(`${propiedadId}\0${fecha}\0${horarioId}\0${puestoId}`)}`;
  const targetRef=db.doc(`necesidadesPersonal/${generatedId}`),sourceRef=db.doc(`necesidadesPersonal/${necesidadId || generatedId}`);
  return db.runTransaction(async tx=>{
    const [fresh,property,hs,js,source,target,assignments]=await Promise.all([tx.get(db.doc(`usuarios/${actor.id}`)),tx.get(db.doc(`propiedades/${propiedadId}`)),tx.get(db.doc(`horarios/${horarioId}`)),tx.get(db.doc(`puestos/${puestoId}`)),tx.get(sourceRef),tx.get(targetRef),tx.get(db.collection('programacionPersonal').where('necesidadId','==',necesidadId || generatedId))]);
    if(!tienePermiso(fresh.data(),PERMISOS.PLANEACION_PERSONAL)||!puedeVerPropiedad(fresh.data(),propiedadId))fail('permission-denied','No tienes permiso en esta propiedad.');
    if(!property.exists||property.data().activo!==true||!hs.exists||hs.data().activo===false||!js.exists||js.data().activo===false)fail('failed-precondition','Revisa propiedad, horario y puesto activos.');
    if(necesidadId&&!source.exists)fail('not-found','La necesidad ya no existe.');
    if(source.exists&&source.data().propiedadId!==propiedadId)fail('failed-precondition','La necesidad pertenece a otra propiedad.');
    const active=assignments.docs.filter(d=>d.data().activo!==false),cantidad=Number(cantidadNecesaria);
    if(necesidadId&&necesidadId!==generatedId){
      if(active.length)fail('failed-precondition','Quita las personas asignadas antes de cambiar fecha, horario o puesto. Si tienen jornadas vinculadas, conserva la necesidad original.');
      if(target.exists&&target.data().activo!==false)fail('already-exists','Ya existe una necesidad con ese dia, horario y puesto.');
    }
    if(active.length>cantidad)fail('failed-precondition',`Ya hay ${active.length} personas asignadas. No puedes reducir la cantidad por debajo de ese total.`);
    const h=hs.data(),j=js.data(),old=source.data() || {},snapshot=active.length>0&&source.exists&&(!necesidadId||necesidadId===generatedId);
    const times=snapshot?{horaInicio:old.horaInicio,horaFin:old.horaFin,minutosDuracion:old.minutosDuracion,cruzaDia:old.cruzaDia===true}:{horaInicio:h.horaInicio,horaFin:h.horaFin,...datosDuracionHorario(h.horaInicio,h.horaFin)};
    const tarifa=Number(snapshot?old.tarifaHora:j.tarifaHora),now=Timestamp.now();
    if(!Number.isFinite(tarifa)||tarifa<0)fail('failed-precondition','Tarifa no valida en el puesto.');
    if(necesidadId&&necesidadId!==generatedId)tx.set(sourceRef,{activo:false,actualizadoEn:now,actualizadoPor:actor.id},{merge:true});
    tx.set(targetRef,{propiedadId,propiedadNombre:property.data().nombre || '',fecha,horarioId,horarioNombre:snapshot?(old.horarioNombre || ''):(h.nombre || ''),...times,puestoId,puestoNombre:snapshot?(old.puestoNombre || ''):(j.nombre || ''),tarifaHora:tarifa,cantidadNecesaria:cantidad,costoEstimado:Math.round(Number(times.minutosDuracion)/60*tarifa*cantidad*100)/100,observaciones:observaciones.trim(),activo:true,actualizadoEn:now,actualizadoPor:actor.id,...(!target.exists?{creadoEn:now,creadoPor:actor.id}:{})},{merge:true});
    return {necesidadId:generatedId};
  });
});

export const planeacionEliminarNecesidad = endpoint(async req => {
  const actor=await actorConPermiso(req.auth.uid,PERMISOS.PLANEACION_PERSONAL);
  const id=String(req.data?.necesidadId || '').trim();
  if(!idValido(id))fail('invalid-argument','Necesidad invalida.');
  const ref=db.doc(`necesidadesPersonal/${id}`);
  return db.runTransaction(async tx=>{
    const [ns,fresh,assigns]=await Promise.all([tx.get(ref),tx.get(db.doc(`usuarios/${actor.id}`)),tx.get(db.collection('programacionPersonal').where('necesidadId','==',id))]);
    if(!ns.exists)return {ok:true};
    if(!tienePermiso(fresh.data(),PERMISOS.PLANEACION_PERSONAL)||!puedeVerPropiedad(fresh.data(),ns.data().propiedadId))fail('permission-denied','No tienes permiso en esta propiedad.');
    if(assigns.docs.some(d=>d.data().jornadaId||d.data().reemplazoJornadaId))fail('failed-precondition','Esta necesidad tiene jornadas o reemplazos vinculados. Conserva el historial; corrige la jornada con respaldo.');
    const now=Timestamp.now();
    tx.set(ref,{activo:false,actualizadoEn:now,actualizadoPor:actor.id},{merge:true});
    assigns.docs.forEach(d=>tx.delete(d.ref));
    return {ok:true};
  });
});

export const planeacionAsignarEventual = endpoint(async req => {
  const actor=await actorConPermiso(req.auth.uid,PERMISOS.PLANEACION_PERSONAL);
  const {necesidadId,empleadoId}=req.data || {};
  if(![necesidadId,empleadoId].every(idValido)) fail('invalid-argument','Necesidad o empleado invalido.');
  return db.runTransaction(async tx=>{
    const needRef=db.doc(`necesidadesPersonal/${necesidadId}`),lock=db.doc(`planeacionBloqueos/${empleadoId}`);
    const assignmentId=`asg_${hash(`${necesidadId}\0${empleadoId}`)}`,ref=db.doc(`programacionPersonal/${assignmentId}`);
    const [ns,ps,existing,fresh]=await Promise.all([tx.get(needRef),tx.get(db.doc(`asistenciaPersonal/${empleadoId}`)),tx.get(ref),tx.get(db.doc(`usuarios/${actor.id}`)),tx.get(lock)]);
    if(!ns.exists || ns.data().activo===false) fail('not-found','Necesidad no disponible.');
    const n=ns.data(),person=ps.data();
    if(!tienePermiso(fresh.data(),PERMISOS.PLANEACION_PERSONAL) || !puedeVerPropiedad(fresh.data(),n.propiedadId)) fail('permission-denied','No tienes permiso en esta propiedad.');
    if(!ps.exists || person.activo!==true || person.tipo!=='eventual' || !personalPuedeOperarEnPropiedad(person,n.propiedadId)) fail('failed-precondition','Eventual no disponible en esta propiedad.');
    if(existing.exists) return {asignacionId:assignmentId,yaExistia:true};
    const [current,other]=await Promise.all([
      tx.get(db.collection('programacionPersonal').where('necesidadId','==',necesidadId)),
      tx.get(db.collection('programacionPersonal').where('empleadoId','==',empleadoId).where('fecha','>=',sumarDiasIso(n.fecha,-1)).where('fecha','<=',sumarDiasIso(n.fecha,1)))
    ]);
    if(current.docs.filter(d=>d.data().activo!==false).length>=Number(n.cantidadNecesaria)) fail('failed-precondition','La necesidad ya esta completa.');
    const target=intervaloPlaneado(n);
    if(!target) fail('failed-precondition','Revisa el horario de la necesidad.');
    for(const doc of other.docs) {
      const o=doc.data(),it=intervaloPlaneado(o);
      if(o.activo!==false && it && seTraslapan(target,it)) fail('failed-precondition','La persona ya esta asignada en ese horario, incluso en otra propiedad.');
    }
    const now=Timestamp.now(),tarifa=Number(n.tarifaHora || 0);
    tx.create(ref,{necesidadId,propiedadId:n.propiedadId,propiedadNombre:n.propiedadNombre || '',fecha:n.fecha,horarioId:n.horarioId,horarioNombre:n.horarioNombre || '',horaInicio:n.horaInicio,horaFin:n.horaFin,minutosDuracion:n.minutosDuracion,cruzaDia:n.cruzaDia===true,puestoId:n.puestoId,puestoNombre:n.puestoNombre || '',puestoHabitualId:person.puestoId || '',puestoHabitualNombre:person.puestoNombre || '',empleadoId,empleadoNombre:person.nombre || '',tarifaHoraPlanificada:tarifa,versionTarifa:2,origenTarifa:'puesto_asignado',costoEstimado:Math.round(Number(n.minutosDuracion)/60*tarifa*100)/100,estado:'programado',activo:true,asignadoEn:now,asignadoPor:actor.id});
    tx.set(lock,{actualizadoEn:now},{merge:true});
    tx.set(needRef,{asignacionesActualizadasEn:now},{merge:true});
    return {asignacionId:assignmentId};
  });
});

export const planeacionQuitarAsignacion = endpoint(async req => {
  const actor=await actorConPermiso(req.auth.uid,PERMISOS.PLANEACION_PERSONAL);
  const id=String(req.data?.asignacionId || '').trim();
  if(!idValido(id))fail('invalid-argument','Asignacion invalida.');
  const ref=db.doc(`programacionPersonal/${id}`);
  return db.runTransaction(async tx=>{
    const [snap,fresh]=await Promise.all([tx.get(ref),tx.get(db.doc(`usuarios/${actor.id}`))]);
    if(!snap.exists)return {ok:true};
    const a=snap.data();
    if(!tienePermiso(fresh.data(),PERMISOS.PLANEACION_PERSONAL)||!puedeVerPropiedad(fresh.data(),a.propiedadId))fail('permission-denied','No tienes permiso en esta propiedad.');
    if(a.jornadaId||a.reemplazoJornadaId)fail('failed-precondition','La asignacion ya tiene una jornada o reemplazo vinculado y debe conservarse.');
    const needRef=db.doc(`necesidadesPersonal/${a.necesidadId}`);
    await tx.get(needRef);
    tx.delete(ref);tx.set(needRef,{asignacionesActualizadasEn:Timestamp.now()},{merge:true});
    return {ok:true};
  });
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


// Registros publicos de Eventuales: la propiedad se define al APROBAR, nunca por el solicitante.
// Mexico (checador especial) no es una propiedad operativa para Eventuales.
async function propiedadesOperativasEventuales() {
  const [propSnap, mexicoSnap] = await Promise.all([
    db.collection('propiedades').where('activo', '==', true).get(),
    db.doc('configuracionAsistencia/mexico').get(),
  ]);
  const mexicoId = mexicoSnap.data()?.propiedadId || '';
  return propSnap.docs
    .filter((doc) => {
      const d = doc.data() || {};
      const nombre = normalizarClave(`${d.codigo || ''}_${d.nombre || ''}`);
      return doc.id !== mexicoId && !nombre.includes('MEXICO');
    })
    .map((doc) => ({ id: doc.id, nombre: doc.data()?.nombre || doc.id }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export const eventualFormularioCatalogoPublico = publicEndpoint(async () => {
  const puestosSnap = await db.collection('puestos').where('activo', '==', true).get();
  return {
    puestos: puestosSnap.docs
      .map((doc) => ({ id: doc.id, nombre: doc.data()?.nombre || doc.id }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  };
});

// El alta publica queda activa al instante, pero se guarda su foto en Storage PRIVADO.
// La foto no es prueba de identidad: el operador debe cotejarla al registrar asistencia.
function normalizarNombreEventual(nombre) {
  return normalizarClave(nombre).replace(/\s+/g, ' ').trim();
}

function extraerRostroEventual(valor) {
  if (typeof valor !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(valor) || valor.length > 400000) {
    fail('invalid-argument', 'Adjunta una fotografia de rostro en formato JPG (maximo 250 KB).');
  }
  const data = Buffer.from(valor.split(',')[1], 'base64');
  if (data.length < 2500 || data.length > 250 * 1024 || data[0] !== 0xff || data[1] !== 0xd8 || data.at(-2) !== 0xff || data.at(-1) !== 0xd9) {
    fail('invalid-argument', 'Fotografia invalida. Vuelve a tomarla.');
  }
  return data;
}

async function fotoEventualComoDataUrl(path) {
  if (!path || !/^eventuales\/rostros\/[a-zA-Z0-9_-]+\.jpg$/.test(path)) return '';
  try {
    const [data] = await getStorage().bucket().file(path).download();
    if (data.length > 250 * 1024) return '';
    return `data:image/jpeg;base64,${data.toString('base64')}`;
  } catch (err) {
    console.error('FotoEventualNoDisponible', { codigo: String(err?.code || '') });
    return '';
  }
}

export const eventualRegistrarSolicitudPublica = publicEndpoint(async (req) => {
  const nombre = textoLimitado(req.data?.nombre, 160, true, 'Nombre').replace(/\s+/g, ' ').toLocaleUpperCase('es-MX');
  const telefono = textoLimitado(req.data?.telefono, 40, true, 'Telefono');
  const puestoId = textoLimitado(req.data?.puestoId, 128, true, 'Puesto');
  const encargadoNombre = textoLimitado(req.data?.encargadoNombre, 160, false, 'Encargado');
  const foto = extraerRostroEventual(req.data?.fotoRostro);
  const nombreNormalizado = normalizarNombreEventual(nombre);
  if (nombreNormalizado.length < 7 || nombreNormalizado.split(' ').length < 2) {
    fail('invalid-argument', 'Captura nombre y apellidos completos.');
  }
  if (!/^[0-9 +()\-]{10,20}$/.test(telefono) || telefono.replace(/\D/g, '').length < 10) {
    fail('invalid-argument', 'Captura un telefono valido de al menos 10 digitos.');
  }
  if (!idValido(puestoId)) fail('invalid-argument', 'Puesto no valido.');
  if (req.data?.aceptaRegistro !== true) fail('failed-precondition', 'Debes autorizar el uso de tus datos para registrarte.');

  const [puestoSnap, operativas, mismaPersona, mismoTelefono, nombreExacto] = await Promise.all([
    db.doc(`puestos/${puestoId}`).get(), propiedadesOperativasEventuales(),
    db.doc(`asistenciaNombresEventuales/${hash(nombreNormalizado)}`).get(),
    db.collection('asistenciaPersonal').where('telefono', '==', telefono).limit(30).get(),
    db.collection('asistenciaPersonal').where('nombre', '==', nombre).limit(10).get(),
  ]);
  if (!puestoSnap.exists || puestoSnap.data()?.activo !== true) fail('failed-precondition', 'El puesto ya no esta disponible.');
  if (!operativas.length || operativas.length > 100) fail('failed-precondition', 'No hay propiedades operativas disponibles.');
  if (mismaPersona.exists || nombreExacto.docs.some((d) => d.data()?.tipo === 'eventual' && d.data()?.activo !== false) ||
    mismoTelefono.docs.some((d) => d.data()?.tipo === 'eventual' && normalizarNombreEventual(d.data()?.nombre || '') === nombreNormalizado)) {
    fail('already-exists', 'Este nombre ya esta registrado. Consulta con RH para recuperar tu QR; no hagas otro registro.');
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const ip = String(req.rawRequest?.ip || req.rawRequest?.headers?.['x-forwarded-for'] || 'origen-no-disponible').split(',')[0].trim();
  const limitRef = db.doc(`asistenciaRegistroLimites/${hash(`${fecha}:${ip}`)}`);
  const solicitudRef = db.collection('solicitudesEventuales').doc();
  const personRef = db.collection('asistenciaPersonal').doc();
  const nameRef = db.doc(`asistenciaNombresEventuales/${hash(nombreNormalizado)}`);
  const clave = codigoPersonal('eventual');
  const claveRef = db.doc(`asistenciaClaves/${clave}`);
  const fotoRostroPath = `eventuales/rostros/${personRef.id}.jpg`;
  const consultaToken = randomBytes(18).toString('hex');
  const now = Timestamp.now();
  const ids = operativas.map((p) => p.id);
  const folio = `EVREG-${new Date().getUTCFullYear()}-${solicitudRef.id.slice(0, 6).toUpperCase()}`;
  const fields = validarPersonal({
    nombre, telefono, tipo: 'eventual', clave, puestoId, activo: true,
    propiedadesPermitidas: ids, area: '', tarifaPersonalizada: null,
  });
  // La subida se hace antes de la transaccion; si falla el alta, se limpia la foto.
  const bucketFile = getStorage().bucket().file(fotoRostroPath);
  await bucketFile.save(foto, { resumable: false, metadata: {
    contentType: 'image/jpeg', cacheControl: 'private, no-store',
  }});
  try {
    await db.runTransaction(async (tx) => {
      const [nombreActual, limiteActual] = await Promise.all([tx.get(nameRef), tx.get(limitRef)]);
      if (nombreActual.exists) fail('already-exists', 'Este nombre ya esta registrado. Consulta con RH.');
      const actual = Number(limiteActual.data()?.conteo || 0);
      if (actual >= 60) fail('resource-exhausted', 'Demasiados registros desde este dispositivo. Consulta a RH.');
      tx.create(nameRef, { empleadoId: personRef.id, nombreNormalizado, creadoEn: now });
      tx.set(limitRef, { fecha, conteo: actual + 1, actualizadoEn: now }, { merge: true });
      tx.create(personRef, {
        ...fields, propiedadId: ids[0], puestoNombre: puestoSnap.data()?.nombre || '',
        tarifaBase: Number(puestoSnap.data()?.tarifaHora || 0),
        encargadoNombre, grupoNombre: '', fotoRostroPath,
        requiereCotejoVisual: true, origenRegistro: 'autorregistro_publico',
        solicitudEventualId: solicitudRef.id, creadoEn: now, creadoPor: 'autorregistro_publico',
        actualizadoEn: now, actualizadoPor: 'autorregistro_publico',
      });
      tx.create(claveRef, { empleadoId: personRef.id, clave, tipo: 'eventual', creadoEn: now, actualizadoEn: now });
      tx.create(solicitudRef, {
        folio, nombre, telefono, puestoId, puestoNombre: puestoSnap.data()?.nombre || '',
        encargadoNombre, propiedadId: 'todas', propiedadNombre: 'Todas las propiedades',
        alcancePropiedades: 'todas_operativas', fotoRostroPath,
        consultaHash: hash(consultaToken), estado: 'aprobada', empleadoId: personRef.id,
        clave, qr: clave, creadoEn: now, resueltaEn: now,
        resueltaPor: 'autorregistro_publico', origen: 'autorregistro_publico',
      });
    });
  } catch (err) {
    await bucketFile.delete({ ignoreNotFound: true }).catch(() => {});
    throw err;
  }
  return { solicitudId: solicitudRef.id, consultaToken, folio, estado: 'aprobada',
    nombre, puestoNombre: puestoSnap.data()?.nombre || '', clave, qr: clave };
});

export const eventualConsultarSolicitudPublica = publicEndpoint(async (req) => {
  const solicitudId = String(req.data?.solicitudId || '').trim();
  const consultaToken = String(req.data?.consultaToken || '').trim();
  if (!idValido(solicitudId) || !/^[a-f0-9]{36}$/.test(consultaToken)) fail('invalid-argument', 'Solicitud no valida.');
  const snap = await db.doc(`solicitudesEventuales/${solicitudId}`).get();
  if (!snap.exists || snap.data()?.consultaHash !== hash(consultaToken)) fail('not-found', 'Solicitud no encontrada.');
  const d = snap.data();
  const fotoRostro = d.estado === 'aprobada' ? await fotoEventualComoDataUrl(d.fotoRostroPath) : '';
  return {
    fotoRostro,
    folio: d.folio || '',
    estado: d.estado || 'pendiente',
    nombre: d.nombre || '',
    propiedadNombre: d.propiedadNombre || '',
    puestoNombre: d.puestoNombre || '',
    clave: d.estado === 'aprobada' ? (d.clave || '') : '',
    qr: d.estado === 'aprobada' ? (d.qr || d.clave || '') : '',
    motivoRechazo: d.estado === 'rechazada' ? (d.motivoRechazo || '') : '',
  };
});

export const eventualConsultarFotoPersonal = endpoint(async (req) => {
  const actor = await administradorOPersonal(req.auth.uid);
  const empleadoId = String(req.data?.empleadoId || '').trim();
  if (!idValido(empleadoId)) fail('invalid-argument', 'Persona no valida.');
  const snap = await db.doc(`asistenciaPersonal/${empleadoId}`).get();
  if (!snap.exists || snap.data()?.tipo !== 'eventual') fail('not-found', 'Eventual no encontrado.');
  if (!(snap.data()?.propiedadesPermitidas || []).some((id) => puedeVerPropiedad(actor, id))) {
    fail('permission-denied', 'No tienes acceso a este eventual.');
  }
  return { fotoRostro: await fotoEventualComoDataUrl(snap.data()?.fotoRostroPath) };
});

export const eventualListarSolicitudes = endpoint(async (req) => {
  const actor = await administradorOPersonal(req.auth.uid);
  const estado = String(req.data?.estado || 'pendiente').trim();
  if (!['pendiente', 'aprobada', 'rechazada', 'todas'].includes(estado)) fail('invalid-argument', 'Estado no valido.');
  let q = db.collection('solicitudesEventuales');
  if (estado !== 'todas') q = q.where('estado', '==', estado);
  const snap = await q.limit(250).get();
  const necesitaTodas = snap.docs.some((doc) => doc.data()?.alcancePropiedades === 'todas_operativas');
  const operativas = necesitaTodas ? await propiedadesOperativasEventuales() : [];
  const puedeAprobarTodas = operativas.length > 0
    && operativas.every((propiedad) => puedeVerPropiedad(actor, propiedad.id));
  const rows = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data(), consultaHash: undefined }))
    .filter((item) => item.alcancePropiedades === 'todas_operativas'
      ? puedeAprobarTodas
      : item.propiedadId && puedeVerPropiedad(actor, item.propiedadId))
    .sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
  return { rows };
});

export const eventualResolverSolicitud = endpoint(async (req) => {
  const actor = await administradorOPersonal(req.auth.uid);
  const solicitudId = String(req.data?.solicitudId || '').trim();
  const accion = String(req.data?.accion || '').trim();
  if (!idValido(solicitudId) || !['aprobar', 'rechazar'].includes(accion)) fail('invalid-argument', 'Solicitud o accion no valida.');
  const ref = db.doc(`solicitudesEventuales/${solicitudId}`);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'La solicitud ya no existe.');
  const solicitud = snap.data();
  if (solicitud.estado !== 'pendiente') fail('failed-precondition', 'La solicitud ya fue atendida.');
  const alcanceTodas = solicitud.alcancePropiedades === 'todas_operativas';
  const operativas = alcanceTodas ? await propiedadesOperativasEventuales() : [];
  const propiedadesAprobadas = alcanceTodas
    ? operativas.map((item) => item.id)
    : [solicitud.propiedadId];
  if (!propiedadesAprobadas.length || propiedadesAprobadas.length > 100) {
    fail('failed-precondition', 'No hay propiedades operativas validas para asignar.');
  }
  // Una cuenta limitada a un hotel NO debe poder otorgar acceso a todos.
  for (const propiedadId of propiedadesAprobadas) {
    await autorizarPropiedad(actor, propiedadId);
  }

  if (accion === 'rechazar') {
    const motivoRechazo = textoLimitado(req.data?.motivoRechazo, 300, true, 'Motivo');
    await ref.set({ estado: 'rechazada', motivoRechazo, resueltaEn: Timestamp.now(), resueltaPor: actor.id }, { merge: true });
    return { ok: true, estado: 'rechazada' };
  }

  const [puestoSnap, samePhoneSnap] = await Promise.all([
    db.doc(`puestos/${solicitud.puestoId}`).get(),
    solicitud.telefono
      ? db.collection('asistenciaPersonal').where('telefono', '==', solicitud.telefono).limit(20).get()
      : Promise.resolve({ docs: [] }),
  ]);
  if (!puestoSnap.exists || puestoSnap.data()?.activo !== true) fail('failed-precondition', 'El puesto ya no esta activo.');
  const nombreNormalizado = normalizarClave(solicitud.nombre);
  const duplicado = samePhoneSnap.docs.find((doc) => doc.data()?.tipo === 'eventual' && normalizarClave(doc.data()?.nombre) === nombreNormalizado);
  if (duplicado) fail('already-exists', 'Ya existe un eventual con el mismo nombre y telefono. Revisa Personal antes de aprobar.');

  const clave = codigoPersonal('eventual');
  const personRef = db.collection('asistenciaPersonal').doc();
  const claveRef = db.doc(`asistenciaClaves/${clave}`);
  const now = Timestamp.now();
  const fields = validarPersonal({
    clave,
    nombre: solicitud.nombre,
    telefono: solicitud.telefono,
    tipo: 'eventual',
    area: solicitud.area || '',
    puestoId: solicitud.puestoId,
    tarifaPersonalizada: null,
    activo: true,
    propiedadesPermitidas: propiedadesAprobadas,
  });
  const personData = {
    ...fields,
    propiedadId: propiedadesAprobadas[0],
    puestoNombre: puestoSnap.data()?.nombre || '',
    tarifaBase: Number(puestoSnap.data()?.tarifaHora || 0),
    grupoNombre: solicitud.grupoNombre || '',
    encargadoNombre: solicitud.encargadoNombre || '',
    origenRegistro: 'formulario_publico',
    solicitudEventualId: solicitudId,
    creadoEn: now,
    creadoPor: actor.id,
    actualizadoEn: now,
    actualizadoPor: actor.id,
  };

  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.data()?.estado !== 'pendiente') fail('failed-precondition', 'La solicitud ya fue atendida.');
    tx.create(personRef, personData);
    tx.create(claveRef, { empleadoId: personRef.id, clave, tipo: 'eventual', creadoEn: now, actualizadoEn: now });
    tx.set(ref, {
      estado: 'aprobada',
      empleadoId: personRef.id,
      clave,
      qr: clave,
      resueltaEn: now,
      resueltaPor: actor.id,
    }, { merge: true });
  });
  return { ok: true, estado: 'aprobada', empleadoId: personRef.id, clave, qr: clave };
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
      ...datosExtraEventual(req.data),
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
        && row.requiereRevision !== true
        && (salidaMs - (row.entradaEn?.toMillis?.() || 0)) < (await limitesAsistencia()).eventual * 3600000
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

  const programacionesDisponibles = e.tipo === 'eventual'
    ? await programasParaEntrada({ get: ref => ref.get() }, empleadoId, propiedad.id, Timestamp.now(), propiedad)
    : [];
  const fotoRostro = e.tipo === 'eventual' ? await fotoEventualComoDataUrl(e.fotoRostroPath) : '';
  if (e.requiereCotejoVisual && !fotoRostro) {
    fail('unavailable', 'No se pudo cargar la foto de identificacion. No registres sin verificar identidad.');
  }
  return {
    empleado: {
      fotoRostro,
      requiereCotejoVisual: Boolean(e.requiereCotejoVisual),
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
    programacionesDisponibles,
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
    cotejoFotoConfirmado = false,
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
  const limitesMovimiento = await limitesAsistencia();

  const resultadoMovimiento = await db.runTransaction(async (tx) => {
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
    if (emp?.requiereCotejoVisual && cotejoFotoConfirmado !== true) {
      fail('failed-precondition', 'Debes confirmar el cotejo visual de la fotografia del eventual.');
    }

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

    if (tipo === 'salida' && emp.tipo === 'eventual' && jornada && !jornada.salidaEn) {
      const horas = horasTranscurridasJornada(jornada, now.toMillis());
      if (jornada.estado === 'salida_pendiente' || (horas !== null && horas >= limitesMovimiento.eventual)) {
        tx.update(jornadaRef, { estado: 'salida_pendiente', requiereRevision: true,
          limiteRevisionHoras: limitesMovimiento.eventual, salidaPendienteDesde: jornada.salidaPendienteDesde || now, actualizadoEn: now });
        return { requiereRevision: true };
      }
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

    const tarifaAsignacion = tipo === 'entrada' && emp.tipo === 'eventual'
      ? await tarifaParaEntrada(tx, empleadoId, emp, propiedadId, now, ps.data(), req.data?.programacionId || '')
      : null;
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
        puestoId: tarifaAsignacion?.puestoId || (emp.tipo === 'eventual' ? (emp.puestoId || '') : ''),
        puestoNombre: tarifaAsignacion?.puestoNombre || (emp.tipo === 'eventual' ? (emp.puestoNombre || '') : ''),
        ...(tarifaAsignacion || {}),
        limiteRevisionHoras: limitesMovimiento.eventual,
        area: emp.area || '',
        tarifaHoraAplicada:
          emp.tipo === 'eventual'
            ? (tarifaAsignacion?.tarifaHoraAplicada ?? Number(emp.tarifaPersonalizada ?? emp.tarifaBase ?? 0))
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

      if (tarifaAsignacion?.programacionId) tx.update(db.doc(`programacionPersonal/${tarifaAsignacion.programacionId}`), { jornadaId, vinculadaEn: now });
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
  if (resultadoMovimiento.requiereRevision) fail('failed-precondition', 'Turno excedido: se envio a revision de RH. No se registro salida ni pago. Vuelve a consultar a la persona.');
  return resultadoMovimiento;
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

  const limitesReapertura = await limitesAsistencia();
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
    if(emp.tipo === 'eventual' && (old.requiereRevision || ((tiempoMs(old.salidaEn) || 0)-(tiempoMs(old.entradaEn) || 0)) >= limitesReapertura.eventual*3600000)) fail('failed-precondition','La jornada requiere revision con respaldo; no puede reabrirse desde Seguridad.');
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
      if(oldMovement.registradoPor!==uid || oldMovement.empleadoId!==empleadoId || oldMovement.propiedadId!==propiedadId) fail('already-exists','La solicitud pertenece a otra operacion.');
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
    if (emp.tipo === 'eventual') fail('failed-precondition','Actualiza la APK: envia el turno a revision y registra la nueva entrada con el flujo normal de fotografia.');
    if (!['eventual', 'practicante'].includes(emp.tipo)) {
      fail('failed-precondition', 'Este flujo solo aplica a eventuales y practicantes.');
    }
    if (!personalPuedeOperarEnPropiedad(emp, propiedadId)) {
      fail('permission-denied', 'La persona no esta asignada a esta propiedad.');
    }

    if (!oldSnap.exists) fail('failed-precondition', 'El turno anterior ya no existe. Actualiza la consulta.');
    const old = oldSnap.data();
    const state = stateSnap.data() || {};
    if (!emp.activo || old.empleadoId!==empleadoId) fail('failed-precondition','Persona inactiva o jornada incorrecta.');
    if (state.jornadaAbiertaId !== jornadaPendienteId || old.salidaEn) {
      fail('failed-precondition', 'El turno anterior ya fue modificado. Vuelve a escanear el QR.');
    }

    const horas = horasTranscurridasJornada(old, Date.now());
    const limite = limitePorTipo(emp.tipo, limites);
    if (horas === null || limite === null || horas < limite) {
      fail('failed-precondition', 'El turno todavia no cumple el tiempo para marcarse como salida pendiente.');
    }

    const now = Timestamp.now();
    const tarifaAsignacion = emp.tipo === 'eventual' ? await tarifaParaEntrada(tx,empleadoId,emp,propiedadId,now,propiedad,req.data?.programacionId || '') : null;

    tx.update(jornadaAnteriorRef, {
      estado: 'sin_salida',
      salidaEn: null,
      minutos: null,
      motivoCierre: 'no_checo_salida',
      requiereRevision: true,
      limiteRevisionHoras: limite,
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
      ...(tarifaAsignacion || {}),
      limiteRevisionHoras: limite,
      tarifaHoraAplicada:
        emp.tipo === 'eventual'
          ? (tarifaAsignacion?.tarifaHoraAplicada ?? Number(emp.tarifaPersonalizada ?? emp.tarifaBase ?? 0))
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

    if(tarifaAsignacion?.programacionId) tx.update(db.doc(`programacionPersonal/${tarifaAsignacion.programacionId}`),{jornadaId:solicitudId,vinculadaEn:now});
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
  fail('failed-precondition', 'Utiliza Revision / editar con respaldo. Toda correccion de Eventuales requiere un documento.');
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
    if (old?.tipoPersonal === 'eventual') fail('failed-precondition', 'Utiliza Revision / editar con respaldo para Eventuales.');
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

// October update: documented corrections, multi-date needs and per-shift job rates.
async function programasParaEntrada(reader, empleadoId, propiedadId, now, property) {
  const zone = property?.asistencia?.zonaHoraria || 'America/Mexico_City';
  const date = fechaEnZona(now.toDate(), zone);
  const snap = await reader.get(db.collection('programacionPersonal').where('empleadoId','==',empleadoId)
    .where('fecha','>=',sumarDiasIso(date,-1)).where('fecha','<=',date));
  const rows = snap.docs.map(plainDoc).filter(a => a.propiedadId === propiedadId);
  return candidatosDeEntrada(rows, now.toMillis(), zone);
}
async function tarifaParaEntrada(tx, empleadoId, emp, propiedadId, now, property, seleccion = '') {
  const list = await programasParaEntrada(tx,empleadoId,propiedadId,now,property);
  if (list.length > 1 && !seleccion) fail('failed-precondition','Hay varias asignaciones posibles. Vuelve a consultar y selecciona el turno que vas a iniciar.');
  const asg = seleccion ? list.find(a => a.id === seleccion) : list[0];
  if (seleccion && !asg) fail('failed-precondition','La asignacion ya no esta disponible. Vuelve a consultar.');
  if (!asg) return {puestoId:emp.puestoId || '',puestoNombre:emp.puestoNombre || '',tarifaHoraAplicada:Number(emp.tarifaPersonalizada ?? emp.tarifaBase ?? 0),origenTarifa:'puesto_habitual',programacionId:null,puestoHabitualId:emp.puestoId || '',horarioIdPlanificado:'',horarioNombrePlanificado:'',horaInicioPlanificada:'',horaFinPlanificada:'',minutosTurnoPlanificado:null,cruzaDiaPlanificado:false};
  const needSnap = await tx.get(db.doc(`necesidadesPersonal/${asg.necesidadId}`));
  if (!needSnap.exists || needSnap.data().activo === false) fail('failed-precondition','La necesidad cambio. Vuelve a consultar.');
  const need = needSnap.data();
  const horaInicioPlanificada = asg.horaInicio || need.horaInicio || '';
  const horaFinPlanificada = asg.horaFin || need.horaFin || '';
  const minutosTurnoPlanificado = Number(asg.minutosDuracion || need.minutosDuracion || (horaValida(horaInicioPlanificada) && horaValida(horaFinPlanificada) ? datosDuracionHorario(horaInicioPlanificada,horaFinPlanificada).minutosDuracion : 0)) || null;
  return { puestoId:asg.puestoId,puestoNombre:asg.puestoNombre || need.puestoNombre || '',tarifaHoraAplicada:tarifaPlanificada(asg,need),origenTarifa:'puesto_asignado',programacionId:asg.id,necesidadId:asg.necesidadId,puestoHabitualId:emp.puestoId || '',versionTarifa:2,horarioIdPlanificado:asg.horarioId || need.horarioId || '',horarioNombrePlanificado:asg.horarioNombre || need.horarioNombre || '',horaInicioPlanificada,horaFinPlanificada,minutosTurnoPlanificado,cruzaDiaPlanificado:asg.cruzaDia===true || need.cruzaDia===true };
}
export const asistenciaProgramacionesReporte = endpoint(async (req) => {
  const p = await perfil(req.auth.uid);
  const propiedadId = String(req.data?.propiedadId || '').trim();
  const ids = [...new Set(Array.isArray(req.data?.programacionIds) ? req.data.programacionIds.map((id) => String(id || '').trim()).filter(Boolean) : [])];
  if (!(p.rol === 'administrador' || tienePermiso(p, PERMISOS.REPORTES_EVENTUALES))) fail('permission-denied','No tienes permiso para consultar programaciones de Eventuales.');
  if (!idValido(propiedadId) || !puedeVerPropiedad(p, propiedadId)) fail('permission-denied','No tienes acceso a esa propiedad.');
  if (ids.length > 300 || ids.some((id) => !idValido(id))) fail('invalid-argument','La lista de programaciones no es valida.');
  const snaps = await Promise.all(ids.map((id) => db.doc(`programacionPersonal/${id}`).get()));
  const rows = snaps.filter((snap) => snap.exists && snap.data()?.propiedadId === propiedadId).map((snap) => {
    const d = snap.data() || {};
    return {
      id: snap.id, fecha: d.fecha || '', horarioId: d.horarioId || '', horarioNombre: d.horarioNombre || '',
      horaInicio: d.horaInicio || '', horaFin: d.horaFin || '', minutosDuracion: Number(d.minutosDuracion || 0),
      cruzaDia: d.cruzaDia === true, puestoId: d.puestoId || '', puestoNombre: d.puestoNombre || '',
    };
  });
  return { rows };
});

export const planeacionGuardarNecesidadesVariosDias = endpoint(async req => {
  const actor = await actorConPermiso(req.auth.uid,PERMISOS.PLANEACION_PERSONAL);
  const {propiedadId,horarioId,puestoId,cantidadNecesaria,fechas,observaciones=''} = req.data || {};
  if (![propiedadId,horarioId,puestoId].every(idValido) || !Array.isArray(fechas) || !fechas.length || fechas.length>31 || fechas.some(f=>!fechaIsoValida(f)) || !Number.isInteger(Number(cantidadNecesaria)) || Number(cantidadNecesaria)<1 || Number(cantidadNecesaria)>100 || typeof observaciones !== 'string' || observaciones.length>500) fail('invalid-argument','Revisa fechas (hasta 31), horario, puesto y cantidad de 1 a 100.');
  const dates = [...new Set(fechas)].sort();
  return db.runTransaction(async tx => {
    const [ps,hs,js,fresh] = await Promise.all([tx.get(db.doc(`propiedades/${propiedadId}`)),tx.get(db.doc(`horarios/${horarioId}`)),tx.get(db.doc(`puestos/${puestoId}`)),tx.get(db.doc(`usuarios/${actor.id}`))]);
    if (!tienePermiso({...fresh.data(),id:actor.id},PERMISOS.PLANEACION_PERSONAL) || !puedeVerPropiedad(fresh.data(),propiedadId)) fail('permission-denied','Tus permisos cambiaron.');
    if (!ps.exists || ps.data().activo!==true || !hs.exists || hs.data().activo===false || !js.exists || js.data().activo===false) fail('failed-precondition','Propiedad, horario o puesto inactivo.');
    const targets = dates.map(fecha=>({fecha,ref:db.doc(`necesidadesPersonal/nec_${hash(`${propiedadId}\0${fecha}\0${horarioId}\0${puestoId}`)}`)}));
    const current = await Promise.all(targets.map(t=>tx.get(t.ref)));
    const omitidas = targets.filter((_,i)=>current[i].exists && current[i].data().activo!==false).map(t=>t.fecha);
    const now=Timestamp.now(), h=hs.data(),j=js.data(), cantidad=Number(cantidadNecesaria);
    const dur=datosDuracionHorario(h.horaInicio,h.horaFin);
    targets.forEach((t,i)=>{
      if (omitidas.includes(t.fecha)) return;
      tx.set(t.ref,{propiedadId,propiedadNombre:ps.data().nombre || '',fecha:t.fecha,horarioId,horarioNombre:h.nombre || '',horaInicio:h.horaInicio,horaFin:h.horaFin,...dur,puestoId,puestoNombre:j.nombre || '',tarifaHora:Number(j.tarifaHora || 0),cantidadNecesaria:cantidad,costoEstimado:Math.round(dur.minutosDuracion/60*Number(j.tarifaHora || 0)*cantidad*100)/100,observaciones:observaciones.trim(),activo:true,creadoEn:now,creadoPor:actor.id,actualizadoEn:now,actualizadoPor:actor.id});
    });
    return {creadas:targets.length-omitidas.length,omitidas:omitidas.length,fechasOmitidas:omitidas};
  });
});

function requisicionPuedeSolicitar(actor) {
  return actor?.rol === 'administrador'
    || tienePermiso(actor, PERMISOS.SOLICITAR_PERSONAL)
    || tienePermiso(actor, PERMISOS.AUTORIZAR_REQUISICIONES_PERSONAL);
}

function requisicionPuedeAutorizar(actor) {
  return actor?.rol === 'administrador'
    || tienePermiso(actor, PERMISOS.AUTORIZAR_REQUISICIONES_PERSONAL)
    || (actor?.rol === 'rh' && tienePermiso(actor, PERMISOS.PLANEACION_PERSONAL));
}

function fechasPeriodoRequisicion(desde, hasta) {
  if (!fechaIsoValida(desde) || !fechaIsoValida(hasta) || hasta < desde) {
    fail('invalid-argument', 'Revisa el periodo solicitado.');
  }
  const dates = [];
  let cursor = desde;
  while (cursor <= hasta && dates.length <= 31) {
    dates.push(cursor);
    cursor = sumarDiasIso(cursor, 1);
  }
  if (!dates.length || dates.length > 31 || dates.at(-1) !== hasta) {
    fail('invalid-argument', 'Una requisicion puede abarcar como maximo 31 dias.');
  }
  return dates;
}

function fechasPartidaRequisicion(item = {}) {
  if (Array.isArray(item.fechas) && item.fechas.length) {
    const fechas = [...new Set(item.fechas.map((value) => String(value || '').trim()))].sort();
    if (!fechas.length || fechas.length > 31 || fechas.some((value) => !fechaIsoValida(value))) {
      fail('invalid-argument', 'Revisa los dias seleccionados de la requisicion.');
    }
    return fechas;
  }
  return fechasPeriodoRequisicion(String(item.fechaDesde || '').trim(), String(item.fechaHasta || '').trim());
}

function codigoFolioRequisicion(value) {
  return String(value || 'GMR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'GMR';
}

function requisicionPlain(docSnap) {
  const row = plainDoc(docSnap);
  for (const key of ['autorizadoEn', 'rechazadoEn']) {
    if (row[key]?.toDate) row[key] = row[key].toDate().toISOString();
  }
  return row;
}

export const requisicionesCatalogos = endpoint(async (req) => {
  const actor = await perfil(req.auth.uid);
  if (!requisicionPuedeSolicitar(actor)) {
    fail('permission-denied', 'Esta cuenta no puede solicitar personal.');
  }
  const [propertiesSnap, puestosSnap, horariosSnap] = await Promise.all([
    db.collection('propiedades').where('activo', '==', true).get(),
    db.collection('puestos').where('activo', '==', true).get(),
    db.collection('horarios').where('activo', '==', true).get(),
  ]);
  const propiedades = propertiesSnap.docs
    .filter((docSnap) => puedeVerPropiedad(actor, docSnap.id))
    .map((docSnap) => ({ id: docSnap.id, nombre: docSnap.data()?.nombre || '', codigo: docSnap.data()?.codigo || '' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const puestos = puestosSnap.docs
    .map((docSnap) => ({ id: docSnap.id, nombre: docSnap.data()?.nombre || '', tarifaHora: Number(docSnap.data()?.tarifaHora || 0) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const horarios = horariosSnap.docs
    .map((docSnap) => ({ id: docSnap.id, nombre: docSnap.data()?.nombre || '', horaInicio: docSnap.data()?.horaInicio || '', horaFin: docSnap.data()?.horaFin || '' }))
    .sort((a, b) => String(a.horaInicio).localeCompare(String(b.horaInicio)) || a.nombre.localeCompare(b.nombre, 'es'));
  return { propiedades, puestos, horarios, puedeAutorizar: requisicionPuedeAutorizar(actor) };
});

export const requisicionesListar = endpoint(async (req) => {
  const actor = await perfil(req.auth.uid);
  if (!requisicionPuedeSolicitar(actor)) {
    fail('permission-denied', 'Esta cuenta no puede consultar requisiciones de personal.');
  }
  const puedeAutorizar = requisicionPuedeAutorizar(actor);
  const propiedadFiltro = String(req.data?.propiedadId || '').trim();
  if (propiedadFiltro) await autorizarPropiedad(actor, propiedadFiltro);
  let query = db.collection('requisicionesPersonal');
  if (!puedeAutorizar) query = query.where('solicitanteId', '==', actor.id);
  else if (propiedadFiltro) query = query.where('propiedadId', '==', propiedadFiltro);
  const snap = await query.limit(300).get();
  const solicitudes = snap.docs
    .map(requisicionPlain)
    .filter((row) => puedeVerPropiedad(actor, row.propiedadId))
    .sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || '')));
  return { solicitudes, puedeAutorizar, limite: 300 };
});

function normalizarPartidasRequisicion(data = {}) {
  const raw = Array.isArray(data.partidas) && data.partidas.length
    ? data.partidas
    : [{
        partidaId: 'legacy_1',
        puestoId: data.puestoId,
        horarioId: data.horarioId,
        cantidadPersonas: data.cantidadPersonas,
        fechaDesde: data.fechaDesde,
        fechaHasta: data.fechaHasta,
      }];
  if (!raw.length || raw.length > 40) fail('invalid-argument', 'Agrega entre 1 y 40 necesidades por requisicion.');
  let diasExpandidos = 0;
  const result = raw.map((item, index) => {
    const puestoId = String(item?.puestoId || '').trim();
    const horarioId = String(item?.horarioId || '').trim();
    if (![puestoId, horarioId].every(idValido)) fail('invalid-argument', `Revisa puesto y horario de la necesidad ${index + 1}.`);
    const cantidadPersonas = Number(item?.cantidadPersonas);
    if (!Number.isInteger(cantidadPersonas) || cantidadPersonas < 1 || cantidadPersonas > 100) {
      fail('invalid-argument', `La cantidad de la necesidad ${index + 1} debe estar entre 1 y 100.`);
    }
    const fechas = fechasPartidaRequisicion(item || {});
    const fechaDesde = fechas[0];
    const fechaHasta = fechas.at(-1);
    diasExpandidos += fechas.length;
    const rawId = String(item?.partidaId || '').trim();
    return {
      partidaId: /^[A-Za-z0-9_-]{1,80}$/.test(rawId) ? rawId : `p_${String(index + 1).padStart(2, '0')}`,
      puestoId,
      horarioId,
      cantidadPersonas,
      fechas,
      fechaDesde,
      fechaHasta,
      diasSolicitados: fechas.length,
    };
  });
  if (diasExpandidos > 180) fail('invalid-argument', 'La requisicion supera 180 dias-renglon. Divide la solicitud en dos folios.');
  return result;
}

function partidasGuardadasRequisicion(row = {}) {
  if (Array.isArray(row.partidas) && row.partidas.length) return row.partidas;
  if (!row.puestoId || !row.horarioId) return [];
  return [{
    partidaId: 'legacy_1',
    puestoId: row.puestoId,
    puestoNombre: row.puestoNombre || '',
    horarioId: row.horarioId,
    horarioNombre: row.horarioNombre || '',
    horaInicio: row.horaInicio || '',
    horaFin: row.horaFin || '',
    cantidadPersonas: Number(row.cantidadPersonas || 0),
    fechas: fechasPeriodoRequisicion(row.fechaDesde || '', row.fechaHasta || ''),
    fechaDesde: row.fechaDesde || '',
    fechaHasta: row.fechaHasta || '',
    diasSolicitados: Number(row.diasSolicitados || 0),
  }];
}

export const requisicionesCrear = endpoint(async (req) => {
  const actor = await perfil(req.auth.uid);
  if (!requisicionPuedeSolicitar(actor)) fail('permission-denied', 'Esta cuenta no puede solicitar personal.');
  const propiedadId = String(req.data?.propiedadId || '').trim();
  if (!idValido(propiedadId)) fail('invalid-argument', 'Revisa la propiedad.');
  await autorizarPropiedad(actor, propiedadId);
  const departamentoSolicitante = textoLimitado(req.data?.departamentoSolicitante, 120, true, 'Departamento solicitante');
  const motivo = textoLimitado(req.data?.motivo, 120, true, 'Motivo');
  const descripcionCausa = textoLimitado(req.data?.descripcionCausa, 700, true, 'Descripcion de la causa');
  const formaPago = textoLimitado(req.data?.formaPago || 'Efectivo', 80, true, 'Forma de pago');
  const personasPropuestas = textoLimitado(req.data?.personasPropuestas, 1800, false, 'Personas propuestas');
  const partidasEntrada = normalizarPartidasRequisicion(req.data || {});
  const puestoIds = [...new Set(partidasEntrada.map((item) => item.puestoId))];
  const horarioIds = [...new Set(partidasEntrada.map((item) => item.horarioId))];
  const requestRef = db.collection('requisicionesPersonal').doc();
  const auditRef = db.collection('auditoria').doc();
  const year = new Date(Timestamp.now().toMillis()).getUTCFullYear();
  const counterRef = db.doc(`contadores/requisiciones_${propiedadId}_${year}`);

  return db.runTransaction(async (tx) => {
    const refs = [
      db.doc(`usuarios/${actor.id}`),
      db.doc(`propiedades/${propiedadId}`),
      counterRef,
      ...puestoIds.map((id) => db.doc(`puestos/${id}`)),
      ...horarioIds.map((id) => db.doc(`horarios/${id}`)),
    ];
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const freshActor = snaps[0];
    const propertySnap = snaps[1];
    const counterSnap = snaps[2];
    const puestoSnaps = snaps.slice(3, 3 + puestoIds.length);
    const horarioSnaps = snaps.slice(3 + puestoIds.length);
    const fresh = { ...(freshActor.data() || {}), id: actor.id };
    if (fresh.activo !== true || !requisicionPuedeSolicitar(fresh) || !puedeVerPropiedad(fresh, propiedadId)) {
      fail('permission-denied', 'Tus permisos cambiaron o no puedes solicitar para esta propiedad.');
    }
    if (!propertySnap.exists || propertySnap.data()?.activo !== true) fail('failed-precondition', 'La propiedad ya no esta activa.');
    const puestosMap = new Map();
    puestoSnaps.forEach((snap, index) => {
      if (!snap.exists || snap.data()?.activo === false) fail('failed-precondition', `El puesto ${puestoIds[index]} ya no esta activo.`);
      puestosMap.set(puestoIds[index], snap.data());
    });
    const horariosMap = new Map();
    horarioSnaps.forEach((snap, index) => {
      if (!snap.exists || snap.data()?.activo === false) fail('failed-precondition', `El horario ${horarioIds[index]} ya no esta activo.`);
      horariosMap.set(horarioIds[index], snap.data());
    });

    const partidas = partidasEntrada.map((item) => {
      const puesto = puestosMap.get(item.puestoId);
      const horario = horariosMap.get(item.horarioId);
      return {
        ...item,
        puestoNombre: puesto?.nombre || '',
        horarioNombre: horario?.nombre || '',
        horaInicio: horario?.horaInicio || '',
        horaFin: horario?.horaFin || '',
      };
    });
    const consecutivo = Number(counterSnap.data()?.ultimo || 0) + 1;
    const code = codigoFolioRequisicion(propertySnap.data()?.codigo || propiedadId);
    const folio = `REQ-${code}-${year}-${String(consecutivo).padStart(4, '0')}`;
    const now = Timestamp.now();
    const fechas = partidas.flatMap((item) => fechasPartidaRequisicion(item)).sort();
    const primera = partidas[0];
    const turnosPersonaSolicitados = partidas.reduce((sum, item) => sum + Number(item.cantidadPersonas) * Number(item.diasSolicitados), 0);
    const values = {
      folio,
      propiedadId,
      propiedadNombre: propertySnap.data()?.nombre || '',
      departamentoSolicitante,
      partidas,
      cantidadPartidas: partidas.length,
      turnosPersonaSolicitados,
      fechaDesde: fechas[0],
      fechaHasta: fechas.at(-1),
      puestoId: primera.puestoId,
      puestoNombre: partidas.length === 1 ? primera.puestoNombre : `${partidas.length} necesidades`,
      horarioId: primera.horarioId,
      horarioNombre: primera.horarioNombre,
      horaInicio: primera.horaInicio,
      horaFin: primera.horaFin,
      cantidadPersonas: primera.cantidadPersonas,
      diasSolicitados: new Set(partidas.flatMap((item) => fechasPartidaRequisicion(item))).size,
      motivo,
      descripcionCausa,
      formaPago,
      personasPropuestas,
      solicitanteId: actor.id,
      solicitanteNombre: fresh.nombre || fresh.correo || 'Solicitante',
      estado: 'pendiente_autorizacion',
      necesidadesIds: [],
      creadoEn: now,
      actualizadoEn: now,
      actualizadoPor: actor.id,
    };
    tx.set(counterRef, { ultimo: consecutivo, actualizadoEn: now }, { merge: true });
    tx.create(requestRef, values);
    tx.create(auditRef, {
      accion: 'crear_requisicion_personal',
      requisicionId: requestRef.id,
      folio,
      propiedadId,
      partidas: partidas.length,
      turnosPersonaSolicitados,
      por: actor.id,
      creadaEn: now,
    });
    return { requisicionId: requestRef.id, folio, estado: values.estado, partidas: partidas.length, turnosPersonaSolicitados };
  });
});

export const requisicionesAutorizar = endpoint(async (req) => {
  const actor = await perfil(req.auth.uid);
  if (!requisicionPuedeAutorizar(actor)) fail('permission-denied', 'Esta cuenta no puede autorizar requisiciones.');
  const requisicionId = String(req.data?.requisicionId || '').trim();
  if (!idValido(requisicionId)) fail('invalid-argument', 'Requisicion invalida.');
  const reqRef = db.doc(`requisicionesPersonal/${requisicionId}`);
  const initial = await reqRef.get();
  if (!initial.exists) fail('not-found', 'La requisicion ya no existe.');
  const current = initial.data();
  await autorizarPropiedad(actor, current.propiedadId);
  if (current.estado === 'autorizada') return { ok: true, repetido: true, necesidadesIds: current.necesidadesIds || [] };
  if (current.estado !== 'pendiente_autorizacion') fail('failed-precondition', 'La requisicion ya fue atendida.');
  const partidas = partidasGuardadasRequisicion(current);
  if (!partidas.length || partidas.length > 40) fail('failed-precondition', 'La requisicion no contiene necesidades validas.');

  const agregados = new Map();
  for (const partida of partidas) {
    if (![partida.puestoId, partida.horarioId].every(idValido)) fail('failed-precondition', 'La requisicion contiene un puesto u horario invalido.');
    const cantidad = Number(partida.cantidadPersonas || 0);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) fail('failed-precondition', 'La requisicion contiene una cantidad invalida.');
    const fechas = fechasPartidaRequisicion(partida);
    for (const fecha of fechas) {
      const id = `nec_${hash(`${current.propiedadId}\0${fecha}\0${partida.horarioId}\0${partida.puestoId}`)}`;
      const prev = agregados.get(id) || {
        id, fecha, puestoId: partida.puestoId, horarioId: partida.horarioId, cantidad: 0, partidas: [],
      };
      prev.cantidad += cantidad;
      prev.partidas.push({ partidaId: partida.partidaId || '', cantidad });
      agregados.set(id, prev);
    }
  }
  if (agregados.size > 180) fail('failed-precondition', 'La requisicion genera demasiadas necesidades para una sola autorizacion.');
  for (const item of agregados.values()) {
    if (item.cantidad > 100) fail('failed-precondition', `La necesidad del ${item.fecha} supera 100 personas dentro de la misma requisicion.`);
  }

  const targets = [...agregados.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.horarioId.localeCompare(b.horarioId) || a.puestoId.localeCompare(b.puestoId));
  const targetRefs = targets.map((item) => db.doc(`necesidadesPersonal/${item.id}`));
  const puestoIds = [...new Set(partidas.map((item) => item.puestoId))];
  const horarioIds = [...new Set(partidas.map((item) => item.horarioId))];
  const auditRef = db.collection('auditoria').doc();

  return db.runTransaction(async (tx) => {
    const readRefs = [
      db.doc(`usuarios/${actor.id}`), reqRef,
      db.doc(`propiedades/${current.propiedadId}`),
      ...horarioIds.map((id) => db.doc(`horarios/${id}`)),
      ...puestoIds.map((id) => db.doc(`puestos/${id}`)),
      ...targetRefs,
    ];
    const snaps = await Promise.all(readRefs.map((ref) => tx.get(ref)));
    let offset = 0;
    const freshActor = snaps[offset++];
    const freshReq = snaps[offset++];
    const propertySnap = snaps[offset++];
    const horarioSnaps = snaps.slice(offset, offset + horarioIds.length); offset += horarioIds.length;
    const puestoSnaps = snaps.slice(offset, offset + puestoIds.length); offset += puestoIds.length;
    const needSnaps = snaps.slice(offset);
    const fresh = { ...(freshActor.data() || {}), id: actor.id };
    if (fresh.activo !== true || !requisicionPuedeAutorizar(fresh) || !puedeVerPropiedad(fresh, current.propiedadId)) {
      fail('permission-denied', 'Tus permisos cambiaron o no puedes autorizar esta propiedad.');
    }
    if (!freshReq.exists) fail('not-found', 'La requisicion ya no existe.');
    const requisicion = freshReq.data();
    if (requisicion.estado === 'autorizada') return { ok: true, repetido: true, necesidadesIds: requisicion.necesidadesIds || [] };
    if (requisicion.estado !== 'pendiente_autorizacion') fail('failed-precondition', 'La requisicion ya fue atendida.');
    if (!propertySnap.exists || propertySnap.data()?.activo !== true) fail('failed-precondition', 'La propiedad ya no esta activa.');

    const horariosMap = new Map();
    horarioSnaps.forEach((snap, index) => {
      if (!snap.exists || snap.data()?.activo === false) fail('failed-precondition', `El horario ${horarioIds[index]} ya no esta activo.`);
      horariosMap.set(horarioIds[index], snap.data());
    });
    const puestosMap = new Map();
    puestoSnaps.forEach((snap, index) => {
      if (!snap.exists || snap.data()?.activo === false) fail('failed-precondition', `El puesto ${puestoIds[index]} ya no esta activo.`);
      puestosMap.set(puestoIds[index], snap.data());
    });

    const now = Timestamp.now();
    let creadas = 0;
    let actualizadas = 0;
    targets.forEach((target, index) => {
      const snap = needSnaps[index];
      const ref = targetRefs[index];
      const old = snap.exists ? snap.data() : null;
      const activa = old && old.activo !== false;
      const cantidadAnterior = activa ? Number(old.cantidadNecesaria || 0) : 0;
      const nuevaCantidad = cantidadAnterior + target.cantidad;
      if (nuevaCantidad > 100) fail('failed-precondition', `La necesidad del ${target.fecha} superaria 100 personas.`);
      const horario = horariosMap.get(target.horarioId);
      const puesto = puestosMap.get(target.puestoId);
      const dur = datosDuracionHorario(horario.horaInicio, horario.horaFin);
      const tarifaActual = Number(puesto.tarifaHora || 0);
      if (!Number.isFinite(tarifaActual) || tarifaActual < 0) fail('failed-precondition', `La tarifa de ${puesto.nombre || target.puestoId} no es valida.`);
      const minutosDuracion = activa && Number.isFinite(Number(old.minutosDuracion)) ? Number(old.minutosDuracion) : dur.minutosDuracion;
      const tarifaHora = activa && Number.isFinite(Number(old.tarifaHora)) ? Number(old.tarifaHora) : tarifaActual;
      const origins = activa && Array.isArray(old.requisicionesOrigen) ? old.requisicionesOrigen.filter((item) => item?.requisicionId !== requisicionId) : [];
      origins.push({ requisicionId, folio: requisicion.folio || '', cantidad: target.cantidad, partidas: target.partidas });
      tx.set(ref, {
        propiedadId: requisicion.propiedadId,
        propiedadNombre: propertySnap.data()?.nombre || requisicion.propiedadNombre || '',
        fecha: target.fecha,
        horarioId: target.horarioId,
        horarioNombre: activa ? (old.horarioNombre || horario.nombre || '') : (horario.nombre || ''),
        horaInicio: activa ? (old.horaInicio || horario.horaInicio || '') : (horario.horaInicio || ''),
        horaFin: activa ? (old.horaFin || horario.horaFin || '') : (horario.horaFin || ''),
        minutosDuracion,
        cruzaDia: activa ? old.cruzaDia === true : dur.cruzaDia,
        puestoId: target.puestoId,
        puestoNombre: activa ? (old.puestoNombre || puesto.nombre || '') : (puesto.nombre || ''),
        tarifaHora,
        cantidadNecesaria: nuevaCantidad,
        costoEstimado: Math.round((minutosDuracion / 60) * tarifaHora * nuevaCantidad * 100) / 100,
        observaciones: activa ? (old.observaciones || '') : `Requisicion ${requisicion.folio || requisicionId}`,
        requisicionesOrigen: origins,
        activo: true,
        actualizadoEn: now,
        actualizadoPor: actor.id,
        ...(!activa ? { creadoEn: now, creadoPor: actor.id } : {}),
      }, { merge: true });
      if (activa) actualizadas += 1; else creadas += 1;
    });

    const targetIds = targets.map((item) => item.id);
    const turnosPersonaSolicitados = partidas.reduce((sum, item) => sum + Number(item.cantidadPersonas || 0) * fechasPartidaRequisicion(item).length, 0);
    tx.set(reqRef, {
      estado: 'autorizada',
      autorizadoPor: actor.id,
      autorizadoPorNombre: fresh.nombre || fresh.correo || 'Autorizador',
      autorizadoEn: now,
      necesidadesIds: targetIds,
      actualizadoEn: now,
      actualizadoPor: actor.id,
    }, { merge: true });
    tx.create(auditRef, {
      accion: 'autorizar_requisicion_personal',
      requisicionId,
      folio: requisicion.folio || '',
      propiedadId: requisicion.propiedadId,
      necesidadesIds: targetIds,
      partidas: partidas.length,
      turnosPersonaSolicitados,
      por: actor.id,
      creadaEn: now,
    });
    return { ok: true, requisicionId, necesidadesIds: targetIds, creadas, actualizadas, partidas: partidas.length, turnosPersonaSolicitados };
  });
});

export const requisicionesRechazar = endpoint(async (req) => {
  const actor = await perfil(req.auth.uid);
  if (!requisicionPuedeAutorizar(actor)) fail('permission-denied', 'Esta cuenta no puede rechazar requisiciones.');
  const requisicionId = String(req.data?.requisicionId || '').trim();
  const motivoRechazo = textoLimitado(req.data?.motivoRechazo, 500, true, 'Motivo de rechazo');
  if (!idValido(requisicionId)) fail('invalid-argument', 'Requisicion invalida.');
  const ref = db.doc(`requisicionesPersonal/${requisicionId}`);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'La requisicion ya no existe.');
  await autorizarPropiedad(actor, snap.data()?.propiedadId);
  const now = Timestamp.now();
  return db.runTransaction(async (tx) => {
    const [freshActor, freshReq] = await Promise.all([
      tx.get(db.doc(`usuarios/${actor.id}`)), tx.get(ref),
    ]);
    const fresh = { ...(freshActor.data() || {}), id: actor.id };
    if (!freshReq.exists) fail('not-found', 'La requisicion ya no existe.');
    const row = freshReq.data();
    if (fresh.activo !== true || !requisicionPuedeAutorizar(fresh) || !puedeVerPropiedad(fresh, row.propiedadId)) fail('permission-denied', 'Tus permisos cambiaron.');
    if (row.estado !== 'pendiente_autorizacion') fail('failed-precondition', 'La requisicion ya fue atendida.');
    tx.set(ref, {
      estado: 'rechazada', motivoRechazo,
      rechazadoPor: actor.id,
      rechazadoPorNombre: fresh.nombre || fresh.correo || 'Autorizador',
      rechazadoEn: now,
      actualizadoEn: now,
      actualizadoPor: actor.id,
    }, { merge: true });
    tx.create(db.collection('auditoria').doc(), {
      accion: 'rechazar_requisicion_personal', requisicionId,
      folio: row.folio || '', propiedadId: row.propiedadId,
      motivoRechazo, por: actor.id, creadaEn: now,
    });
    return { ok: true, requisicionId };
  });
});

function serializarRevision(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializarRevision);
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,serializarRevision(v)]));
  return value;
}
function tipoRespaldo(bytes) {
  if (bytes.subarray(0,5).toString()==='%PDF-') return 'application/pdf';
  if (bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  return '';
}
export const asistenciaCargarRespaldo = endpoint(async req => {
  const actor=await administradorORHResolverEventuales(req.auth.uid);
  const {solicitudId,empleadoId,propiedadId,contenido,nombre='respaldo'}=req.data || {};
  if (![solicitudId,empleadoId,propiedadId].every(idValido) || typeof contenido!=='string' || contenido.length > Math.ceil(MAX_RESPALDO_BYTES/3)*4+8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(contenido)) fail('invalid-argument','Adjunta PDF, JPG o PNG hasta 4 MB.');
  await autorizarPropiedad(actor,propiedadId);
  const emp=await db.doc(`asistenciaPersonal/${empleadoId}`).get();
  if (!emp.exists || emp.data().tipo!=='eventual' || !personalPuedeOperarEnPropiedad(emp.data(),propiedadId)) fail('failed-precondition','Eventual no disponible en esta propiedad.');
  const bytes=Buffer.from(contenido,'base64'),mime=tipoRespaldo(bytes);
  if (!mime || bytes.length===0 || bytes.length>MAX_RESPALDO_BYTES) fail('invalid-argument','Documento no valido. Usa PDF, JPG o PNG hasta 4 MB.');
  const digest=createHash('sha256').update(bytes).digest('hex');
  const ref=db.doc(`asistenciaRespaldos/${solicitudId}`),path=`asistenciaRespaldos/${propiedadId}/${empleadoId}/${actor.id}/${solicitudId}`;
  const prior=await ref.get();
  if (prior.exists) {
    const d=prior.data();
    if (d.por!==actor.id || d.empleadoId!==empleadoId || d.propiedadId!==propiedadId || d.sha256!==digest) fail('already-exists','El respaldo ya corresponde a otra operacion.');
    return {respaldoId:solicitudId};
  }
  // Private object: no download token, no public ACL; never overwrite evidence.
  const file=getStorage().bucket().file(path);
  try {
    await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:mime,cacheControl:'private, no-store',metadata:{por:actor.id,empleadoId,propiedadId,solicitudId,sha256:digest}}});
  } catch (e) {
    if (Number(e.code)!==412) throw e;
    const [m]=await file.getMetadata();
    if (m.metadata?.sha256!==digest || m.metadata?.por!==actor.id) fail('already-exists','Ya existe otra evidencia para esta operacion.');
  }
  const [metadata]=await file.getMetadata();
  await db.runTransaction(async tx=>{
    const old=await tx.get(ref);
    if(old.exists) {
      if(old.data().sha256!==digest || old.data().por!==actor.id) fail('already-exists','Respaldo incompatible.');
      return;
    }
    tx.create(ref,{path,mime,nombre:String(nombre).replace(/[\r\n/\\]/g,'_').slice(0,120),bytes:bytes.length,sha256:digest,generation:String(metadata.generation || ''),empleadoId,propiedadId,por:actor.id,porNombre:actor.nombre || '',creadoEn:Timestamp.now(),estado:'cargado'});
  });
  return {respaldoId:solicitudId};
});
export const asistenciaLimitesRevision = endpoint(async req => {
  await actorConPermiso(req.auth.uid,PERMISOS.REPORTES_EVENTUALES);
  const limites=await limitesAsistencia();
  return {limiteHoras:limites.eventual};
});
export const asistenciaGuardarJornadaConRespaldo = endpoint(async req => {
  const actor=await administradorORHResolverEventuales(req.auth.uid);
  const {solicitudId,jornadaId='',empleadoId,propiedadId,entradaLocal,salidaLocal='',puestoId,motivo='',respaldoId,accion='corregir',versionEsperada=0,confirmarExcepcion=false}=req.data || {};
  if (![solicitudId,empleadoId,propiedadId,respaldoId].every(idValido) || (jornadaId && !idValido(jornadaId)) || !['corregir','sin_salida'].includes(accion) || typeof motivo!=='string' || motivo.trim().length<10 || motivo.length>1000) fail('invalid-argument','Completa los datos, el motivo (10 caracteres) y un respaldo obligatorio.');
  if (!jornadaId && accion==='sin_salida') fail('invalid-argument','El alta manual requiere entrada y salida reales.');
  await autorizarPropiedad(actor,propiedadId);
  const soporteRef=db.doc(`asistenciaRespaldos/${respaldoId}`),soporte=await soporteRef.get();
  if (!soporte.exists || soporte.data().por!==actor.id || soporte.data().empleadoId!==empleadoId || soporte.data().propiedadId!==propiedadId) fail('failed-precondition','Falta un respaldo propio y valido para esta persona y propiedad.');
  const [meta]=await getStorage().bucket().file(soporte.data().path).getMetadata();
  if (String(meta.generation || '')!==soporte.data().generation || Number(meta.size)!==soporte.data().bytes) fail('failed-precondition','El archivo de respaldo fue modificado o no esta disponible.');
  const id=jornadaId || `manual_${solicitudId}`;
  const ref=db.doc(`asistenciaJornadas/${id}`),auditRef=db.doc(`asistenciaAuditoria/revision_${solicitudId}`),stateRef=db.doc(`asistenciaEstado/${empleadoId}`);
  const limites=await limitesAsistencia();
  const huella=hash(JSON.stringify({jornadaId,empleadoId,propiedadId,entradaLocal,salidaLocal,puestoId,motivo:motivo.trim(),respaldoId,accion,confirmarExcepcion}));
  return db.runTransaction(async tx=>{
    const [fresh,property,emp,oldSnap,stateSnap,evidence,prior] = await Promise.all([
      tx.get(db.doc(`usuarios/${actor.id}`)),tx.get(db.doc(`propiedades/${propiedadId}`)),tx.get(db.doc(`asistenciaPersonal/${empleadoId}`)),tx.get(ref),tx.get(stateRef),tx.get(soporteRef),tx.get(auditRef)]);
    if (fresh.data()?.activo!==true || (fresh.data()?.rol!=='administrador' && !tienePermiso(fresh.data(),PERMISOS.RESOLVER_TURNOS_EVENTUALES)) || !puedeVerPropiedad(fresh.data(),propiedadId)) fail('permission-denied','Tus permisos cambiaron.');
    if (prior.exists) {
      if(prior.data().por!==actor.id || prior.data().huella!==huella) fail('already-exists','La solicitud ya se utilizo para otra correccion.');
      return {ok:true,jornadaId:id,repetido:true};
    }
    if (!evidence.exists || evidence.data().estado!=='cargado' || evidence.data().por!==actor.id) fail('failed-precondition','El respaldo ya fue utilizado.');
    if (!property.exists || property.data().activo!==true || !emp.exists || emp.data().tipo!=='eventual' || !personalPuedeOperarEnPropiedad(emp.data(),propiedadId)) fail('failed-precondition','Revisa persona y propiedad.');
    const old=oldSnap.data() || {},person=emp.data();
    if (jornadaId && (!oldSnap.exists || old.tipoPersonal!=='eventual' || old.empleadoId!==empleadoId || old.propiedadId!==propiedadId)) fail('failed-precondition','La jornada no corresponde a la persona o propiedad.');
    if (!jornadaId && oldSnap.exists) fail('already-exists','La jornada manual ya existe.');
    if (jornadaId && (tiempoMs(old.actualizadoEn) || 0)!==Number(versionEsperada)) fail('aborted','La jornada cambio. Actualiza el reporte antes de editar.');
    if (old.pagado===true || old.nominaCerrada===true || old.bloqueada===true) fail('failed-precondition','La jornada esta bloqueada o pagada; requiere un ajuste separado.');
    const zone=old.zonaHoraria || property.data().asistencia?.zonaHoraria || 'America/Mexico_City';
    let inicio,fin;
    try { inicio=fechaHoraLocalAMs(entradaLocal,zone); fin=accion==='sin_salida'?null:fechaHoraLocalAMs(salidaLocal,zone); } catch(e) { fail('invalid-argument',e.message); }
    const now=Timestamp.now();
    if(inicio>now.toMillis() || (fin!==null && (fin>now.toMillis() || fin<=inicio))) fail('invalid-argument','La salida debe ser posterior a la entrada y ninguna fecha puede estar en el futuro.');
    if(fin!==null && fin-inicio>72*3600000) fail('invalid-argument','La jornada excede 72 horas. Verifica el documento y las fechas.');
    if(fin!==null && fin-inicio>=limites.eventual*3600000 && confirmarExcepcion!==true) fail('failed-precondition',`Confirma expresamente la excepcion de ${limites.eventual} horas o mas con respaldo.`);
    const chosen=String(puestoId || old.puestoId || person.puestoId || '');
    if(!idValido(chosen)) fail('invalid-argument','Selecciona el puesto realmente desempenado.');
    const puesto=await tx.get(db.doc(`puestos/${chosen}`));
    if(!puesto.exists || (puesto.data().activo===false && chosen!==old.puestoId)) fail('failed-precondition','Puesto no disponible.');
    // Check all this person's shifts (bounded); revisions are exceptional operations.
    const other=await tx.get(db.collection('asistenciaJornadas').where('empleadoId','==',empleadoId).limit(2001));
    if(other.size>2000) fail('resource-exhausted','El historial es demasiado amplio; requiere revision de Sistemas.');
    const candidate={inicio,fin:fin ?? inicio+1};
    for(const doc of other.docs) {
      if(doc.id===id) continue;
      const j=doc.data(),a=tiempoMs(j.entradaEn),b=tiempoMs(j.salidaEn);
      if(a===null) continue;
      const end=b ?? (['abierta','salida_pendiente'].includes(j.estado)?now.toMillis():a);
      if(end>a && seTraslapan(candidate,{inicio:a,fin:end})) fail('failed-precondition','Las horas se traslapan con otra jornada. Revisa primero el registro conflictivo.');
    }
    const mismaTarifa=jornadaId && chosen===old.puestoId && Number.isFinite(Number(old.tarifaHoraAplicada)) && old.tarifaHoraAplicada!==null;
    const tarifa=mismaTarifa?Number(old.tarifaHoraAplicada):Number(puesto.data().tarifaHora || 0);
    const values={empleadoId,empleadoNombre:person.nombre,claveEmpleado:person.clave || '',tipoPersonal:'eventual',propiedadId,propiedadNombre:property.data().nombre || '',zonaHoraria:zone,fechaJornada:fechaEnZona(new Date(inicio),zone),entradaEn:Timestamp.fromMillis(inicio),salidaEn:fin===null?null:Timestamp.fromMillis(fin),minutos:fin===null?null:Math.floor((fin-inicio)/60000),puestoId:chosen,puestoNombre:puesto.data().nombre || '',tarifaHoraAplicada:tarifa,puestoHabitualId:old.puestoHabitualId || person.puestoId || '',origenTarifa:mismaTarifa?(old.origenTarifa || 'historica_conservada'):'puesto_corregido_con_respaldo',estado:fin===null?'sin_salida':'corregida',revisionValidada:fin!==null,requiereRevision:false,limiteRevisionHoras:limites.eventual,respaldoId,corregidaEn:now,corregidaPor:actor.id,corregidaPorNombre:actor.nombre || '',motivoCorreccion:motivo.trim(),resueltoAdministrativamente:true,origen:jornadaId?(old.origen || 'seguridad_gmr'):'alta_manual_con_respaldo',actualizadoEn:now};
    const fields=['entradaEn','salidaEn','minutos','puestoId','puestoNombre','tarifaHoraAplicada','fechaJornada','estado','origenTarifa'];
    const anterior=Object.fromEntries(fields.map(k=>[k,old[k] ?? null]));
    const nuevo=Object.fromEntries(fields.map(k=>[k,values[k] ?? null]));
    tx.set(ref,{...values,...(!jornadaId?{creadaEn:now,entradaRegistradaPor:actor.id,salidaRegistradaPor:actor.id}:{}),originalesPrimeraCorreccion:old.originalesPrimeraCorreccion || anterior},{merge:true});
    // State write serializes simultaneous manual corrections and kiosk entries.
    const st=stateSnap.data() || {};
    tx.set(stateRef,{actualizadoEn:now,...(st.jornadaAbiertaId===id?{jornadaAbiertaId:null}:{}),...(st.ultimaJornadaCerradaId===id?{ultimaSalidaEn:values.salidaEn}:{} )},{merge:true});
    tx.update(soporteRef,{estado:'vinculado',jornadaId:id,auditoriaId:auditRef.id,vinculadoEn:now});
    tx.create(auditRef,{jornadaId:id,empleadoId,propiedadId,accion:jornadaId?'correccion_con_respaldo':'alta_manual_con_respaldo',anterior,nuevo,motivo:motivo.trim(),respaldoId,por:actor.id,porNombre:actor.nombre || '',creadaEn:now,huella});
    return {ok:true,jornadaId:id,estado:values.estado,repetido:false};
  });
});
export const asistenciaHistorialRevision = endpoint(async req=>{
  const actor=await administradorORHResolverEventuales(req.auth.uid),id=String(req.data?.jornadaId || '');
  if(!idValido(id)) fail('invalid-argument','Jornada invalida.');
  const snap=await db.doc(`asistenciaJornadas/${id}`).get();
  if(!snap.exists || snap.data().tipoPersonal!=='eventual') fail('not-found','Jornada no encontrada.');
  await autorizarPropiedad(actor,snap.data().propiedadId);
  const audits=await db.collection('asistenciaAuditoria').where('jornadaId','==',id).get();
  return {historial:audits.docs.map(d=>({id:d.id,...serializarRevision(d.data())})).sort((a,b)=>String(b.creadaEn).localeCompare(String(a.creadaEn)))};
});
export const asistenciaDescargarRespaldo = endpoint(async req=>{
  const actor=await administradorORHResolverEventuales(req.auth.uid),id=String(req.data?.respaldoId || '');
  if(!idValido(id)) fail('invalid-argument','Respaldo invalido.');
  const snap=await db.doc(`asistenciaRespaldos/${id}`).get();
  if(!snap.exists) fail('not-found','Respaldo no encontrado.');
  const d=snap.data(); await autorizarPropiedad(actor,d.propiedadId);
  if(d.estado!=='vinculado' && d.por!==actor.id) fail('permission-denied','Respaldo no vinculado.');
  const [bytes]=await getStorage().bucket().file(d.path).download();
  return {nombre:d.nombre,mime:d.mime,contenido:bytes.toString('base64')};
});

export const asistenciaEnviarTurnoRevision = endpoint(async req=>{
  const actor=await perfil(req.auth.uid);
  if(!puedeRegistrarAsistencia(actor)) fail('permission-denied','Este perfil no puede operar asistencia.');
  const {solicitudId,empleadoId,propiedadId,jornadaPendienteId}=req.data || {};
  if(![solicitudId,empleadoId,propiedadId,jornadaPendienteId].every(idValido)) fail('invalid-argument','Vuelve a escanear a la persona.');
  await autorizarPropiedad(actor,propiedadId);
  const limites=await limitesAsistencia(),ref=db.doc(`asistenciaJornadas/${jornadaPendienteId}`),stateRef=db.doc(`asistenciaEstado/${empleadoId}`),audit=db.doc(`asistenciaAuditoria/pendiente_${solicitudId}`);
  return db.runTransaction(async tx=>{
    const [fresh,js,ss,prior]=await Promise.all([tx.get(db.doc(`usuarios/${actor.id}`)),tx.get(ref),tx.get(stateRef),tx.get(audit)]);
    if(!puedeRegistrarAsistencia(fresh.data())||!puedeVerPropiedad(fresh.data(),propiedadId))fail('permission-denied','Tus permisos cambiaron.');
    if(prior.exists){if(prior.data().por!==actor.id||prior.data().jornadaId!==jornadaPendienteId)fail('already-exists','Identificador de otra operacion.');return {ok:true,repetido:true};}
    const j=js.data(),now=Timestamp.now();
    if(!js.exists||j.tipoPersonal!=='eventual'||j.empleadoId!==empleadoId||j.propiedadId!==propiedadId||j.salidaEn||ss.data()?.jornadaAbiertaId!==jornadaPendienteId)fail('failed-precondition','El turno cambio o pertenece a otra propiedad. Actualiza la consulta.');
    if((horasTranscurridasJornada(j,now.toMillis()) ?? 0)<limites.eventual)fail('failed-precondition','El turno todavia no vence.');
    tx.update(ref,{estado:'sin_salida',salidaEn:null,minutos:null,requiereRevision:true,limiteRevisionHoras:limites.eventual,motivoCierre:'pendiente_revision_rh',enviadaRevisionPor:actor.id,enviadaRevisionEn:now,actualizadoEn:now});
    tx.set(stateRef,{jornadaAbiertaId:null,actualizadoEn:now},{merge:true});
    tx.create(audit,{jornadaId:jornadaPendienteId,empleadoId,propiedadId,accion:'enviar_a_revision',anterior:{estado:j.estado,salidaEn:null},nuevo:{estado:'sin_salida',salidaEn:null},motivo:'Seguridad libera el turno vencido para revision de RH. No se registra salida ni una nueva entrada.',por:actor.id,porNombre:actor.nombre || '',creadaEn:now});
    return {ok:true,repetido:false};
  });
});
