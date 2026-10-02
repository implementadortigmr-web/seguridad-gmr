import { useAuth } from '../context/AuthContext';
import MessageBox from '../components/MessageBox';
import { PERMISOS, tienePermiso } from '../../shared/perfilesAcceso';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { AlertCircle, BarChart3, FileClock, LogOut, RefreshCcw } from 'lucide-react';
import { auth, db } from '../services/firebase';
import './supervisor.css';

const ReportesPanel = lazy(() => import('./admin/reportes/ReportesPanel'));
const IncidenciasRevisionPanel = lazy(() => import('./admin/incidencias/IncidenciasRevisionPanel'));
const ReporteAsistenciaTipoPanel = lazy(() => import('./admin/reportes/ReporteAsistenciaTipoPanel'));

function safeArray(value) { return Array.isArray(value) ? value : []; }

function normalizarPermisos(profile) {
  if (!profile) return [];
  if (Array.isArray(profile.propiedadesPermitidas) && profile.propiedadesPermitidas.length > 0) {
    return profile.propiedadesPermitidas.filter(Boolean);
  }
  if (Array.isArray(profile.propiedadesAsignadas) && profile.propiedadesAsignadas.length > 0) {
    return profile.propiedadesAsignadas.filter(Boolean);
  }
  if (profile.propiedadId === 'todas') return ['*'];
  if (profile.propiedadId && profile.propiedadId !== 'todas') return [profile.propiedadId];
  return [];
}

export default function SupervisorDashboard() {
  const { profile } = useAuth();
  const availableViews = useMemo(() => {
    const views = [];
    if (tienePermiso(profile, PERMISOS.REPORTES_RECORRIDOS)) views.push('recorridos');
    if (tienePermiso(profile, PERMISOS.REPORTES_INCIDENCIAS)) views.push('incidencias');
    if (tienePermiso(profile, PERMISOS.REPORTES_EVENTUALES)) views.push('eventuales');
    return views;
  }, [profile]);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [activeView, setActiveView] = useState('');
  const [propiedades, setPropiedades] = useState([]);
  const [loggingOut, setLoggingOut] = useState(false);
  const requestCounter = useRef(0);

  useEffect(() => {
    if (!availableViews.length) setActiveView('');
    else if (!availableViews.includes(activeView)) setActiveView(availableViews[0]);
  }, [availableViews, activeView]);

  const permisos = useMemo(() => normalizarPermisos(profile), [profile]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setMessage('');
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error cerrando sesion:', error);
      setMessage('No fue posible cerrar sesion. Intenta nuevamente.');
    } finally {
      setLoggingOut(false);
    }
  }

  const permisosTexto = useMemo(() => {
    if (permisos.includes('*')) return 'Todas las propiedades';
    if (!permisos.length) return 'Sin propiedades asignadas';
    return `${permisos.length} propiedad(es)`;
  }, [permisos]);

  const loadProperties = useCallback(async () => {
    const ticket = ++requestCounter.current;
    setLoading(true);
    setMessage('');

    try {
      const todos = permisos.includes('*');
      const propertyDocs = todos
        ? (await getDocs(collection(db, 'propiedades'))).docs
        : await Promise.all(permisos.map((id) => getDoc(doc(db, 'propiedades', id))));

      if (ticket !== requestCounter.current) return;

      setPropiedades(
        propertyDocs
          .filter((item) => item.exists())
          .map((item) => ({ ...item.data(), id: item.id }))
          .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
      );
    } catch (error) {
      if (ticket !== requestCounter.current) return;
      setPropiedades([]);
      setMessage(error?.message || 'No fue posible cargar las propiedades de supervisión.');
    } finally {
      if (ticket === requestCounter.current) setLoading(false);
    }
  }, [permisos]);

  useEffect(() => {
    loadProperties();
    return () => { requestCounter.current += 1; };
  }, [loadProperties]);

  const title = activeView === 'recorridos'
    ? 'Reporte de recorridos'
    : activeView === 'incidencias'
      ? 'Control de incidencias'
      : activeView === 'eventuales'
        ? 'Eventuales y asistencia'
        : 'Sin módulos asignados';

  const necesitaPropiedades = ['recorridos', 'incidencias'].includes(activeView);

  return (
    <main className="supervisor-page">
      <header className="supervisor-header">
        <div>
          <span className="supervisor-kicker">Panel de supervisión</span>
          <h1>{title}</h1>
          <p>{profile?.nombre || profile?.correo || 'Supervisor'} · {permisosTexto}</p>
        </div>
        <div className="supervisor-header-actions">
          {necesitaPropiedades && (
            <button type="button" className="secondary-button" onClick={loadProperties} disabled={loading}>
              <RefreshCcw size={16} />Actualizar propiedades
            </button>
          )}
          <button type="button" className="secondary-button" onClick={handleLogout} disabled={loggingOut}>
            <LogOut size={18} />{loggingOut ? 'Saliendo...' : 'Salir'}
          </button>
        </div>
      </header>

      {message && <MessageBox>{message}</MessageBox>}

      <div className="supervisor-view-tabs">
        {availableViews.includes('recorridos') && (
          <button type="button" className={activeView === 'recorridos' ? 'active' : ''} onClick={() => setActiveView('recorridos')}>
            <BarChart3 size={17} />Reporte de recorridos
          </button>
        )}
        {availableViews.includes('incidencias') && (
          <button type="button" className={activeView === 'incidencias' ? 'active' : ''} onClick={() => setActiveView('incidencias')}>
            <AlertCircle size={17} />Incidencias
          </button>
        )}
        {availableViews.includes('eventuales') && (
          <button type="button" className={activeView === 'eventuales' ? 'active' : ''} onClick={() => setActiveView('eventuales')}>
            <FileClock size={17} />Eventuales y asistencia
          </button>
        )}
      </div>

      {!activeView ? (
        <section className="supervisor-loading"><p>Esta cuenta no tiene módulos de supervisión asignados.</p></section>
      ) : loading && necesitaPropiedades ? (
        <section className="supervisor-loading"><div className="pdf-loading-spinner" /><p>Cargando propiedades...</p></section>
      ) : (
        <div className="supervisor-report-wrapper">
          <Suspense fallback={<p role="status">Cargando sección...</p>}>
            {activeView === 'recorridos' ? (
              <ReportesPanel
                propiedades={safeArray(propiedades)}
                propiedadesPermitidas={permisos}
              />
            ) : activeView === 'eventuales' ? (
              <ReporteAsistenciaTipoPanel tipoPersonal="eventual" />
            ) : (
              <IncidenciasRevisionPanel
                profile={profile}
                propiedades={safeArray(propiedades)}
                permisosPropiedades={permisos}
              />
            )}
          </Suspense>
        </div>
      )}
    </main>
  );
}
