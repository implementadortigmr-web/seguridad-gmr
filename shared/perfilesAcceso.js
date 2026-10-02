export const PERMISOS = {
  ADMINISTRAR_PERSONAL: 'configuracion.personal',
  ADMINISTRAR_PUESTOS: 'configuracion.puestos',
  ADMINISTRAR_HORARIOS: 'configuracion.horarios',
  PLANEACION_PERSONAL: 'rh.planeacion_personal',
  RESOLVER_TURNOS_EVENTUALES: 'asistencia.resolver_turnos_eventuales',
  REPORTES_RECORRIDOS: 'reportes.recorridos',
  REPORTES_INCIDENCIAS: 'reportes.incidencias',
  REPORTES_EVENTUALES: 'reportes.eventuales',
  REPORTES_PRACTICANTES: 'reportes.practicantes',
  REPORTES_MEXICO: 'reportes.mexico',
  OPERAR_RECORRIDOS: 'operacion.recorridos',
  OPERAR_INCIDENCIAS: 'operacion.incidencias',
  OPERAR_ASISTENCIA: 'operacion.asistencia',
};

export const CATALOGO_PERMISOS = [
  { value: PERMISOS.ADMINISTRAR_PERSONAL, label: 'Administrar Eventuales y Practicantes', grupo: 'Asistencia / RH' },
  { value: PERMISOS.ADMINISTRAR_PUESTOS, label: 'Crear y modificar puestos y tarifas', grupo: 'Asistencia / RH' },
  { value: PERMISOS.ADMINISTRAR_HORARIOS, label: 'Crear y modificar horarios', grupo: 'Planeación de personal' },
  { value: PERMISOS.PLANEACION_PERSONAL, label: 'Programar necesidades y asignar Eventuales', grupo: 'Planeación de personal' },
  { value: PERMISOS.RESOLVER_TURNOS_EVENTUALES, label: 'Resolver y corregir turnos de Eventuales', grupo: 'Asistencia / RH' },
  { value: PERMISOS.REPORTES_EVENTUALES, label: 'Reporte semanal de Eventuales y pagos', grupo: 'Asistencia / RH' },
  { value: PERMISOS.REPORTES_PRACTICANTES, label: 'Reporte de Practicantes', grupo: 'Asistencia / RH' },
  { value: PERMISOS.REPORTES_MEXICO, label: 'Asistencia México', grupo: 'Asistencia / RH' },
  { value: PERMISOS.REPORTES_RECORRIDOS, label: 'Reportes de recorridos', grupo: 'Seguridad' },
  { value: PERMISOS.REPORTES_INCIDENCIAS, label: 'Reportes de incidencias', grupo: 'Seguridad' },
  { value: PERMISOS.OPERAR_RECORRIDOS, label: 'Operar recorridos en APK', grupo: 'Operación APK' },
  { value: PERMISOS.OPERAR_INCIDENCIAS, label: 'Registrar incidencias en APK', grupo: 'Operación APK' },
  { value: PERMISOS.OPERAR_ASISTENCIA, label: 'Registrar asistencia en APK', grupo: 'Operación APK' },
];


export const PERMISOS_MAXIMOS_ROL = {
  administrador: ['*'],
  supervisor: [
    PERMISOS.REPORTES_RECORRIDOS,
    PERMISOS.REPORTES_INCIDENCIAS,
  ],
  rh: [
    PERMISOS.ADMINISTRAR_PERSONAL,
    PERMISOS.ADMINISTRAR_PUESTOS,
    PERMISOS.ADMINISTRAR_HORARIOS,
    PERMISOS.PLANEACION_PERSONAL,
    PERMISOS.RESOLVER_TURNOS_EVENTUALES,
    PERMISOS.REPORTES_EVENTUALES,
    PERMISOS.REPORTES_PRACTICANTES,
    PERMISOS.REPORTES_MEXICO,
  ],
  nominas: [PERMISOS.REPORTES_MEXICO],
  guardia: [
    PERMISOS.OPERAR_RECORRIDOS,
    PERMISOS.OPERAR_INCIDENCIAS,
    PERMISOS.OPERAR_ASISTENCIA,
  ],
  asistencia: [PERMISOS.OPERAR_ASISTENCIA],
};

export function permisosPermitidosParaRol(rol) {
  return [...(PERMISOS_MAXIMOS_ROL[rol] || [])];
}

