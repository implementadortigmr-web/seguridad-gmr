import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../services/firebase";

const AuthContext = createContext(null);

const VALID_ROLES = ["administrador", "supervisor", "guardia"];

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

async function getUserProfile(firebaseUser) {
  const profileRef = doc(db, "usuarios", firebaseUser.uid);
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

  return {
    id: firebaseUser.uid,
    correo: firebaseUser.email,
    ...profile,
    propiedad: profile.propiedadId === "todas" ? "Todas las propiedades" : profile.propiedadId,
  };
}

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      setAuthError("");

      if (!firebaseUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        const nextProfile = await getUserProfile(firebaseUser);
        setProfile(nextProfile);
      } catch (error) {
        console.error("Error leyendo perfil:", error);
        setProfile(null);
        setAuthError(error.message || "No fue posible leer el perfil del usuario.");
        await signOut(auth);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  async function login(email, password) {
    setAuthError("");

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      const readableError = getReadableAuthError(error);
      setAuthError(readableError);
      throw new Error(readableError);
    }
  }

  async function logout() {
    await signOut(auth);
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
