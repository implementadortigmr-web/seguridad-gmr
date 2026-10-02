import { PERMISOS, tienePermiso } from './perfilesAcceso.js';

export const TIPOS_PERSONAL = ['eventual', 'practicante', 'personal_mexico'];
export const MODULO_ASISTENCIA = 'asistencia';
export const MAX_FOTO_BYTES = 2 * 1024 * 1024;
export const HORAS_CIERRE_MEXICO_DEFAULT = 16;
export const HORAS_PENDIENTE_EVENTUAL_DEFAULT = 16;
export const HORAS_PENDIENTE_PRACTICANTE_DEFAULT = 16;
export const MINUTOS_REAPERTURA_TURNO_DEFAULT = 60;
export const PIN_MEXICO_DIGITOS = 4;

export function permisosPropiedades(profile) {
  const explicit = Array.isArray(profile?.propiedadesPermitidas)
    ? profile.propiedadesPermitidas.filter((x) => typeof x === 'string' && x.length)
    : [];
  if (explicit.length) return [...new Set(explicit)];
  const id = profile?.propiedadId;
  return typeof id === 'string' && id && id !== 'todas' ? [id] : [];
}

export function propiedadesPersonal(persona) {
  const explicit = Array.isArray(persona?.propiedadesPermitidas)
    ? persona.propiedadesPermitidas.filter((x) => typeof x === 'string' && x.length)
    : [];
  if (explicit.length) return [...new Set(explicit)];
  return persona?.propiedadId ? [persona.propiedadId] : [];
}

export function personalPuedeOperarEnPropiedad(persona, propiedadId) {
  return Boolean(propiedadId) && propiedadesPersonal(persona).includes(propiedadId);
}

export function tieneModuloAsistencia(profile) {
  if (profile?.activo !== true) return false;
  return [
    PERMISOS.ADMINISTRAR_PERSONAL,
    PERMISOS.ADMINISTRAR_PUESTOS,
    PERMISOS.REPORTES_EVENTUALES,
    PERMISOS.REPORTES_PRACTICANTES,
    PERMISOS.REPORTES_MEXICO,
    PERMISOS.OPERAR_ASISTENCIA,
  ].some((permiso) => tienePermiso(profile, permiso));
}

export function puedeConsultarReportes(profile) {
  if (profile?.activo !== true) return false;
  return [
    PERMISOS.REPORTES_EVENTUALES,
    PERMISOS.REPORTES_PRACTICANTES,
    PERMISOS.REPORTES_MEXICO,
  ].some((permiso) => tienePermiso(profile, permiso));
}

export function puedeAdministrarPersonal(profile) {
  return profile?.activo === true && tienePermiso(profile, PERMISOS.ADMINISTRAR_PERSONAL);
}

export function puedeAdministrarPuestos(profile) {
  return profile?.activo === true && tienePermiso(profile, PERMISOS.ADMINISTRAR_PUESTOS);
}

export function puedeRegistrarAsistencia(profile) {
  return profile?.activo === true
    && ['guardia', 'asistencia'].includes(profile.rol)
    && tienePermiso(profile, PERMISOS.OPERAR_ASISTENCIA);
}

export function puedeVerPropiedad(profile, propiedadId) {
  if (!propiedadId || profile?.activo !== true) return false;
  if (profile.rol === 'administrador') return true;
  const permisos = permisosPropiedades(profile);
  if (profile.rol === 'asistencia') {
    return permisos.length === 1 && permisos[0] === propiedadId;
  }
  return permisos.includes('*') || permisos.includes(propiedadId);
}

export function normalizarClave(valor) {
  return String(valor ?? '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toUpperCase();
}


export function validarPinMexico(valor) {
  const pin = String(valor ?? '').trim();
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('El PIN debe tener 4 digitos.');
  }
  return pin;
}