export const PERFILES_ACCESO = [
  {
    value: 'administrador',
    label: 'Administrador',
    rol: 'administrador',
    asistencia: true,
    permisos: ['*'],
  },
  {
    value: 'supervisor',
    label: 'Supervisor de seguridad',
    rol: 'supervisor',
    asistencia: false,
    permisos: [PERMISOS.REPORTES_RECORRIDOS, PERMISOS.REPORTES_INCIDENCIAS],
  },
  {
    value: 'supervisor_asistencia',
    label: 'Supervisor de seguridad (compatibilidad)',
    rol: 'supervisor',
    asistencia: false,
    permisos: [PERMISOS.REPORTES_RECORRIDOS, PERMISOS.REPORTES_INCIDENCIAS],
  },
  {
    value: 'rh',
    label: 'Recursos Humanos',
    rol: 'rh',
    asistencia: true,
    permisos: [
      PERMISOS.ADMINISTRAR_PERSONAL,
      PERMISOS.ADMINISTRAR_PUESTOS,
      PERMISOS.ADMINISTRAR_HORARIOS,
      PERMISOS.PLANEACION_PERSONAL,
      PERMISOS.RESOLVER_TURNOS_EVENTUALES,
      PERMISOS.REPORTES_EVENTUALES,
      PERMISOS.REPORTES_PRACTICANTES,
      PERMISOS.REPORTES_MEXICO,
    ],
  },
  {
    value: 'nominas',
    label: 'Nóminas',
    rol: 'nominas',
    asistencia: true,
    permisos: [PERMISOS.REPORTES_MEXICO],
  },
  {
    value: 'guardia',
    label: 'Seguridad: recorridos e incidencias',
    rol: 'guardia',
    asistencia: false,
    permisos: [PERMISOS.OPERAR_RECORRIDOS, PERMISOS.OPERAR_INCIDENCIAS],
  },
  {
    value: 'guardia_asistencia',
    label: 'Seguridad con Asistencia / Eventuales',
    rol: 'guardia',
    asistencia: true,
    permisos: [
      PERMISOS.OPERAR_RECORRIDOS,
      PERMISOS.OPERAR_INCIDENCIAS,
      PERMISOS.OPERAR_ASISTENCIA,
    ],
  },
  {
    value: 'seguridad_mexico',
    label: 'Seguridad México: solo asistencia',
    rol: 'asistencia',
    asistencia: true,
    permisos: [PERMISOS.OPERAR_ASISTENCIA],
  },
];

export function esPerfilAccesoValido(value) {
  return PERFILES_ACCESO.some((p) => p.value === value);
}

export function esPermisoValido(value) {
  return value === '*' || CATALOGO_PERMISOS.some((p) => p.value === value);
}

export function permisosPerfil(value) {
  const preset = PERFILES_ACCESO.find((p) => p.value === value);
  return preset ? [...preset.permisos] : [];
}

export function expandirPerfilAcceso(value, { estricto = false } = {}) {
  const preset = PERFILES_ACCESO.find((p) => p.value === value);
  if (!preset) {
    if (estricto) throw new Error('Selecciona un perfil de acceso válido.');
    return {
      rol: '',
      modulosPermitidos: [],
      perfilAcceso: '',
      asistencia: false,
      permisosSistema: [],
    };
  }

  return {
    rol: preset.rol,
    modulosPermitidos: preset.asistencia ? ['asistencia'] : [],
    perfilAcceso: preset.value,
    asistencia: preset.asistencia === true,
    permisosSistema: [...preset.permisos],
  };
}

export function identificarPerfilAcceso(user = {}) {
  if (typeof user?.perfilAcceso === 'string' && esPerfilAccesoValido(user.perfilAcceso)) {
    return user.perfilAcceso;
  }
  if (user?.rol === 'asistencia') return 'seguridad_mexico';
  if (user?.rol === 'administrador') return 'administrador';
  if (user?.rol === 'rh') return 'rh';
  if (user?.rol === 'nominas') return 'nominas';
  const extra = Array.isArray(user?.modulosPermitidos) && user.modulosPermitidos.includes('asistencia');
  if (user?.rol === 'guardia') return extra ? 'guardia_asistencia' : 'guardia';
  if (user?.rol === 'supervisor') return extra ? 'supervisor_asistencia' : 'supervisor';
  return '';
}

export function permisosEfectivos(user = {}) {
  if (user?.activo === false) return [];
  if (user?.rol === 'administrador') return ['*'];

  const maximos = permisosPermitidosParaRol(user?.rol);
  const base = Array.isArray(user?.permisosSistema)
    ? [...new Set(user.permisosSistema.filter(esPermisoValido))]
    : permisosPerfil(identificarPerfilAcceso(user));

  return base.filter((permiso) => maximos.includes(permiso));
}

export function tienePermiso(user, permiso) {
  const permisos = permisosEfectivos(user);
  return permisos.includes('*') || permisos.includes(permiso);
}

export function validarPermisosSistema(value) {
  if (!Array.isArray(value)) throw new Error('Los permisos del usuario no son válidos.');
  const permisos = [...new Set(value)];
  if (permisos.some((permiso) => !esPermisoValido(permiso))) {
    throw new Error('Hay un permiso no reconocido.');
  }
  return permisos;
}

export function validarPermisosParaRol(rol, value) {
  const permisos = validarPermisosSistema(value);
  if (rol === 'administrador') return ['*'];
  const maximos = permisosPermitidosParaRol(rol);
  if (permisos.some((permiso) => !maximos.includes(permiso))) {
    throw new Error('Hay permisos que no corresponden al rol seleccionado.');
  }
  return permisos;
}

export function validarPerfilAcceso(value) {
  return expandirPerfilAcceso(value, { estricto: true });
}

export function passwordCuentaMexico(value) {
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new Error('Escribe una clave o contraseña sin espacios al inicio o final.');
  }
  if (/^\d{4}$/.test(value)) return { password: `GMR${value}`, claveCorta: true };
  if (value.length < 10 || value.length > 128 || !/[a-z]/i.test(value) || !/\d/.test(value)) {
    throw new Error('Usa 4 dígitos para prueba, o 10 o más caracteres con letras y números.');
  }
  return { password: value, claveCorta: false };
}
