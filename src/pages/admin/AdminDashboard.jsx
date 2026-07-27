import { useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Building2,
  ListChecks,
  LogOut,
  Menu,
  ShieldCheck,
  Smartphone,
  UserCog,
  Users,
  X,
} from "lucide-react";

import MessageBox from "../../components/MessageBox";
import { useAuth } from "../../context/AuthContext";
import useFirestoreCollection from "../../hooks/useFirestoreCollection";

import PropiedadesPanel from "./PropiedadesPanel";
import RolesPanel from "./RolesPanel";
import IncidenciasPanel from "./IncidenciasPanel";
import PlantillasRecorridosPanel from "./PlantillasRecorridosPanel";
import UsuariosPanel from "./UsuariosPanel";
import DispositivosPanel from "./DispositivosPanel";
import ReportesPanel from "./reportes/ReportesPanel";

export default function AdminDashboard() {
  const { profile, logout } = useAuth();

  const [tabActiva, setTabActiva] = useState("reportes");
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState("");

  const usuarios = useFirestoreCollection("usuarios", "nombre");
  const roles = useFirestoreCollection("roles", "nombre");
  const propiedades = useFirestoreCollection("propiedades", "nombre");
  const tiposIncidencia = useFirestoreCollection("tiposIncidencia", "nombre");
  const plantillas = useFirestoreCollection("plantillasRecorridos", "nombre");
  const dispositivos = useFirestoreCollection("dispositivos", "nombre");
  const ejecuciones = useFirestoreCollection(
    "ejecucionesRecorridos",
    "iniciadaEn"
  );
  const evidencias = useFirestoreCollection("evidenciasPuntos", "capturadaEn");

  const tabs = useMemo(
    () => [
      {
        id: "propiedades",
        label: "Propiedades",
        icon: <Building2 size={17} />,
      },
      {
        id: "roles",
        label: "Roles",
        icon: <UserCog size={17} />,
      },
      {
        id: "incidencias",
        label: "Incidencias",
        icon: <AlertCircle size={17} />,
      },
      {
        id: "recorridos",
        label: "Recorridos",
        icon: <ListChecks size={17} />,
      },
      {
        id: "usuarios",
        label: "Usuarios",
        icon: <Users size={17} />,
      },
      {
        id: "dispositivos",
        label: "Dispositivos",
        icon: <Smartphone size={17} />,
      },
      {
        id: "reportes",
        label: "Reportes",
        icon: <BarChart3 size={17} />,
      },
    ],
    []
  );

  const currentTab = tabs.find((tab) => tab.id === tabActiva);

  function changeTab(tabId) {
    setTabActiva(tabId);
    setMenuOpen(false);
    setMessage("");
  }

  function renderContent() {
    switch (tabActiva) {
      case "propiedades":
        return (
          <PropiedadesPanel
            userId={profile.id}
            propiedades={propiedades}
            setMessage={setMessage}
          />
        );

      case "roles":
        return (
          <RolesPanel
            userId={profile.id}
            roles={roles}
            setMessage={setMessage}
          />
        );

      case "incidencias":
        return (
          <IncidenciasPanel
            userId={profile.id}
            tiposIncidencia={tiposIncidencia}
            setMessage={setMessage}
          />
        );

      case "recorridos":
        return (
          <PlantillasRecorridosPanel
            userId={profile.id}
            plantillas={plantillas}
            propiedades={propiedades}
            setMessage={setMessage}
          />
        );

      case "usuarios":
        return (
          <UsuariosPanel
            userId={profile.id}
            usuarios={usuarios}
            propiedades={propiedades}
            setMessage={setMessage}
          />
        );

      case "dispositivos":
        return (
          <DispositivosPanel
            userId={profile.id}
            dispositivos={dispositivos}
            propiedades={propiedades}
            setMessage={setMessage}
          />
        );

      case "reportes":
        return (
          <ReportesPanel
            ejecuciones={ejecuciones}
            evidencias={evidencias}
          />
        );

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

        <div>
          <strong>Panel Admin GMR</strong>
        </div>
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
            <p className="eyebrow">Panel de admin</p>
            <h1>{currentTab?.label || "Administrador"}</h1>
          </div>
        </div>

        {message && <MessageBox>{message}</MessageBox>}

        <div className="admin-content-shell">
          <section className="admin-panel-card">{renderContent()}</section>
        </div>
      </main>

      <div
        className={`admin-sidebar-overlay ${menuOpen ? "show" : ""}`}
        onClick={() => setMenuOpen(false)}
      />

      <aside className={`admin-drawer ${menuOpen ? "open" : ""}`}>
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

        <nav className="admin-drawer-nav">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tabActiva === tab.id ? "active" : ""}
              onClick={() => changeTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </aside>
    </div>
  );
}