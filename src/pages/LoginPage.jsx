import { useEffect, useState } from "react";
import {
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import MessageBox from "../components/MessageBox";
import { routeForRole } from "../utils/roles";

const AUTH_DOMAIN = "seguridadgmr.local";

function normalizarUsuarioGuardia(valor = "") {
  const limpio = String(valor || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!limpio) return "";

  if (limpio.includes("@")) {
    return limpio;
  }

  return `${limpio}@${AUTH_DOMAIN}`;
}

function normalizarPasswordGuardia(valor = "") {
  const limpio = String(valor || "").trim();

  if (/^\d{4}$/.test(limpio)) {
    return `GMR${limpio}`;
  }

  return limpio;
}

function obtenerMensajeError(error) {
  const code = error?.code || "";
  const message = error?.message || "";

  if (
    code.includes("auth/invalid-credential") ||
    code.includes("auth/user-not-found") ||
    code.includes("auth/wrong-password") ||
    code.includes("auth/invalid-login-credentials")
  ) {
    return "Usuario o contraseña incorrectos.";
  }

  if (code.includes("auth/too-many-requests")) {
    return "Demasiados intentos. Espera unos minutos e intenta de nuevo.";
  }

  if (code.includes("auth/network-request-failed")) {
    return "No hay conexión a internet o Firebase no respondió.";
  }

  return message || "No fue posible iniciar sesión.";
}

export default function LoginPage({ mode = "guardia" }) {
  const { login, authError, profile } = useAuth();
  const navigate = useNavigate();

  const isAdminMode = mode === "admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!profile?.rol) return;

    navigate(routeForRole(profile.rol), { replace: true });
  }, [profile, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();

    const usuarioLimpio = email.trim();
    const passwordLimpio = password;

    if (!usuarioLimpio) {
      setFormError(isAdminMode ? "Ingresa tu correo." : "Ingresa tu usuario.");
      return;
    }

    if (!passwordLimpio) {
      setFormError("Ingresa tu contraseña.");
      return;
    }

    setFormError("");
    setSubmitting(true);

    try {
      const emailFinal = isAdminMode
        ? usuarioLimpio.toLowerCase()
        : normalizarUsuarioGuardia(usuarioLimpio);

      const passwordFinal = isAdminMode
        ? passwordLimpio
        : normalizarPasswordGuardia(passwordLimpio);

      await login(emailFinal, passwordFinal);
    } catch (error) {
      console.error("Error iniciando sesión:", error);
      setFormError(obtenerMensajeError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <div className="brand-icon">
          <ShieldCheck size={38} />
        </div>

        <p className="eyebrow">Grupo México Real</p>

        <h1>
          {isAdminMode ? "Panel Administrativo" : "Rondines de Seguridad"}
        </h1>

        <p className="login-description">
          {isAdminMode
            ? "Acceso para administración, supervisión y consulta de reportes."
            : "Registro de recorridos, evidencias fotográficas y seguimiento por punto de revisión."}
        </p>
      </section>

      <section className="login-card">
        <h2>Iniciar sesión</h2>

        <p className="muted">
          {isAdminMode
            ? "Ingresa con tu correo y contraseña."
            : "Ingresa con tu usuario y contraseña o clave asignada."}
        </p>

        {(formError || authError) && (
          <MessageBox type="error">{formError || authError}</MessageBox>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="usuario">
            {isAdminMode ? "Correo electrónico" : "Usuario"}
          </label>

          <input
            id="usuario"
            className="text-input"
            type={isAdminMode ? "email" : "text"}
            value={email}
            onChange={(event) =>
              setEmail(
                isAdminMode
                  ? event.target.value
                  : event.target.value.toUpperCase()
              )
            }
            placeholder={isAdminMode ? "admin@empresa.com" : "Ej. MARAIZA"}
            autoCapitalize={isAdminMode ? "none" : "characters"}
            autoComplete="username"
            autoCorrect="off"
            spellCheck="false"
            required
          />

          <label className="field-label" htmlFor="contrasena">
            Contraseña
          </label>

          <input
            id="contrasena"
            className="text-input"
            type="password"
            inputMode="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Contraseña o clave asignada"
            autoComplete="current-password"
            required
          />

          <button className="login-submit" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <LoaderCircle className="spinner" size={18} />
                Validando acceso
              </>
            ) : (
              <>
                Ingresar
                <ChevronRight size={19} />
              </>
            )}
          </button>
        </form>

        
      </section>
    </main>
  );
}