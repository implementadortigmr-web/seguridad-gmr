import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, CalendarRange, Clock3, FileClock, GraduationCap, LogOut, Menu, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import MessageBox from '../../components/MessageBox';
import DataLoadingState from '../../components/DataLoadingState';
import { listarPropiedadesAsistencia } from '../../modules/asistencia/services/asistenciaService';
import { PERMISOS, tienePermiso } from '../../../shared/perfilesAcceso';
import '../supervisor.css';

const PersonalPanel = lazy(() => import('../admin/PersonalPanel'));
const PuestosPanel = lazy(() => import('../admin/PuestosPanel'));
const HorariosPanel = lazy(() => import('../admin/HorariosPanel'));
const PlaneacionPersonalPanel = lazy(() => import('../admin/PlaneacionPersonalPanel'));
const ReporteAsistenciaTipoPanel = lazy(() => import('../admin/reportes/ReporteAsistenciaTipoPanel'));

const GROUPS = [
  {
    label: 'Recursos Humanos',
    items: [
      { id: 'personal', label: 'Personal', permiso: PERMISOS.ADMINISTRAR_PERSONAL, icon: <Users size={17} /> },
      { id: 'puestos', label: 'Puestos', permiso: PERMISOS.ADMINISTRAR_PUESTOS, icon: <BriefcaseBusiness size={17} /> },
      { id: 'horarios', label: 'Horarios', permiso: PERMISOS.ADMINISTRAR_HORARIOS, icon: <Clock3 size={17} /> },
      { id: 'planeacion', label: 'Planeación de personal', permiso: PERMISOS.PLANEACION_PERSONAL, icon: <CalendarRange size={17} /> },
    ],
  },
  {
    label: 'Asistencia y pagos',
    items: [
      { id: 'eventuales', label: 'Eventuales y pagos', permiso: PERMISOS.REPORTES_EVENTUALES, icon: <FileClock size={17} /> },
      { id: 'practicantes', label: 'Practicantes', permiso: PERMISOS.REPORTES_PRACTICANTES, icon: <GraduationCap size={17} /> },
      { id: 'mexico', label: 'Asistencia México', permiso: PERMISOS.REPORTES_MEXICO, icon: <Users size={17} /> },
    ],
  },
];

export default function RHDashboard() {
  const { profile, logout } = useAuth();
  const allowedGroups = useMemo(
    () => GROUPS
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => tienePermiso(profile, item.permiso)),
      }))
      .filter((group) => group.items.length),
    [profile]
  );
  const allowedItems = useMemo(
    () => allowedGroups.flatMap((group) => group.items),
    [allowedGroups]
  );
  const [tab, setTab] = useState('');
  const [open, setOpen] = useState(false);
  const [properties, setProperties] = useState([]);
  const [message, setMessage] = useState('');
  const [loadingProperties, setLoadingProperties] = useState(true);

  useEffect(() => {
    if (!allowedItems.length) {
      setTab('');
      return;
    }
    if (!allowedItems.some((item) => item.id === tab)) setTab(allowedItems[0].id);
  }, [allowedItems, tab]);

  useEffect(() => {
    let alive = true;
    setLoadingProperties(true);
    listarPropiedadesAsistencia(profile)
      .then((rows) => alive && setProperties(rows))
      .catch((error) => alive && setMessage(error?.message || 'No fue posible cargar propiedades.'))
      .finally(() => alive && setLoadingProperties(false));
    return () => { alive = false; };
  }, [profile]);

  const current = allowedItems.find((item) => item.id === tab);

  function renderContent() {
    if (!current) {
      return <div className="empty-state">Esta cuenta no tiene módulos de Recursos Humanos asignados.</div>;
    }
    if (tab === 'personal') {
      return <PersonalPanel propiedades={properties} setMessage={setMessage} />;
    }
    if (tab === 'puestos') {
      return <PuestosPanel setMessage={setMessage} />;
    }
    if (tab === 'horarios') {
      return <HorariosPanel setMessage={setMessage} />;
    }
    if (tab === 'planeacion') {
      return <PlaneacionPersonalPanel propiedades={properties} setMessage={setMessage} />;
    }
    return (
      <ReporteAsistenciaTipoPanel
        tipoPersonal={tab === 'eventuales' ? 'eventual' : tab === 'practicantes' ? 'practicante' : 'personal_mexico'}
      />
    );
  }

  return (
    <div className="app-page">
      <header className="admin-main-header">
        <div className="admin-header-left">
          {allowedItems.length > 1 && (
            <button type="button" className="admin-menu-button" onClick={() => setOpen(true)}>
              <Menu size={19} /> Menú
            </button>
          )}
          <div className="admin-header-brand"><strong>Recursos Humanos GMR</strong></div>
        </div>
        <button type="button" className="header-logout-button" onClick={logout}><LogOut size={18} />Salir</button>
      </header>

      <main className="admin-dashboard-page">
        <div className="admin-topbar-title">
          <p className="eyebrow">Recursos Humanos</p>
          <h1>{current?.label || 'Acceso restringido'}</h1>
        </div>
        {message && <MessageBox>{message}</MessageBox>}
        <section className="admin-panel-card">
          {loadingProperties && ['personal', 'planeacion'].includes(tab) ? (
            <DataLoadingState title="Cargando propiedades..." detail="Preparando el catálogo de personal." />
          ) : (
            <Suspense fallback={<DataLoadingState title="Cargando sección..." />}>
              {renderContent()}
            </Suspense>
          )}
        </section>
      </main>

      <div className={`admin-sidebar-overlay ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`admin-drawer ${open ? 'open' : ''}`}>
        <div className="admin-drawer-header">
          <strong>Recursos Humanos</strong>
          <button className="admin-drawer-close" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        <nav className="admin-drawer-nav grouped">
          {allowedGroups.map((group) => (
            <div className="admin-menu-group" key={group.label}>
              <div className="admin-menu-group-title"><span>{group.label}</span></div>
              {group.items.map((item) => (
                <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); setOpen(false); setMessage(''); }}>
                  {item.icon}<span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </div>
  );
}
