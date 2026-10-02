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

export function listarHorarios() {
  return call('planeacionListarHorarios');
}

export function guardarHorario(data) {
  return call('planeacionGuardarHorario', data);
}

export function listarPlaneacionSemana({ propiedadId, semanaInicio }) {
  return call('planeacionListarSemana', { propiedadId, semanaInicio });
}

export function listarSeguimientoPlaneacionSemana({ propiedadId, semanaInicio }) {
  return call('planeacionListarSeguimientoSemana', { propiedadId, semanaInicio });
}

export function asignarReemplazoPlaneacion(data) {
  return call('planeacionAsignarReemplazo', data);
}

export function quitarReemplazoPlaneacion(data) {
  return call('planeacionQuitarReemplazo', data);
}

export function guardarNecesidadPersonal(data) {
  return call('planeacionGuardarNecesidad', data);
}

export function eliminarNecesidadPersonal(data) {
  return call('planeacionEliminarNecesidad', data);
}

export function asignarEventualPlaneacion(data) {
  return call('planeacionAsignarEventual', data);
}

export function quitarAsignacionPlaneacion(data) {
  return call('planeacionQuitarAsignacion', data);
}

export function copiarDiaPlaneacion(data) {
  return call('planeacionCopiarDia', data);
}

export function copiarSemanaPlaneacion(data) {
  return call('planeacionCopiarSemana', data);
}
