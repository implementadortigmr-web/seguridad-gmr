import { lazy, Suspense } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import DataLoadingState from '../../components/DataLoadingState';
import '../supervisor.css';

const RequisicionesPersonalPanel = lazy(() => import('../admin/RequisicionesPersonalPanel'));

export default function SolicitudesPersonalDashboard() {
  const { profile, logout } = useAuth();
  return (
    <div className="app-page">
      <header className="admin-main-header">
        <div className="admin-header-left">
          <div className="admin-header-brand"><strong>Solicitudes de personal GMR</strong></div>
        </div>
        <button type="button" className="header-logout-button" onClick={logout}><LogOut size={18} />Salir</button>
      </header>
      <main className="admin-dashboard-page">
        <div className="admin-topbar-title">
          <p className="eyebrow">{profile?.nombre || 'Solicitante'}</p>
          <h1>Requisiciones de personal</h1>
        </div>
        <section className="admin-panel-card">
          <Suspense fallback={<DataLoadingState title="Cargando solicitudes..." />}>
            <RequisicionesPersonalPanel />
          </Suspense>
        </section>
      </main>
    </div>
  );
}
