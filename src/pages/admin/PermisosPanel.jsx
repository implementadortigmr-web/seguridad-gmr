import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save, ShieldCheck, UserRoundCog } from 'lucide-react';
import MessageBox from '../../components/MessageBox';
import {
  CATALOGO_PERMISOS,
  identificarPerfilAcceso,
  permisosEfectivos,
  permisosPerfil,
  permisosPermitidosParaRol,
  PERFILES_ACCESO,
} from '../../../shared/perfilesAcceso';
import { actualizarPermisosUsuario } from '../../services/personasAdminService';

function nombrePerfil(user) {
  const value = identificarPerfilAcceso(user);
  return PERFILES_ACCESO.find((item) => item.value === value)?.label || user?.rol || 'Sin perfil';
}

export default function PermisosPanel({ usuarios = [], setMessage }) {
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState('');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (Array.isArray(usuarios) ? usuarios : [])
      .filter((user) => !q || [user.nombre, user.correo, user.usuario, user.rol].some((value) => String(value || '').toLowerCase().includes(q)))
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
  }, [usuarios, search]);

  const selected = useMemo(() => rows.find((user) => user.id === selectedId) || (usuarios || []).find((user) => user.id === selectedId) || null, [rows, usuarios, selectedId]);
  const perfil = selected ? identificarPerfilAcceso(selected) : '';
  const admin = selected?.rol === 'administrador';

  useEffect(() => {
    if (!selected) {
      setDraft([]);
      return;
    }
    setDraft(permisosEfectivos(selected));
    setLocalMessage('');
  }, [selected]);

  const grupos = useMemo(() => {
    const map = new Map();
    const maximos = admin ? ['*'] : permisosPermitidosParaRol(selected?.rol);
    CATALOGO_PERMISOS
      .filter((permiso) => admin || maximos.includes(permiso.value))
      .forEach((permiso) => {
        const list = map.get(permiso.grupo) || [];
        list.push(permiso);
        map.set(permiso.grupo, list);
      });
    return [...map.entries()];
  }, [admin, selected?.rol]);

  function toggle(value) {
    if (admin) return;
    setDraft((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function resetPreset() {
    if (!selected || admin) return;
    setDraft(permisosPerfil(perfil));
    setLocalMessage('Se restauraron los permisos base del perfil. Guarda para aplicar el cambio.');
  }

  async function save() {
    if (!selected || admin || busy) return;
    setBusy(true);
    setLocalMessage('');
    setMessage?.('');
    try {
      await actualizarPermisosUsuario({ uid: selected.id, permisosSistema: draft });
      setLocalMessage('Permisos guardados. Se aplicarán en el siguiente inicio de sesión o recarga del usuario.');
      setMessage?.('Permisos del usuario actualizados correctamente.');
    } catch (error) {
      setLocalMessage(error?.message || 'No fue posible guardar los permisos.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="permission-editor">
      <div className="catalog-toolbar">
        <div>
          <h2>Permisos</h2>
          <p className="muted admin-intro">
            Los perfiles asignan permisos base y aquí puedes personalizar cada cuenta. Los permisos también se validan en backend y reglas de Firebase.
          </p>
        </div>
      </div>

      {localMessage && <MessageBox>{localMessage}</MessageBox>}

      <div className="permission-editor-layout">
        <aside className="permission-users-card">
          <label className="field-label">
            Buscar usuario
            <input className="text-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, correo o rol..." />
          </label>
          <div className="permission-user-list">
            {rows.map((user) => (
              <button key={user.id} type="button" className={selectedId === user.id ? 'active' : ''} onClick={() => setSelectedId(user.id)}>
                <span>{user.nombre || user.correo}</span>
                <small>{nombrePerfil(user)}</small>
              </button>
            ))}
            {!rows.length && <div className="empty-state">No hay usuarios con ese filtro.</div>}
          </div>
        </aside>

        <div className="permission-detail-card">
          {!selected ? (
            <div className="permission-empty"><UserRoundCog size={38} /><h3>Selecciona un usuario</h3><p>Podrás agregar o quitar permisos sin cambiar su propiedad asignada.</p></div>
          ) : (
            <>
              <div className="permission-user-header">
                <div>
                  <span className="eyebrow">{nombrePerfil(selected)}</span>
                  <h3>{selected.nombre || selected.correo}</h3>
                  <p>{selected.correo || selected.usuario || ''}</p>
                </div>
                <ShieldCheck size={30} />
              </div>

              {admin && <div className="permission-admin-note">El Administrador conserva acceso total y no se puede restringir desde este panel.</div>}

              <div className="permission-groups">
                {grupos.map(([grupo, permisos]) => (
                  <section key={grupo} className="permission-group-card">
                    <h4>{grupo}</h4>
                    <div className="permission-check-grid">
                      {permisos.map((permiso) => {
                        const checked = admin || draft.includes(permiso.value) || draft.includes('*');
                        return (
                          <label key={permiso.value} className={`permission-check ${checked ? 'checked' : ''}`}>
                            <input type="checkbox" checked={checked} disabled={admin} onChange={() => toggle(permiso.value)} />
                            <span>{permiso.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              {!admin && (
                <div className="permission-actions">
                  <button type="button" className="secondary-button" onClick={resetPreset} disabled={busy}><RotateCcw size={16} />Restablecer perfil</button>
                  <button type="button" className="primary-button" onClick={save} disabled={busy}><Save size={16} />{busy ? 'Guardando...' : 'Guardar permisos'}</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
