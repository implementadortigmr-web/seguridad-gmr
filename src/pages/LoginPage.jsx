import { useState } from "react";
import { AlertCircle, ChevronRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login, authError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    setSubmitting(true);

    try {
      await login(email, password);
    } catch (error) {
      setFormError(error.message);
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
          Registro de recorridos, evidencias fotográficas y seguimiento por punto de revisión.
        </p>
      </section>

      <section className="login-card">
        <h2>Iniciar sesión</h2>
        <p className="muted">Ingresa con el correo y contraseña registrados en Firebase.</p>

        {(formError || authError) && (
          <div className="login-error">
            <AlertCircle size={18} />
            <span>{formError || authError}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="correo">
            Correo electrónico
          </label>
          <input
            id="correo"
            className="text-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="usuario@seguridadgmr.com"
            autoComplete="email"
            required
          />

          <label className="field-label" htmlFor="contrasena">
            Contraseña
          </label>
          <input
            id="contrasena"
            className="text-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Contraseña"
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