export function validarPersonal(data) {
  const clave = normalizarClave(data?.clave);
  if (!/^[A-Z0-9_-]{1,32}$/.test(clave)) {
    throw new Error('La clave interna no es valida.');
  }

  const nombre = String(data?.nombre ?? '').trim();
  if (!nombre || nombre.length > 160) {
    throw new Error('Captura un nombre de hasta 160 caracteres.');
  }

  if (!TIPOS_PERSONAL.includes(data?.tipo)) {
    throw new Error('Tipo de personal no permitido.');
  }

  const area = String(data.area ?? '').trim();
  const telefono = String(data.telefono ?? '').trim();
  if (area.length > 100 || telefono.length > 40) {
    throw new Error('Revisa area y telefono.');
  }

  const propiedadesPermitidas = Array.isArray(data?.propiedadesPermitidas)
    ? [...new Set(data.propiedadesPermitidas.filter((x) => typeof x === 'string' && x.length))]
    : [];

  const base = {
    clave,
    nombre,
    tipo: data.tipo,
    area,
    telefono,
    activo: data.activo !== false,
    qr: clave,
    propiedadesPermitidas,
  };

  if (data.tipo === 'eventual') {
    const puestoId = String(data.puestoId ?? '').trim();
    if (!puestoId) throw new Error('Selecciona un puesto para el eventual.');

    const tarifaPersonalizada =
      data.tarifaPersonalizada === '' || data.tarifaPersonalizada == null
        ? null
        : Number(data.tarifaPersonalizada);

    if (
      tarifaPersonalizada !== null
      && (!Number.isFinite(tarifaPersonalizada) || tarifaPersonalizada < 0)
    ) {
      throw new Error('La tarifa personalizada no es valida.');
    }

    return { ...base, puestoId, tarifaPersonalizada };
  }

  if (data.tipo === 'practicante') {
    const school = String(data.school ?? '').trim();
    const career = String(data.career ?? '').trim();
    const supervisor = String(data.supervisor ?? '').trim();
    const startDate = String(data.startDate ?? '').trim();
    const endDate = String(data.endDate ?? '').trim();
    const targetHours = Number(data.targetHours ?? 0);
    const initialAccumulatedHours = Number(data.initialAccumulatedHours ?? 0);

    if (!school || !career || !supervisor) {
      throw new Error('Completa escuela, carrera y responsable.');
    }
    if (!Number.isFinite(targetHours) || targetHours <= 0) {
      throw new Error('Las horas por cumplir deben ser mayores a cero.');
    }
    if (!Number.isFinite(initialAccumulatedHours) || initialAccumulatedHours < 0) {
      throw new Error('Las horas previas no son validas.');
    }

    return {
      ...base,
      school,
      career,
      supervisor,
      startDate,
      endDate,
      targetHours,
      initialAccumulatedHours,
    };
  }

  return base;
}

export function fechaEnZona(date, timeZone = 'America/Mexico_City') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function tipoRequiereFoto(propiedad, tipoMovimiento) {
  return propiedad?.asistencia?.[
    tipoMovimiento === 'entrada' ? 'fotoEntrada' : 'fotoSalida'
  ] === true;
}


export function inicioJornadaMs(jornada) {
  const value = jornada?.entradaEn;
  const ms = value?.toMillis?.() ?? (value ? new Date(value).getTime() : NaN);
  return Number.isFinite(ms) ? ms : NaN;
}

export function horasTranscurridasJornada(jornada, ahoraMs = Date.now()) {
  const inicio = inicioJornadaMs(jornada);
  if (!Number.isFinite(inicio) || !Number.isFinite(ahoraMs) || ahoraMs < inicio) return null;
  return (ahoraMs - inicio) / 3600000;
}

export function validarTransicion({
  tipo,
  empleado,
  estado,
  jornada,
  jornadaEsperadaId,
  ahoraMs,
}) {
  if (!['entrada', 'salida'].includes(tipo)) {
    throw new Error('Movimiento no permitido.');
  }

  if (tipo === 'entrada') {
    if (!empleado?.activo) throw new Error('El empleado esta inactivo.');
    if (estado?.jornadaAbiertaId) {
      throw new Error('Ya existe una entrada sin salida. No se creo otra entrada.');
    }
    return;
  }

  if (!estado?.jornadaAbiertaId || !jornada) {
    throw new Error('No hay una entrada abierta para registrar salida.');
  }
  if (estado.jornadaAbiertaId !== jornadaEsperadaId) {
    throw new Error('La jornada cambio. Actualiza la consulta antes de registrar la salida.');
  }
  if (jornada.salidaEn) throw new Error('La jornada ya tiene salida.');

  const inicioMs = jornada.entradaEn?.toMillis?.()
    ?? new Date(jornada.entradaEn).getTime();

  if (!Number.isFinite(inicioMs) || ahoraMs < inicioMs) {
    throw new Error('La hora de entrada no es valida. Requiere revision.');
  }

}
