import { lazy, Suspense, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarRange,
  Clock3,
  ClipboardList,
  FileClock,
  GraduationCap,
  KeyRound,
  ListChecks,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
  X,
} from 'lucide-react';
import MessageBox from '../../components/MessageBox';
import DataLoadingState from '../../components/DataLoadingState';
import { useAuth } from '../../context/AuthContext';
import { useFirestoreCollectionState } from '../../hooks/useFirestoreCollection';

const PropiedadesPanel = lazy(() => import('./PropiedadesPanel'));
const AccesosPanel = lazy(() => import('./AccesosPanel'));
const PuestosPanel = lazy(() => import('./PuestosPanel'));
const HorariosPanel = lazy(() => import('./HorariosPanel'));
const PlaneacionPersonalPanel = lazy(() => import('./PlaneacionPersonalPanel'));
const PlantillasRecorridosPanel = lazy(() => import('./PlantillasRecorridosPanel'));
const PersonalPanel = lazy(() => import('./PersonalPanel'));
const DispositivosPanel = lazy(() => import('./DispositivosPanel'));
const IncidenciasRevisionPanel = lazy(() => import('./incidencias/IncidenciasRevisionPanel'));
const ReportesPanel = lazy(() => import('./reportes/ReportesPanel'));
const ReporteAsistenciaTipoPanel = lazy(() => import('./reportes/ReporteAsistenciaTipoPanel'));

const GROUPS = [
  {
    label: 'Administración general',
    icon: <Settings size={16} />,
    items: [
      { id: 'propiedades', label: 'Propiedades', icon: <Building2 size={17} /> },
      { id: 'accesos', label: 'Usuarios y accesos', icon: <KeyRound size={17} /> },
      { id: 'dispositivos', label: 'Dispositivos', icon: <Smartphone size={17} /> },
    ],
  },
  {
    label: 'Seguridad',
    icon: <ShieldCheck size={16} />,
    items: [
      { id: 'recorridos', label: 'Configurar recorridos', icon: <ListChecks size={17} /> },
      { id: 'reporte_recorridos', label: 'Reporte de recorridos', icon: <BarChart3 size={17} /> },
      { id: 'reporte_incidencias', label: 'Incidencias', icon: <AlertCircle size={17} /> },
    ],
  },
  {
    label: 'Recursos Humanos',
    icon: <Users size={16} />,
    items: [
      { id: 'personal', label: 'Personal', icon: <ClipboardList size={17} /> },
      { id: 'puestos', label: 'Puestos', icon: <BriefcaseBusiness size={17} /> },
      { id: 'horarios', label: 'Horarios', icon: <Clock3 size={17} /> },
      { id: 'planeacion', label: 'Planeación de personal', icon: <CalendarRange size={17} /> },
    ],
  },
  {
    label: 'Asistencia y pagos',
    icon: <FileClock size={16} />,
    items: [
      { id: 'reporte_eventuales', label: 'Eventuales y pagos', icon: <FileClock size={17} /> },
      { id: 'reporte_practicantes', label: 'Practicantes', icon: <GraduationCap size={17} /> },
      { id: 'reporte_mexico', label: 'Asistencia México', icon: <Users size={17} /> },
    ],
  },
];

