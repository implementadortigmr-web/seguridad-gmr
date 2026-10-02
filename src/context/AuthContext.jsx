import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../services/firebase";

const AuthContext = createContext(null);

const VALID_ROLES = ["administrador", "supervisor", "rh", "nominas", "guardia", "asistencia"];
const PROFILE_CACHE_PREFIX = "seguridadGmr.profile.";

function getReadableAuthError(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/invalid-email":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Correo o contraseña incorrectos.";
    case "auth/too-many-requests":
      return "Demasiados intentos. Espera un momento e intenta nuevamente.";
    case "auth/network-request-failed":
      return "No se pudo conectar con Firebase. Revisa tu conexión.";
    default:
      return "No fue posible iniciar sesión. Revisa tus datos.";
  }
}

function cacheKey(uid) {
  return `${PROFILE_CACHE_PREFIX}${uid}`;
}

function guardarPerfilLocal(uid, profile) {
  if (!uid || !profile) return;

  try {
    localStorage.setItem(
      cacheKey(uid),
      JSON.stringify({
        profile,
        guardadoEn: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.warn("No fue posible guardar el perfil para uso offline:", error);
  }
}

function leerPerfilLocal(uid) {
  if (!uid) return null;

  try {
    const raw = localStorage.getItem(cacheKey(uid));
    if (!raw) return null;

    const cached = JSON.parse(raw);
    const profile = cached?.profile;

    if (!profile || profile.activo !== true || !VALID_ROLES.includes(profile.rol)) {
      return null;
    }

    return {
      ...profile,
      id: uid,
      uid,
    };
  } catch (error) {
    console.warn("No fue posible leer el perfil offline:", error);
    return null;
  }
}

function borrarPerfilLocal(uid) {
  if (!uid) return;

  try {
    localStorage.removeItem(cacheKey(uid));
  } catch {
    // El cierre de sesión no debe fallar por almacenamiento local.
  }
}

function esErrorTemporalDeConexion(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();

  return (
    code.includes("unavailable") ||
    code.includes("network-request-failed") ||
    code.includes("deadline-exceeded") ||
    message.includes("offline") ||
    message.includes("network") ||
    message.includes("internet") ||
    message.includes("failed to get document")
  );
}

async function getUserProfile(firebaseUser) {
  const profileRef = doc(db, "usuarios", firebaseUser.uid);

  try {
    const profileSnapshot = await getDoc(profileRef);

    if (!profileSnapshot.exists()) {
      throw new Error(
        "El usuario inició sesión, pero no tiene un perfil asignado en Firestore."
      );
    }

    const profile = profileSnapshot.data();

    if (profile.activo !== true) {
      throw new Error("Este usuario está desactivado. Solicita apoyo al administrador.");
    }

    if (!VALID_ROLES.includes(profile.rol)) {
      throw new Error("Este perfil no tiene un rol permitido.");
    }

    const normalized = {
      ...profile,
      id: firebaseUser.uid,
      uid: firebaseUser.uid,
      correo: profile.correo || firebaseUser.email,
      propiedad:
        profile.propiedadId === "todas"
          ? "Todas las propiedades"
          : profile.propiedadId,
    };

    guardarPerfilLocal(firebaseUser.uid, normalized);
    return normalized;
  } catch (error) {
    const cachedProfile = leerPerfilLocal(firebaseUser.uid);

    if (cachedProfile && esErrorTemporalDeConexion(error)) {
      return {
        ...cachedProfile,
        correo: cachedProfile.correo || firebaseUser.email,
        sesionOffline: true,
      };
    }

    throw error;
  }
}

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let generation = 0;
    let unsubscribe = () => {};
    let disposed = false;

    async function initializeAuth() {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (error) {
        console.warn("No fue posible forzar persistencia local de Firebase Auth:", error);
      }

      if (disposed) return;

      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        const ticket = ++generation;
        setLoading(true);
        setAuthError("");

        if (!firebaseUser) {
          setProfile(null);
          setLoading(false);
          return;
        }

        try {
          const nextProfile = await getUserProfile(firebaseUser);
          if (ticket !== generation || auth.currentUser?.uid !== firebaseUser.uid) return;
          setProfile(nextProfile);
        } catch (error) {
          if (ticket !== generation || auth.currentUser?.uid !== firebaseUser.uid) return;

          console.error("Error leyendo perfil:", error);
          setProfile(null);

          const transient = esErrorTemporalDeConexion(error);
          setAuthError(
            transient
              ? "No hay conexión y este usuario todavía no tiene un perfil guardado en este dispositivo. Conéctalo a internet una vez para habilitar el acceso offline."
              : error.message || "No fue posible leer el perfil del usuario."
          );

          // Importante: una falla temporal de internet NO debe cerrar la sesión.
          if (!transient) {
            borrarPerfilLocal(firebaseUser.uid);
            await signOut(auth);
          }
        } finally {
          if (ticket === generation) setLoading(false);
        }
      });
    }

    initializeAuth();

    return () => {
      disposed = true;
      generation += 1;
      unsubscribe();
    };
  }, []);

  async function login(email, password) {
    setAuthError("");

    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      const readableError = getReadableAuthError(error);
      setAuthError(readableError);
      throw new Error(readableError);
    }
  }

  async function logout() {
    const uid = auth.currentUser?.uid || profile?.uid || profile?.id || "";
    await signOut(auth);
    borrarPerfilLocal(uid);
    setProfile(null);
  }

  const value = useMemo(
    () => ({ profile, loading, authError, login, logout }),
    [profile, loading, authError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth debe usarse dentro de AuthProvider");
  }

  return context;
}
