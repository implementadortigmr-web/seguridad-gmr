import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

export function crearPropiedad({ codigo, nombre, userId }) {
  return addDoc(collection(db, "propiedades"), {
    codigo: codigo.trim(),
    nombre: nombre.trim(),
    activo: true,
    creadoEn: serverTimestamp(),
    creadoPor: userId,
  });
}

export function crearRol({ nombre, descripcion, userId }) {
  return addDoc(collection(db, "roles"), {
    nombre: nombre.trim(),
    descripcion: descripcion.trim(),
    activo: true,
    creadoEn: serverTimestamp(),
    creadoPor: userId,
  });
}

export function crearTipoIncidencia({ nombre, prioridadDefault, userId }) {
  return addDoc(collection(db, "tiposIncidencia"), {
    nombre: nombre.trim(),
    prioridadDefault,
    activo: true,
    creadoEn: serverTimestamp(),
    creadoPor: userId,
  });
}

export function crearPlantillaRecorrido({ nombre, propiedadId, puntos, userId }) {
  return addDoc(collection(db, "plantillasRecorridos"), {
    nombre: nombre.trim(),
    propiedadId,
    puntos,
    totalPuntos: puntos.length,
    activo: true,
    creadoEn: serverTimestamp(),
    creadoPor: userId,
  });
}

export function guardarPerfilUsuario({
  uid,
  nombre,
  correo,
  rol,
  propiedadId,
  propiedadesPermitidas,
  activo = true,
  userId,
}) {
  return setDoc(doc(db, "usuarios", uid.trim()), {
    nombre: nombre.trim(),
    correo: correo.trim(),
    rol,
    propiedadId: propiedadId.trim(),
    propiedadesPermitidas,
    activo,
    actualizadoEn: serverTimestamp(),
    actualizadoPor: userId,
  });
}

export function cambiarActivo({ collectionName, id, activoActual, userId }) {
  return updateDoc(doc(db, collectionName, id), {
    activo: !activoActual,
    actualizadoEn: serverTimestamp(),
    actualizadoPor: userId,
  });
}

export function guardarDispositivo({
  deviceId,
  nombre,
  propiedadesPermitidas,
  activo = true,
  notas = "",
  userId,
}) {
  const propiedades = Array.isArray(propiedadesPermitidas)
    ? propiedadesPermitidas
    : [];

  const propiedadPrincipal = propiedades.includes("*")
    ? "todas"
    : propiedades[0] || "";

  return setDoc(doc(db, "dispositivos", deviceId.trim()), {
    nombre: nombre.trim(),
    activo,
    propiedadesPermitidas: propiedades,
    propiedadPrincipal,
    notas: notas.trim(),
    actualizadoEn: serverTimestamp(),
    actualizadoPor: userId,
  });
}