export default function AdminDashboard() {
  const { profile, logout } = useAuth();
  const [tabActiva, setTabActiva] = useState('reporte_recorridos');
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState('');

  const necesitaPropiedades = [
    'propiedades',
    'recorridos',
    'accesos',
    'personal',
    'planeacion',
    'dispositivos',
    'reporte_recorridos',
    'reporte_incidencias',
  ].includes(tabActiva);

  const propiedadesState = useFirestoreCollectionState(
    'propiedades',
    'nombre',
    necesitaPropiedades
  );
  const propiedades = propiedadesState.items;

  const usuariosState = useFirestoreCollectionState(
    'usuarios',
    'nombre',
    tabActiva === 'accesos'
  );
  const usuarios = usuariosState.items;

  const plantillasState = useFirestoreCollectionState(
    'plantillasRecorridos',
    'nombre',
    tabActiva === 'recorridos'
  );
  const plantillas = plantillasState.items;

  const dispositivosState = useFirestoreCollectionState(
    'dispositivos',
    'nombre',
    tabActiva === 'dispositivos'
  );
  const dispositivos = dispositivosState.items;

  const activeDataLoading =
    (necesitaPropiedades && propiedadesState.loading) ||
    (tabActiva === 'accesos' && usuariosState.loading) ||
    (tabActiva === 'recorridos' && plantillasState.loading) ||
    (tabActiva === 'dispositivos' && dispositivosState.loading);

  const allTabs = useMemo(() => GROUPS.flatMap((group) => group.items), []);
  const current = allTabs.find((item) => item.id === tabActiva);
  const currentGroup = GROUPS.find((group) =>
    group.items.some((item) => item.id === tabActiva)
  );

  function changeTab(id) {
    setTabActiva(id);
    setMenuOpen(false);
    setMessage('');
  }

  function renderContent() {
    switch (tabActiva) {
      case 'propiedades':
        return (
          <PropiedadesPanel
            userId={profile.id}
            propiedades={propiedades}
            setMessage={setMessage}
          />
        );

      case 'accesos':
        return (
          <AccesosPanel
            usuarios={usuarios}
            propiedades={propiedades}
            setMessage={setMessage}
          />
        );

      case 'puestos':
        return <PuestosPanel setMessage={setMessage} />;

      case 'horarios':
        return <HorariosPanel setMessage={setMessage} />;

      case 'planeacion':
        return <PlaneacionPersonalPanel propiedades={propiedades} setMessage={setMessage} />;

      case 'recorridos':
        return (
          <PlantillasRecorridosPanel
            userId={profile.id}
            plantillas={plantillas}
            propiedades={propiedades}
            setMessage={setMessage}
          />
        );

      case 'personal':
        return (
          <PersonalPanel
            propiedades={propiedades}
            setMessage={setMessage}
          />
        );

      case 'dispositivos':
        return (
          <DispositivosPanel
            userId={profile.id}
            dispositivos={dispositivos}
            propiedades={propiedades}
            setMessage={setMessage}
          />
        );

      case 'reporte_incidencias':
        return (
          <IncidenciasRevisionPanel
            profile={profile}
            propiedades={propiedades}
          />
        );

      case 'reporte_eventuales':
        return <ReporteAsistenciaTipoPanel tipoPersonal="eventual" />;

      case 'reporte_practicantes':
        return <ReporteAsistenciaTipoPanel tipoPersonal="practicante" />;

      case 'reporte_mexico':
        return <ReporteAsistenciaTipoPanel tipoPersonal="personal_mexico" />;

      case 'reporte_recorridos':
        return <ReportesPanel propiedades={propiedades} />;

      default:
        return null;
    }
  }

  return (
    <div className="app-page">
      <header className="admin-main-header">
        <div className="admin-header-left">
          <button
            type="button"
            className="admin-menu-button header-menu-button"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={19} />
            Menú
          </button>

          <div className="admin-header-brand">
            <div className="admin-header-icon">
              <ShieldCheck size={24} />
            </div>
            <strong>Panel Admin GMR</strong>
          </div>
        </div>

        <button
          type="button"
          className="header-logout-button"
          onClick={logout}
        >
          <LogOut size={18} />
          Salir
        </button>
      </header>

      <main className="admin-dashboard-page">
        <div className="admin-topbar-compact">
          <div className="admin-topbar-title">
            <p className="eyebrow">{currentGroup?.label || 'Panel de admin'}</p>
            <h1>{current?.label || 'Administrador'}</h1>
          </div>
        </div>

        {message && <MessageBox>{message}</MessageBox>}

        <section className="admin-panel-card">
          {activeDataLoading ? (
            <DataLoadingState
              title="Cargando información..."
              detail="Consultando los datos necesarios para esta sección."
            />
          ) : (
            <Suspense fallback={<DataLoadingState title="Cargando sección..." detail="Preparando la información del módulo." />}>
              {renderContent()}
            </Suspense>
          )}
        </section>
      </main>

      <div
        className={`admin-sidebar-overlay ${menuOpen ? 'show' : ''}`}
        onClick={() => setMenuOpen(false)}
      />

      <aside className={`admin-drawer ${menuOpen ? 'open' : ''}`}>
        <div className="admin-drawer-header">
          <div>
            <p className="eyebrow">Panel Admin GMR</p>
            <strong>Menú</strong>
          </div>

          <button
            type="button"
            className="admin-drawer-close"
            onClick={() => setMenuOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="admin-drawer-nav grouped">
          {GROUPS.map((group) => (
            <div className="admin-menu-group" key={group.label}>
              <div className="admin-menu-group-title">
                {group.icon}
                <span>{group.label}</span>
              </div>

              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={tabActiva === item.id ? 'active' : ''}
                  onClick={() => changeTab(item.id)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </div>
  );
}
