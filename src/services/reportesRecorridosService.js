import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { db } from './firebase';

function normalizarFechaInput(valor = '') {
  return String(valor || '').trim();
}

function crearLimiteIso(fechaTexto, fin = false) {
  const fecha = normalizarFechaInput(fechaTexto);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return '';

  const local = new Date(`${fecha}T${fin ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(local.getTime()) ? '' : local.toISOString();
}

/**
 * Consulta únicamente los recorridos finalizados dentro del rango solicitado.
 * Las fechas de ejecucionesRecorridos se guardan como ISO UTC, por eso el
 * rango seleccionado en hora local se convierte también a ISO antes de consultar.
 */
export async function consultarRecorridosPorRango({
  fechaInicio,
  fechaFin,
  propiedadesPermitidas = null,
} = {}) {
  const inicioIso = crearLimiteIso(fechaInicio, false);
  const finIso = crearLimiteIso(fechaFin || fechaInicio, true);

  if (!inicioIso || !finIso) {
    throw new Error('Selecciona una fecha inicial y una fecha final válidas.');
  }

  if (inicioIso > finIso) {
    throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
  }

  const snap = await getDocs(
    query(
      collection(db, 'ejecucionesRecorridos'),
      where('finalizadaEn', '>=', inicioIso),
      where('finalizadaEn', '<=', finIso)
    )
  );

  const restringirPorPropiedad = Array.isArray(propiedadesPermitidas);
  const permitidas = restringirPorPropiedad
    ? propiedadesPermitidas.filter(Boolean)
    : [];
  const accesoGlobal = permitidas.includes('*');
  const setPermitidas = restringirPorPropiedad && !accesoGlobal
    ? new Set(permitidas)
    : null;

  return snap.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((row) => !setPermitidas || setPermitidas.has(row.propiedadId))
    .sort((a, b) => {
      const fechaA = String(a?.finalizadaEn || a?.iniciadaEn || '');
      const fechaB = String(b?.finalizadaEn || b?.iniciadaEn || '');
      return fechaB.localeCompare(fechaA);
    });
}

export async function consultarEvidenciasRecorrido(ejecucionId) {
  if (!ejecucionId) return [];

  const snap = await getDocs(
    query(
      collection(db, 'evidenciasPuntos'),
      where('ejecucionId', '==', ejecucionId),
      limit(250)
    )
  );

  return snap.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .sort((a, b) => Number(a?.puntoOrden || 0) - Number(b?.puntoOrden || 0));
}
