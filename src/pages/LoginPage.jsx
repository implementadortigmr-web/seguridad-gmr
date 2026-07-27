import { useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

const AUTH_DOMAIN = "seguridadgmr.local";

function normalizarUsuarioLogin(valor = "") {
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

function normalizarPasswordLogin(valor = "") {
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

export default function LoginPage() {
  const { login, authError } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();

    const usuarioLimpio = email.trim();
    const passwordLimpio = password.trim();

    if (!usuarioLimpio) {
      setFormError("Ingresa tu usuario.");
      return;
    }

    if (!passwordLimpio) {
      setFormError("Ingresa tu contraseña.");
      return;
    }

    setFormError("");
    setSubmitting(true);

    try {
      const emailFinal = normalizarUsuarioLogin(usuarioLimpio);
      const passwordFinal = normalizarPasswordLogin(passwordLimpio);

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

        <h1>Rondines de Seguridad</h1>

        <p className="login-description">
          Registro de recorridos, evidencias fotográficas y seguimiento por
          punto de revisión.
        </p>
      </section>

      <section className="login-card">
        <h2>Iniciar sesión</h2>

        <p className="muted">Ingresa con tu usuario y clave de 4 dígitos.</p>

        {(formError || authError) && (
          <div className="login-error">
            <AlertCircle size={18} />
            <span>{formError || authError}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="usuario">
            Usuario
          </label>

          <input
            id="usuario"
            className="text-input"
            type="text"
            value={email}
            onChange={(event) => setEmail(event.target.value.toUpperCase())}
            placeholder="Ej. MARAIZA"
            autoCapitalize="characters"
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
            inputMode="numeric"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Clave de 4 dígitos"
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