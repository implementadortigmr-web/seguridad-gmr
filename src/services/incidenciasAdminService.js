import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

function convertirAFecha(valor) {
  if (!valor) return null;

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }

  if (typeof valor?.toDate === "function") {
    const fecha = valor.toDate();
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  if (typeof valor === "object" && typeof valor.seconds === "number") {
    const fecha = new Date(valor.seconds * 1000);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  if (typeof valor === "number") {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  if (typeof valor === "string") {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  return null;
}

function obtenerTimestampIncidencia(incidencia) {
  const fecha =
    convertirAFecha(incidencia.creadaEn) ||
    convertirAFecha(incidencia.sincronizadaEn) ||
    convertirAFecha(incidencia.actualizadoEn);

  return fecha ? fecha.getTime() : 0;
}

export async function listarIncidenciasAdmin() {
  const snapshot = await getDocs(collection(db, "incidencias"));

  return snapshot.docs
    .map((documento) => ({
      id: documento.id,
      ...documento.data(),
    }))
    .sort(
      (a, b) => obtenerTimestampIncidencia(b) - obtenerTimestampIncidencia(a)
    );
}

export async function actualizarEstadoIncidencia({
  incidenciaId,
  estado,
  usuarioId = "",
  usuarioNombre = "",
  comentarioResolucion = "",
}) {
  if (!incidenciaId) {
    throw new Error("No se encontró la incidencia.");
  }

  const ref = doc(db, "incidencias", incidenciaId);

  const cambios = {
    estado,
    actualizadoEn: serverTimestamp(),
    revisadaPor: usuarioId,
    revisadaPorNombre: usuarioNombre,
  };

  if (estado === "en_revision") {
    cambios.enRevisionEn = serverTimestamp();
  }

  if (estado === "resuelta") {
    cambios.resueltaEn = serverTimestamp();
    cambios.resueltaPor = usuarioId;
    cambios.resueltaPorNombre = usuarioNombre;
    cambios.comentarioResolucion = comentarioResolucion || "";
  }

  if (estado === "abierta") {
    cambios.reabiertaEn = serverTimestamp();
  }

  await updateDoc(ref, cambios);

  return cambios;
}