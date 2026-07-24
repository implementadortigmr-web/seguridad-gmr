import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";
import { Preferences } from "@capacitor/preferences";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";

const DEVICE_KEY = "seguridad_gmr_device_id";

export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function generarCodigoDispositivo() {
  const base = `${Date.now()}${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;

  const limpio = base
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 12)
    .padEnd(12, "X");

  return `GMR-${limpio.slice(0, 4)}-${limpio.slice(4, 8)}-${limpio.slice(
    8,
    12
  )}`;
}

async function leerLocalStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return "";
  }
}

async function guardarLocalStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // No hacer nada
  }
}

async function obtenerDeviceIdPersistente() {
  try {
    const saved = await Preferences.get({ key: DEVICE_KEY });

    if (saved?.value) {
      return saved.value;
    }

    const nuevoCodigo = generarCodigoDispositivo();

    await Preferences.set({
      key: DEVICE_KEY,
      value: nuevoCodigo,
    });

    return nuevoCodigo;
  } catch (error) {
    console.warn("Preferences no disponible, usando localStorage:", error);

    const savedLocal = await leerLocalStorage(DEVICE_KEY);

    if (savedLocal) {
      return savedLocal;
    }

    const nuevoCodigo = generarCodigoDispositivo();

    await guardarLocalStorage(DEVICE_KEY, nuevoCodigo);

    return nuevoCodigo;
  }
}

export async function obtenerDeviceId() {
  const fallbackId = await obtenerDeviceIdPersistente();

  try {
    const info = await Device.getId();

    return info?.identifier || fallbackId;
  } catch (error) {
    console.warn("No se pudo obtener Device.getId:", error);
    return fallbackId;
  }
}

export async function getDeviceInfo() {
  const fallbackId = await obtenerDeviceIdPersistente();

  let nativeId = "";
  let info = {};

  try {
    const id = await Device.getId();
    nativeId = id?.identifier || "";
  } catch (error) {
    console.warn("No se pudo obtener ID nativo:", error);
  }

  try {
    info = await Device.getInfo();
  } catch (error) {
    console.warn("No se pudo obtener información del dispositivo:", error);
  }

  const finalDeviceId = nativeId || fallbackId;

  return {
    deviceId: finalDeviceId,
    identificador: finalDeviceId,
    codigoDispositivo: finalDeviceId,

    nativeDeviceId: nativeId,
    gmrDeviceId: fallbackId,

    nombre: info?.name || info?.model || "Dispositivo",
    model: info?.model || "No disponible",
    platform: info?.platform || (isNativeApp() ? "android" : "web"),
    operatingSystem: info?.operatingSystem || "",
    osVersion: info?.osVersion || "",
    manufacturer: info?.manufacturer || "",
    isVirtual: info?.isVirtual || false,
    webViewVersion: info?.webViewVersion || "",
  };
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

  if (
    Array.isArray(profile.propiedadesAsignadas) &&
    profile.propiedadesAsignadas.length > 0
  ) {
    return profile.propiedadesAsignadas.filter(Boolean);
  }

  if (profile.propiedadId && profile.propiedadId !== "todas") {
    return [profile.propiedadId];
  }

  return [];
}

export async function registrarDispositivoAutomatico(profile, deviceInfo) {
  if (!profile?.id) {
    throw new Error("No hay usuario para registrar el dispositivo.");
  }

  const deviceId =
    deviceInfo?.deviceId ||
    deviceInfo?.identificador ||
    deviceInfo?.codigoDispositivo ||
    (await obtenerDeviceId());

  if (!deviceId) {
    throw new Error("No fue posible generar el ID del dispositivo.");
  }

  const propiedadesPermitidas = normalizarPermisosUsuario(profile);
  const tienePropiedades =
    propiedadesPermitidas.includes("*") || propiedadesPermitidas.length > 0;

  const dispositivoRef = doc(db, "dispositivos", deviceId);

  const datosDispositivo = {
    deviceId,
    identificador: deviceId,
    codigoDispositivo: deviceId,

    nombre: deviceInfo?.nombre || deviceInfo?.model || "Dispositivo",
    modelo: deviceInfo?.model || "No disponible",
    plataforma: deviceInfo?.platform || "",
    sistemaOperativo: deviceInfo?.operatingSystem || "",
    versionSistema: deviceInfo?.osVersion || "",
    fabricante: deviceInfo?.manufacturer || "",

    usuarioId: profile.id,
    usuarioNombre: profile.nombre || profile.email || "",
    usuarioEmail: profile.email || "",
    usuarioRol: profile.rol || "guardia",

    propiedadPrincipal: profile.propiedadId || "todas",
    propiedadesPermitidas,

    activo: tienePropiedades,
    estado: tienePropiedades ? "autorizado" : "sin_propiedades",

    registroAutomatico: true,
    actualizadoEn: serverTimestamp(),
    ultimoAccesoEn: serverTimestamp(),
  };

  const snapshot = await getDoc(dispositivoRef);

  if (!snapshot.exists()) {
    await setDoc(dispositivoRef, {
      ...datosDispositivo,
      creadoEn: serverTimestamp(),
    });
  } else {
    await setDoc(dispositivoRef, datosDispositivo, { merge: true });
  }

  return {
    id: deviceId,
    ...datosDispositivo,
  };
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