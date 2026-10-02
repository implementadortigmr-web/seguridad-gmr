import { useState } from 'react';
import {
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import MessageBox from '../../components/MessageBox';
import AsistenciaModulo from './AsistenciaModulo';
import './asistencia.css';

export default function AsistenciaDashboard() {
  const { profile, logout } =
    useAuth();

  const [busy, setBusy] =
    useState(false);

  const [error, setError] =
    useState('');

  async function salir() {
    if (busy) return;

    setBusy(true);
    setError('');

    try {
      await logout();
    } catch {
      setError(
        'No fue posible cerrar la sesión. Intenta nuevamente.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="asistencia-dashboard asistencia-mexico-dashboard">
      <header className="asistencia-dashboard-header asistencia-mexico-header">
        <div className="asistencia-brand">
          <div className="asistencia-brand-icon">
            <ShieldCheck size={22} />
          </div>

          <div>
            <span>SEGURIDAD GMR</span>
            <h1>Asistencia México</h1>
            <p>
              {profile?.nombre ||
                'Seguridad México'}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="asistencia-logout-button"
          disabled={busy}
          onClick={salir}
          aria-label="Cerrar sesión"
        >
          <LogOut size={18} />

          <span>
            {busy ? 'Saliendo...' : 'Salir'}
          </span>
        </button>
      </header>

      {error && <MessageBox type="error">{error}</MessageBox>}

      <div className="asistencia-mexico-content">
        <AsistenciaModulo soloMexico />
      </div>
    </main>
  );
}
