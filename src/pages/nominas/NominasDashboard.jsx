import { lazy, Suspense, useState } from 'react';
import { LogOut, WalletCards } from 'lucide-react';
import DataLoadingState from '../../components/DataLoadingState';
import MessageBox from '../../components/MessageBox';
import { useAuth } from '../../context/AuthContext';
import '../supervisor.css';

const ReporteAsistenciaTipoPanel = lazy(() => import('../admin/reportes/ReporteAsistenciaTipoPanel'));

export default function NominasDashboard() {
  const { profile, logout } = useAuth();
  const [message, setMessage] = useState('');

  return (
    <div className="app-page">
      <header className="admin-main-header">
        <div className="admin-header-left">
          <div className="admin-header-icon"><WalletCards size={24} /></div>
          <div className="admin-header-brand">
            <strong>Nóminas GMR</strong>
          </div>
        </div>
        <button type="button" className="header-logout-button" onClick={logout}>
          <LogOut size={18} /> Salir
        </button>
      </header>

      <main className="admin-dashboard-page">
        <div className="admin-topbar-compact">
          <div className="admin-topbar-title">
            <p className="eyebrow">Nóminas</p>
            <h1>Asistencia México</h1>
            <p className="muted">{profile?.nombre || profile?.correo || 'Nóminas'}</p>
          </div>
        </div>

        {message && <MessageBox>{message}</MessageBox>}

        <section className="admin-panel-card">
          <Suspense fallback={<DataLoadingState title="Cargando Asistencia México..." />}>
            <ReporteAsistenciaTipoPanel tipoPersonal="personal_mexico" onMessage={setMessage} />
          </Suspense>
        </section>
      </main>
    </div>
  );
}
