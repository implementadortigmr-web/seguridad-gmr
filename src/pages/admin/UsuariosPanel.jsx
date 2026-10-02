import { useMemo, useState } from 'react';
import { Edit3, KeyRound, Plus, Save } from 'lucide-react';
import CatalogTable from '../../components/CatalogTable';
import FormModal from '../../components/admin/FormModal';
import DataLoadingState from '../../components/DataLoadingState';
import {
  guardarPersonal,
  guardarUsuarioSistema,
  listarPersonalPorTipo,
} from '../../services/personasAdminService';
import {
  PERFILES_ACCESO,
  identificarPerfilAcceso,
  expandirPerfilAcceso,
} from '../../../shared/perfilesAcceso';

const EMPTY_ACCESS = {
  uid: '',
  nombre: '',
  acceso: '',
  clave: '',
  perfilAcceso: 'guardia',
  propiedadesPermitidas: [],
  activo: true,
  permisosSistema: undefined,
};

const EMPTY_MEXICO = {
  uid: '',
  nombre: '',
  acceso: '',
  clave: '',
  perfilAcceso: '',
  propiedadesPermitidas: [],
  activo: true,
  telefono: '',
  area: '',
  pin: '',
  pinConfirm: '',
};

export default function UsuariosPanel({
  usuarios = [],
  propiedades = [],
  setMessage,
}) {
  const [section, setSection] = useState('accesos');
  const [mexicoRows, setMexicoRows] = useState([]);
  const [mexicoLoading, setMexicoLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(EMPTY_ACCESS);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const activeProperties = useMemo(
    () =>
      (Array.isArray(propiedades) ? propiedades : []).filter(
        (p) => p.activo === true
      ),
    [propiedades]
  );

  const mexico = useMemo(
    () =>
      activeProperties.find((p) => {
        const value = `${p.codigo || ''} ${p.nombre || ''}`
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toUpperCase();

        return value.includes('MEXICO');
      }),
    [activeProperties]
  );

  const rows = useMemo(
    () =>
      (Array.isArray(usuarios) ? usuarios : []).filter((u) => {
        const q = search.trim().toLowerCase();
        const perfil = identificarPerfilAcceso(u);

        return (
          (!roleFilter || perfil === roleFilter) &&
          (!q ||
            [u.nombre, u.correo, u.usuario, perfil].some((v) =>
              String(v || '').toLowerCase().includes(q)
            ))
        );
      }),
    [usuarios, search, roleFilter]
  );

  function propName(id) {
    if (id === '*' || id === 'todas') return 'Todas';

    return (
      activeProperties.find((p) => p.id === id)?.nombre ||
      id
    );
  }

  function propsLabel(list) {
    const ids = Array.isArray(list) ? list : [];

    return ids.includes('*')
      ? 'Todas'
      : ids.map(propName).join(', ') || 'Sin propiedades';
  }

  async function loadMexico() {
    if (!mexico?.id) {
      setMexicoRows([]);
      return;
    }

    setMexicoLoading(true);
    try {
      setMexicoRows(
        await listarPersonalPorTipo(
          'personal_mexico',
          mexico.id
        )
      );
    } catch (e) {
      setMessage?.(
        e?.message ||
          'No fue posible cargar personal de México.'
      );
    } finally {
      setMexicoLoading(false);
    }
  }

  function nuevo() {
    setEditingId('');
    setForm(
      section === 'accesos'
        ? { ...EMPTY_ACCESS }
        : { ...EMPTY_MEXICO }
    );
    setOpen(true);
  }

  function editarMexico(user) {
    setEditingId(user.id);

    setForm({
      ...EMPTY_MEXICO,
      nombre: user.nombre || '',
      acceso: user.clave || '',
      activo: user.activo !== false,
      telefono: user.telefono || '',
      area: user.area || '',
      pin: '',
      pinConfirm: '',
    });

    setOpen(true);
  }

  function editar(user) {
    const preset =
      identificarPerfilAcceso(user) || 'guardia';

    setEditingId(user.id);

    setForm({
      ...EMPTY_ACCESS,
      uid: user.id,
      nombre: user.nombre || '',
      acceso: user.usuario || user.correo || '',
      clave: '',
      perfilAcceso: preset,
      propiedadesPermitidas: Array.isArray(
        user.propiedadesPermitidas
      )
        ? user.propiedadesPermitidas
        : [],
      activo: user.activo === true,
      permisosSistema: Array.isArray(user.permisosSistema) ? user.permisosSistema : undefined,
    });

    setOpen(true);
  }

  function changeProfile(value) {
    const role = expandirPerfilAcceso(value).rol;

    setForm((current) => ({
      ...current,
      perfilAcceso: value,
      permisosSistema: expandirPerfilAcceso(value).permisosSistema,
      propiedadesPermitidas:
        role === 'administrador'
          ? ['*']
          : ['asistencia', 'nominas'].includes(role)
            ? mexico
              ? [mexico.id]
              : []
            : current.propiedadesPermitidas.filter(
                (id) => id !== '*'
              ),
    }));
  }

  function toggleProperty(id) {
    setForm((current) => ({
      ...current,
      propiedadesPermitidas:
        current.propiedadesPermitidas.includes(id)
          ? current.propiedadesPermitidas.filter(
              (value) => value !== id
            )
          : [
              ...current.propiedadesPermitidas.filter(
                (value) => value !== '*'
              ),
              id,
            ],
    }));
  }

  function validarPinMexico() {
    const pin = String(form.pin || '').trim();
    const confirm = String(form.pinConfirm || '').trim();

    if (!editingId && !pin) {
      throw new Error(
        'Captura un PIN de 4 dígitos para el empleado.'
      );
    }

    if (!pin) return '';

    if (!/^\d{4}$/.test(pin)) {
      throw new Error(
        'El PIN debe tener exactamente 4 dígitos.'
      );
    }

    if (pin !== confirm) {
      throw new Error('La confirmación del PIN no coincide.');
    }

    return pin;
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setMessage?.('');

    try {
      if (section === 'mexico') {
        if (!mexico?.id) {
          throw new Error(
            'Primero crea la propiedad México.'
          );
        }

        const pin = validarPinMexico();

        await guardarPersonal({
          empleadoId: editingId || undefined,
          propiedadId: mexico.id,
          tipo: 'personal_mexico',
          clave: form.acceso,
          nombre: form.nombre,
          telefono: form.telefono || '',
          area: form.area || '',
          activo: form.activo,
          ...(pin ? { pin } : {}),
        });

        await loadMexico();

        setMessage?.(
          editingId
            ? 'Personal de México actualizado correctamente.'
            : 'Personal de México creado correctamente.'
        );
      } else {
        await guardarUsuarioSistema({
          ...form,
          uid: editingId || '',
          propiedadesPermitidas:
            form.propiedadesPermitidas,
        });

        setMessage?.(
          'Usuario guardado. La tabla se actualiza con Firestore.'
        );
      }

      setOpen(false);
      setEditingId('');
      setForm({ ...EMPTY_ACCESS });
    } catch (error) {
      setMessage?.(
        error?.message ||
          'No fue posible guardar el usuario.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="catalog-toolbar">
        <div>
          <h2>Usuarios</h2>
          <p className="muted">
            El administrador controla las cuentas de acceso y
            el personal de México. Eventuales y practicantes se
            administran en Personal.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={nuevo}
        >
          <Plus size={17} />
          {section === 'mexico'
            ? 'Nuevo usuario México'
            : 'Nuevo usuario'}
        </button>
      </div>

      <div className="catalog-segmented-tabs">
        <button
          type="button"
          className={
            section === 'accesos' ? 'active' : ''
          }
          onClick={() => {
            setSection('accesos');
            setOpen(false);
          }}
        >
          Cuentas de acceso
        </button>

        <button
          type="button"
          className={
            section === 'mexico' ? 'active' : ''
          }
          onClick={() => {
            setSection('mexico');
            setOpen(false);
            loadMexico();
          }}
        >
          Personal México
        </button>
      </div>

      {section === 'accesos' ? (
        <>
          <div className="catalog-filter-row">
            <input
              className="text-input"
              placeholder="Buscar nombre, correo o usuario..."
              value={search}
              onChange={(e) =>
                setSearch(e.target.value)
              }
            />

            <select
              className="text-input"
              value={roleFilter}
              onChange={(e) =>
                setRoleFilter(e.target.value)
              }
            >
              <option value="">
                Todos los perfiles
              </option>

              {PERFILES_ACCESO.map((profile) => (
                <option
                  key={profile.value}
                  value={profile.value}
                >
                  {profile.label}
                </option>
              ))}
            </select>
          </div>

          <CatalogTable
            columns={[
              'Nombre',
              'Acceso',
              'Perfil',
              'Propiedades',
              'Estado',
              'Acción',
            ]}
            rows={rows.map((user) => [
              user.nombre,
              user.usuario || user.correo,
              PERFILES_ACCESO.find(
                (p) =>
                  p.value ===
                  identificarPerfilAcceso(user)
              )?.label || user.rol,
              propsLabel(
                user.propiedadesPermitidas
              ),
              user.activo ? 'Activo' : 'Inactivo',
              <button
                key={user.id}
                type="button"
                className="mini-button"
                onClick={() => editar(user)}
              >
                <Edit3 size={14} />
                Editar
              </button>,
            ])}
          />
        </>
      ) : (
        <>
          <div
            className="info-box"
            style={{ marginBottom: '14px' }}
          >
            El PIN se usa únicamente para confirmar
            entradas y salidas en la APK. No es una
            contraseña para iniciar sesión.
          </div>

          {mexicoLoading ? (
            <DataLoadingState
              title="Cargando personal de México..."
              detail="Consultando empleados y estado de acceso."
            />
          ) : (
            <CatalogTable
              columns={[
                'Clave',
                'Nombre',
                'Área',
                'Estado',
                'Acción',
              ]}
              rows={mexicoRows.map((user) => [
                user.clave,
                user.nombre,
                user.area || '—',
                user.activo !== false
                  ? 'Activo'
                  : 'Inactivo',
                <button
                  key={user.id}
                  type="button"
                  className="mini-button"
                  onClick={() =>
                    editarMexico(user)
                  }
                >
                  <Edit3 size={14} />
                  Editar
                </button>,
              ])}
            />
          )}
        </>
      )}

      <FormModal
        open={open}
        title={
          editingId
            ? section === 'mexico'
              ? 'Editar usuario México'
              : 'Editar usuario'
            : section === 'mexico'
              ? 'Nuevo usuario México'
              : 'Nuevo usuario'
        }
        subtitle={
          section === 'mexico'
            ? 'Datos utilizados para registrar asistencia.'
            : 'Cuenta que puede iniciar sesión en la plataforma o APK.'
        }
        onClose={() => !busy && setOpen(false)}
        busy={busy}
      >
        <form
          onSubmit={save}
          className="modal-form-grid"
        >
          <label className="field-label">
            Nombre
            <input
              className="text-input"
              required
              value={form.nombre}
              onChange={(e) =>
                setForm({
                  ...form,
                  nombre: e.target.value,
                })
              }
            />
          </label>

          {section === 'mexico' ? (
            <>
              <label className="field-label">
                Clave de empleado
                <input
                  className="text-input"
                  required
                  disabled={Boolean(editingId)}
                  value={form.acceso}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      acceso:
                        e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>

              <label className="field-label">
                Teléfono
                <input
                  className="text-input"
                  value={form.telefono || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      telefono: e.target.value,
                    })
                  }
                />
              </label>

              <label className="field-label">
                Área
                <input
                  className="text-input"
                  value={form.area || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      area: e.target.value,
                    })
                  }
                />
              </label>

              <label className="field-label">
                {editingId
                  ? 'Nuevo PIN de registro (opcional)'
                  : 'PIN de registro'}
                <div
                  style={{
                    position: 'relative',
                  }}
                >
                  <KeyRound
                    size={16}
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: 14,
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    className="text-input"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    required={!editingId}
                    value={form.pin || ''}
                    style={{ paddingLeft: 38 }}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        pin: e.target.value
                          .replace(/\D/g, '')
                          .slice(0, 4),
                      })
                    }
                  />
                </div>

                {editingId && (
                  <span className="helper-text">
                    Déjalo vacío para conservar el PIN
                    actual.
                  </span>
                )}
              </label>

              {(form.pin || !editingId) && (
                <label className="field-label">
                  Confirmar PIN
                  <input
                    className="text-input"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    required={Boolean(form.pin) || !editingId}
                    value={form.pinConfirm || ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        pinConfirm: e.target.value
                          .replace(/\D/g, '')
                          .slice(0, 4),
                      })
                    }
                  />
                </label>
              )}
            </>
          ) : (
            <>
              <label className="field-label">
                Usuario / correo
                <input
                  className="text-input"
                  required
                  value={form.acceso}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      acceso: e.target.value,
                    })
                  }
                />
                <span className="helper-text">
                  Seguridad puede usar usuario corto.
                  Admin, Supervisor, RH y Nóminas deben usar
                  correo.
                </span>
              </label>

              <label className="field-label">
                {editingId
                  ? 'Nueva clave (opcional)'
                  : 'Clave'}
                <input
                  className="text-input"
                  type="password"
                  required={!editingId}
                  value={form.clave}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      clave: e.target.value,
                    })
                  }
                />
                <span className="helper-text">
                  Para Seguridad se admite PIN de 4
                  dígitos por compatibilidad con la APK.
                </span>
              </label>

              <label className="field-label">
                Perfil
                <select
                  className="text-input"
                  value={form.perfilAcceso}
                  onChange={(e) =>
                    changeProfile(e.target.value)
                  }
                >
                  {PERFILES_ACCESO.map((profile) => (
                    <option
                      key={profile.value}
                      value={profile.value}
                    >
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <label className="field-label">
            Estado
            <select
              className="text-input"
              value={
                form.activo ? 'true' : 'false'
              }
              onChange={(e) =>
                setForm({
                  ...form,
                  activo:
                    e.target.value === 'true',
                })
              }
            >
              <option value="true">Activo</option>
              <option value="false">Inactivo</option>
            </select>
          </label>

          {section === 'accesos' &&
            (expandirPerfilAcceso(
              form.perfilAcceso
            ).rol === 'administrador' ? (
              <div className="info-box form-full">
                El administrador tiene acceso a todas
                las propiedades.
              </div>
            ) : expandirPerfilAcceso(
                form.perfilAcceso
              ).rol === 'asistencia' || expandirPerfilAcceso(
                form.perfilAcceso
              ).rol === 'nominas' ? (
              <div className="info-box form-full">
                {expandirPerfilAcceso(form.perfilAcceso).rol === 'nominas' ? 'Nóminas' : 'Seguridad México'} queda restringido
                automáticamente a{' '}
                {mexico?.nombre ||
                  'la propiedad México'}.
              </div>
            ) : (
              <div className="form-full">
                <p className="field-label">
                  Propiedades permitidas
                </p>

                <div className="checkbox-grid">
                  {activeProperties.map(
                    (property) => (
                      <label
                        className="checkbox-card"
                        key={property.id}
                      >
                        <input
                          type="checkbox"
                          checked={form.propiedadesPermitidas.includes(
                            property.id
                          )}
                          onChange={() =>
                            toggleProperty(
                              property.id
                            )
                          }
                        />

                        <span>
                          <strong>
                            {property.nombre}
                          </strong>
                          <small>
                            {property.codigo}
                          </small>
                        </span>
                      </label>
                    )
                  )}
                </div>
              </div>
            ))}

          <div className="admin-form-modal-actions form-full">
            <button
              className="primary-button"
              disabled={busy}
            >
              <Save size={16} />
              {busy
                ? 'Guardando...'
                : 'Guardar'}
            </button>
          </div>
        </form>
      </FormModal>
    </section>
  );
}
