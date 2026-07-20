import { Device } from "@capacitor/device";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

export async function obtenerDeviceId() {
  const info = await Device.getId();
  return info.identifier;
}

export async function obtenerDispositivoRegistrado(deviceId) {
  if (!deviceId) return null;

  const ref = doc(db, "dispositivos", deviceId);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export function normalizarPermisosUsuario(profile) {
  if (!profile) return [];

  if (
    Array.isArray(profile.propiedadesPermitidas) &&
    profile.propiedadesPermitidas.length > 0
  ) {
    return profile.propiedadesPermitidas.filter(Boolean);
  }

  if (profile.propiedadId && profile.propiedadId !== "todas") {
    return [profile.propiedadId];
  }

  return [];
}

export function obtenerPropiedadesOperativas(profile, dispositivo) {
  const permisosUsuario = normalizarPermisosUsuario(profile);

  if (!dispositivo) {
    return {
      autorizado: false,
      motivo: "dispositivo_no_registrado",
      propiedades: [],
    };
  }

  if (dispositivo.activo !== true) {
    return {
      autorizado: false,
      motivo: "dispositivo_inactivo",
      propiedades: [],
    };
  }

  const permisosDispositivo = Array.isArray(dispositivo.propiedadesPermitidas)
    ? dispositivo.propiedadesPermitidas.filter(Boolean)
    : [];

  if (!permisosDispositivo.length) {
    return {
      autorizado: false,
      motivo: "dispositivo_sin_propiedades",
      propiedades: [],
    };
  }

  const usuarioTodas = permisosUsuario.includes("*");
  const dispositivoTodas = permisosDispositivo.includes("*");

  if (usuarioTodas && dispositivoTodas) {
    return {
      autorizado: true,
      motivo: "todas",
      propiedades: ["*"],
    };
  }

  if (usuarioTodas) {
    return {
      autorizado: true,
      motivo: "usuario_todas",
      propiedades: permisosDispositivo,
    };
  }

  if (dispositivoTodas) {
    return {
      autorizado: true,
      motivo: "dispositivo_todas",
      propiedades: permisosUsuario,
    };
  }

  const interseccion = permisosUsuario.filter((propiedadId) =>
    permisosDispositivo.includes(propiedadId)
  );

  return {
    autorizado: interseccion.length > 0,
    motivo: interseccion.length > 0 ? "autorizado" : "sin_coincidencias",
    propiedades: interseccion,
  };
}