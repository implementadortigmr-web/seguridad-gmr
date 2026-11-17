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

export function cargarCatalogoRegistroEventual() {
  return call('eventualFormularioCatalogoPublico');
}

export function registrarSolicitudEventual(data) {
  return call('eventualRegistrarSolicitudPublica', data);
}

export function consultarSolicitudEventual(data) {
  return call('eventualConsultarSolicitudPublica', data);
}

export function listarSolicitudesEventuales(estado = 'pendiente') {
  return call('eventualListarSolicitudes', { estado });
}

export function resolverSolicitudEventual(data) {
  return call('eventualResolverSolicitud', data);
}

export function consultarFotoPersonalEventual(empleadoId) {
  return call('eventualConsultarFotoPersonal', { empleadoId });
}
