import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from './firebase';

const functions = getFunctions(
  getApp(),
  import.meta.env.VITE_ASISTENCIA_FUNCTIONS_REGION || 'us-central1'
);

async function call(name, data = {}) {
  const result = await httpsCallable(functions, name, { timeout: 60000 })(data);
  return result.data;
}

export function guardarUsuarioSistema(data) {
  return call('seguridadGuardarUsuarioSistema', data);
}


export function actualizarPermisosUsuario(data) {
  return call('seguridadActualizarPermisosUsuario', data);
}

export function guardarPuesto(data) {
  return call('asistenciaGuardarPuesto', data);
}

export async function listarPuestos() {
  const snap = await getDocs(query(collection(db, 'puestos'), orderBy('nombre')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarPersonalPorTipo(tipo, propiedadId = '') {
  const response = await call('asistenciaListarPersonal', {
    tipo,
    propiedadId: propiedadId || '',
  });
  return Array.isArray(response?.rows) ? response.rows : [];
}

export function guardarPersonal(data) {
  return call('asistenciaGuardarPersonal', data);
}
