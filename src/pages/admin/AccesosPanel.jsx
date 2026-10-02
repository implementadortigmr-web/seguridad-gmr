import { useState } from 'react';
import { KeyRound, ShieldCheck, UserCog, Users } from 'lucide-react';
import PermisosPanel from './PermisosPanel';
import RolesPanel from './RolesPanel';
import UsuariosPanel from './UsuariosPanel';

const SECCIONES = [
  { id: 'usuarios', label: 'Usuarios', icon: <Users size={17} /> },
  { id: 'roles', label: 'Roles', icon: <UserCog size={17} /> },
  { id: 'permisos', label: 'Permisos', icon: <ShieldCheck size={17} /> },
];

export default function AccesosPanel({
  usuarios = [],
  propiedades = [],
  setMessage,
}) {
  const [seccion, setSeccion] = useState('usuarios');

  return (
    <section className="access-management-panel">
      <div className="catalog-toolbar access-management-heading">
        <div>
          <p className="eyebrow">Administración general</p>
          <h2>Usuarios y accesos</h2>
          <p className="muted admin-intro">
            Administra cuentas, consulta qué significa cada rol y ajusta los permisos de cada usuario desde un solo lugar.
          </p>
        </div>
        <div className="access-management-icon" aria-hidden="true">
          <KeyRound size={24} />
        </div>
      </div>

      <div className="catalog-segmented-tabs access-management-tabs" role="tablist" aria-label="Usuarios y accesos">
        {SECCIONES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={seccion === item.id}
            className={seccion === item.id ? 'active' : ''}
            onClick={() => {
              setSeccion(item.id);
              setMessage?.('');
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      <div className="access-management-content">
        {seccion === 'usuarios' ? (
          <UsuariosPanel
            usuarios={usuarios}
            propiedades={propiedades}
            setMessage={setMessage}
          />
        ) : seccion === 'roles' ? (
          <RolesPanel />
        ) : (
          <PermisosPanel usuarios={usuarios} setMessage={setMessage} />
        )}
      </div>
    </section>
  );
}
