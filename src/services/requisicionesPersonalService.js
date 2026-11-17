import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions(
  getApp(),
  import.meta.env.VITE_ASISTENCIA_FUNCTIONS_REGION || 'us-central1'
);

async function call(name, data = {}) {
  const result = await httpsCallable(functions, name, { timeout: 60000 })(data);
  return result.data;
}

export function cargarCatalogosRequisicion() {
  return call('requisicionesCatalogos');
}

export function listarRequisicionesPersonal(data = {}) {
  return call('requisicionesListar', data);
}

export function crearRequisicionPersonal(data) {
  return call('requisicionesCrear', data);
}

export function autorizarRequisicionPersonal(requisicionId) {
  return call('requisicionesAutorizar', { requisicionId });
}

export function rechazarRequisicionPersonal(requisicionId, motivoRechazo) {
  return call('requisicionesRechazar', { requisicionId, motivoRechazo });
}
