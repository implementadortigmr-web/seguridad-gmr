function pad(value) {
  return String(value).padStart(2, '0');
}

export function fechaLocalISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fechaDesdeValor(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function semanaISOActual(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(week)}`;
}

export function rangoSemanaISO(value) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('Selecciona una semana válida.');

  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);

  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + i);
    days.push(day.toISOString().slice(0, 10));
  }

  return {
    year,
    week,
    desde: days[0],
    hasta: days[6],
    dias: days,
  };
}

export function minutosJornada(row) {
  const explicit = Number(row?.minutos);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;

  const entrada = fechaDesdeValor(row?.entradaEn);
  const salida = fechaDesdeValor(row?.salidaEn);
  if (!entrada || !salida || salida < entrada) return null;
  return Math.floor((salida.getTime() - entrada.getTime()) / 60000);
}

// Regla de pago solicitada: 6 h 50 min => 7 h; 6 h 49 min => 6 h.
export function horasPagablesDesdeMinutos(minutos) {
  const value = Number(minutos);
  if (!Number.isFinite(value) || value < 0) return 0;
  const horas = Math.floor(value / 60);
  const minutosRestantes = Math.floor(value % 60);
  return horas + (minutosRestantes >= 50 ? 1 : 0);
}

function esSabado(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return false;
  const [year, month, day] = fecha.split('-').map(Number);
  return new Date(year, month - 1, day).getDay() === 6;
}

function esAlbanil(puesto = '') {
  return String(puesto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .includes('albanil');
}

export function calcularJornadaPagable(row) {
  const cerrada = ['completa', 'corregida'].includes(row?.estado) && row?.salidaEn;
  const minutos = cerrada ? minutosJornada(row) : null;
  const horasReales = minutos === null ? 0 : minutos / 60;
  let horasPagables = minutos === null ? 0 : horasPagablesDesdeMinutos(minutos);

  // Se conserva la regla del sistema anterior: sábado + albañil + 5 h reales o más = jornada de 8 h.
  if (cerrada && esSabado(row?.fechaJornada) && esAlbanil(row?.puestoNombre) && horasReales >= 5) {
    horasPagables = 8;
  }

  const horasNormales = Math.min(8, horasPagables);
  const horasExtra = Math.max(0, horasPagables - 8);
  const tarifa = Number(row?.tarifaHoraAplicada || 0);
  const pagoNormal = horasNormales * tarifa;
  // La hora extra se paga a la misma tarifa de la hora normal.
  const pagoExtra = horasExtra * tarifa;

  return {
    minutos,
    horasReales,
    horasPagables,
    horasNormales,
    horasExtra,
    tarifa,
    pagoNormal,
    pagoExtra,
    total: pagoNormal + pagoExtra,
    pendiente: !cerrada,
  };
}

export function resumirSemanaEventuales(rows, rango) {
  const employees = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row.empleadoId || row.claveEmpleado || row.empleadoNombre;
    if (!id) continue;

    const item = employees.get(id) || {
      id,
      empleadoId: row.empleadoId || '',
      clave: row.claveEmpleado || '',
      nombre: row.empleadoNombre || 'Sin nombre',
      puesto: row.puestoNombre || 'Sin puesto',
      area: row.area || '',
      tarifa: Number(row.tarifaHoraAplicada || 0),
      fechas: {},
      diasTrabajados: 0,
      jornadas: [],
      horasPagables: 0,
      horasNormales: 0,
      horasExtra: 0,
      pagoNormal: 0,
      pagoExtra: 0,
      total: 0,
      pendientes: 0,
    };

    const calc = calcularJornadaPagable(row);
    const fecha = row.fechaJornada || fechaLocalISO(fechaDesdeValor(row.entradaEn) || new Date());

    item.tarifa = calc.tarifa || item.tarifa;
    item.jornadas.push({ ...row, calculoPago: calc });
    item.fechas[fecha] = (item.fechas[fecha] || 0) + calc.total;

    if (!calc.pendiente) item.diasTrabajados += 1;
    if (calc.pendiente) item.pendientes += 1;

    item.horasPagables += calc.horasPagables;
    item.horasNormales += calc.horasNormales;
    item.horasExtra += calc.horasExtra;
    item.pagoNormal += calc.pagoNormal;
    item.pagoExtra += calc.pagoExtra;
    item.total += calc.total;

    employees.set(id, item);
  }

  const personas = [...employees.values()]
    .map((item) => ({ ...item, dias: item.diasTrabajados }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const totals = personas.reduce((acc, item) => {
    acc.dias += item.dias;
    acc.horasPagables += item.horasPagables;
    acc.horasNormales += item.horasNormales;
    acc.horasExtra += item.horasExtra;
    acc.pagoNormal += item.pagoNormal;
    acc.pagoExtra += item.pagoExtra;
    acc.total += item.total;
    acc.pendientes += item.pendientes;
    for (const fecha of rango.dias) {
      acc.fechas[fecha] = (acc.fechas[fecha] || 0) + (item.fechas[fecha] || 0);
    }
    return acc;
  }, {
    dias: 0,
    horasPagables: 0,
    horasNormales: 0,
    horasExtra: 0,
    pagoNormal: 0,
    pagoExtra: 0,
    total: 0,
    pendientes: 0,
    fechas: {},
  });

  return { personas, totals };
}

export function folioSolicitudEventuales(propiedad, rango) {
  const code = String(propiedad?.codigo || propiedad?.id || 'PROP')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8) || 'PROP';
  return `EV-${code}-${rango.year}-S${pad(rango.week)}`;
}

export function dinero(value) {
  return Number(value || 0).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  });
}

export function horaTexto(value, zone = 'America/Mexico_City') {
  const date = fechaDesdeValor(value);
  if (!date) return '-';
  return date.toLocaleTimeString('es-MX', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
