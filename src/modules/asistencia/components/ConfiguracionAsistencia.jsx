import { useRef, useState } from 'react';
import { llamarAsistencia, mensajeAsistencia } from '../services/asistenciaService';
import { normalizarClave } from '../../../../shared/asistenciaDomain';
import MessageBox from '../../../components/MessageBox';

export default function ConfiguracionAsistencia({ propiedades = [], onChange }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [usuario, setUsuario] = useState('SegMEX');
  const [password, setPassword] = useState('');
  const [aceptaClaveTemporal, setAceptaClaveTemporal] = useState(false);
  const [account, setAccount] = useState(null);
  const lock = useRef(false);
  const mexico = propiedades.find((p) => normalizarClave(p.codigo) === 'MEXICO' || normalizarClave(p.nombre) === 'MEXICO');
  const claveCorta = /^\d{4}$/.test(password);

  async function crearCuenta(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    let created = false;
    try {
      const result = await llamarAsistencia('asistenciaCrearAccesoMexico', { usuario, password, aceptaClaveTemporal });
      created = true; setAccount(result); setPassword(''); setAceptaClaveTemporal(false);
      setMessage('Cuenta creada. Usa la APK para entrar. No se inicio sesion con esta cuenta en el portal.');
      await onChange();
    } catch (e) {
      setMessage(created ? 'La cuenta se creo, pero no fue posible actualizar la pantalla. No la crees otra vez; pulsa Actualizar.' : mensajeAsistencia(e));
    } finally { lock.current = false; setBusy(false); }
  }

  return <section>
    <h2>Acceso de Seguridad Mexico</h2>
    <p className="asistencia-note">Mexico es una propiedad del catalogo, igual que los hoteles. No hay que habilitar el modulo por propiedad. El acceso depende del perfil y las propiedades asignadas al usuario.</p>
    <p>{mexico ? `Propiedad encontrada: ${mexico.nombre}. Se reutilizara sin cambiar su ID.` : 'Al crear esta cuenta se agregara Mexico si todavia no existe.'}</p>
    <p className="asistencia-note">Este perfil abre solo Asistencia / Eventuales en la APK y registra unicamente en Mexico. Cada empleado usa su propia clave para la checada. Se requiere foto en entrada y salida.</p>
    {message && <MessageBox>{message}</MessageBox>}
    <form className="asistencia-form-grid" onSubmit={crearCuenta}>
      <label>Usuario operativo<input required autoComplete="off" pattern="[A-Za-z0-9_-]{4,32}" value={usuario} onChange={(e) => setUsuario(e.target.value)} disabled={busy || Boolean(account)} /></label>
      <label>Clave o contrasena<input type="password" required minLength={4} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setAceptaClaveTemporal(false); }} disabled={busy || Boolean(account)} /></label>
      <p className="asistencia-full">Recomendado: 10 o mas caracteres con letras y numeros. Una clave de 4 digitos solo es adecuada para una prueba controlada; no identifica al empleado ni protege bien una cuenta compartida.</p>
      {claveCorta && <label className="asistencia-full" style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <input type="checkbox" checked={aceptaClaveTemporal} onChange={(e) => setAceptaClaveTemporal(e.target.checked)} disabled={busy} style={{ width: 'auto' }} />
        Usar clave provisional de 4 digitos. Entiendo que debe cambiarse antes de operacion y que este formulario no programa su caducidad.
      </label>}
      <button type="submit" disabled={busy || Boolean(account) || (claveCorta && !aceptaClaveTemporal)} className="asistencia-primary">{busy ? 'Creando acceso...' : 'Crear cuenta de Mexico'}</button>
    </form>
    {account && <div className="asistencia-success"><div><strong>Usuario creado: {account.usuario}</strong><p>Seguridad Mexico, solo asistencia y una sola propiedad.</p><small>UID: {account.uid}</small></div></div>}
    <p className="asistencia-note">Si el usuario ya existe, no se reemplaza su contrasena. En Usuarios puedes cambiar sus datos o perfil. Los otros guardias conservan sus permisos; no se les habilita Asistencia automaticamente.</p>
  </section>;
}
