import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock3, Download, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import { prepararFotoEventual } from '../../utils/prepararFotoEventual';
import { QRCodeCanvas } from 'qrcode.react';
import MessageBox from '../../components/MessageBox';
import {
  cargarCatalogoRegistroEventual,
  consultarSolicitudEventual,
  registrarSolicitudEventual,
} from '../../services/eventualesRegistroService';

const STORAGE_KEY = 'gmr.eventual.solicitud';

function leerGuardada() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

export default function RegistroEventualPage() {
  const [catalogo, setCatalogo] = useState({ puestos: [] });
  const [form, setForm] = useState({ nombre: '', telefono: '', puestoId: '', encargadoNombre: '', fotoRostro: '', aceptaRegistro: false });
  const [solicitud, setSolicitud] = useState(leerGuardada);
  const [estado, setEstado] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const qrRef = useRef(null);
  const [fotoBusy, setFotoBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    cargarCatalogoRegistroEventual()
      .then((data) => { if (alive) setCatalogo({ puestos: data?.puestos || [] }); })
      .catch((e) => { if (alive) setError(e?.message || 'No fue posible cargar el formulario.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function consultar(actual = solicitud) {
    if (!actual?.solicitudId || !actual?.consultaToken) return;
    setBusy(true); setError('');
    try {
      const data = await consultarSolicitudEventual(actual);
      setEstado(data);
    } catch (e) { setError(e?.message || 'No fue posible consultar la solicitud.'); }
    finally { setBusy(false); }
  }

  useEffect(() => { if (solicitud) consultar(solicitud); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await registrarSolicitudEventual(form);
      const saved = { solicitudId: result.solicitudId, consultaToken: result.consultaToken };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      setSolicitud(saved);
      setEstado({ ...result, fotoRostro: form.fotoRostro });
    } catch (e) { setError(e?.message || 'No fue posible enviar tu registro.'); }
    finally { setBusy(false); }
  }

  function nuevoRegistro() {
    localStorage.removeItem(STORAGE_KEY);
    setSolicitud(null); setEstado(null); setError('');
    setForm({ nombre: '', telefono: '', puestoId: '', encargadoNombre: '', fotoRostro: '', aceptaRegistro: false });
  }

  async function cargarFoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFotoBusy(true); setError('');
    try {
      const fotoRostro = await prepararFotoEventual(file);
      setForm((actual) => ({ ...actual, fotoRostro }));
    } catch (e) { setError(e?.message || 'No fue posible preparar la fotografía.'); }
    finally { setFotoBusy(false); }
  }

  async function descargarQr() {
    const qr = qrRef.current?.querySelector('canvas');
    if (!qr || !estado?.qr) return;
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 930;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 930);
    ctx.fillStyle = '#10283a'; ctx.fillRect(0, 0, 640, 100);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 33px Arial';
    ctx.fillText('SEGURIDAD GMR', 320, 62);
    if (estado?.fotoRostro) {
      try {
        const imagen = await new Promise((resolve, reject) => {
          const foto = new Image(); foto.onload = () => resolve(foto); foto.onerror = reject;
          foto.src = estado.fotoRostro;
        });
        const lado = 195; const escala = Math.max(lado / imagen.width, lado / imagen.height);
        ctx.save(); ctx.beginPath(); ctx.arc(320, 230, 96, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(imagen, 320 - imagen.width * escala / 2, 230 - imagen.height * escala / 2,
          imagen.width * escala, imagen.height * escala); ctx.restore();
      } catch { /* QR sigue descargable si la foto no carga */ }
    }
    ctx.drawImage(qr, 142, 360, 356, 356);
    ctx.fillStyle = '#10283a'; ctx.font = 'bold 28px Arial';
    ctx.fillText(String(estado.nombre || '').slice(0, 37), 320, 760);
    ctx.font = '23px Arial'; ctx.fillText(estado.puestoNombre || 'Eventual', 320, 795);
    ctx.font = 'bold 20px Arial'; ctx.fillText(estado.clave || '', 320, 831);
    ctx.fillStyle = '#5a6972'; ctx.font = '17px Arial';
    ctx.fillText('Presenta tu QR y permite que comparen tu fotografía.', 320, 877);
    const a = document.createElement('a');
    a.download = `Credencial_${String(estado.nombre || 'eventual').replace(/\s+/g, '_')}.png`;
    a.href = canvas.toDataURL('image/png'); a.click();
  }

  const tituloEstado = useMemo(() => {
    if (estado?.estado === 'aprobada') return '¡Tu credencial está lista!';
    if (estado?.estado === 'rechazada') return 'Solicitud no aprobada';
    return 'Registro completado';
  }, [estado]);

  return <main className="public-eventual-page">
    <section className="public-eventual-card">
      <div className="public-eventual-brand"><ShieldCheck size={34} /><div><strong>SEGURIDAD GMR</strong><span>Registro de personal eventual</span></div></div>
      {error && <MessageBox type="error">{error}</MessageBox>}
      {loading ? <p>Cargando formulario...</p> : solicitud ? (
        <div className="public-eventual-status">
          {estado?.estado === 'aprobada' ? <CheckCircle2 size={54} /> : <Clock3 size={54} />}
          <h1>{tituloEstado}</h1>
          <p>Folio: <strong>{estado?.folio || 'Consultando...'}</strong></p>
          {estado?.estado === 'pendiente' && <p>Tu solicitud anterior aún está pendiente. Consulta a Recursos Humanos.</p>}
          {estado?.estado === 'rechazada' && <p>{estado?.motivoRechazo || 'Consulta con Recursos Humanos.'}</p>}
          {estado?.estado === 'aprobada' && <>
            <p><strong>{estado.nombre}</strong><br />{estado.puestoNombre}</p>
            <div className="public-eventual-qr" ref={qrRef}>{estado.fotoRostro && <img src={estado.fotoRostro} alt="Foto de identificación del eventual" className="public-eventual-photo" />}<QRCodeCanvas value={estado.qr || estado.clave} size={230} level="M" includeMargin /><strong>{estado.clave}</strong></div>
            <button type="button" className="primary-button" onClick={descargarQr}><Download size={17} /> Descargar mi credencial con foto y QR</button><p className="public-eventual-privacy">La fotografía sirve para identificarte visualmente al registrar asistencia.</p>
          </>}
          <div className="public-eventual-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => consultar()}><RefreshCw size={16} /> {busy ? 'Consultando...' : 'Actualizar estado'}</button>
            {(estado?.estado === 'rechazada' || estado?.estado === 'pendiente' || estado?.estado === 'aprobada') && <button type="button" className="secondary-button" onClick={nuevoRegistro}>Registrar a otra persona</button>}
          </div>
        </div>
      ) : (
        <form onSubmit={enviar} className="public-eventual-form">
          <div><UserPlus size={34} /><h1>Regístrate como personal eventual</h1><p>Completa tus datos, agrega tu fotografía y recibe tu código QR al momento.</p></div>
          <label>Nombre completo<input required maxLength={160} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></label>
          <label>Teléfono<input required inputMode="tel" maxLength={40} value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></label>
          <label>Puesto<select required value={form.puestoId} onChange={(e) => setForm({ ...form, puestoId: e.target.value })}><option value="">Selecciona</option>{catalogo.puestos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
          <label>Encargado que te invitó (opcional)<input maxLength={160} value={form.encargadoNombre} onChange={(e) => setForm({ ...form, encargadoNombre: e.target.value })} /></label>
          <label className="public-eventual-photo-field">Fotografía de rostro (obligatoria)<input type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={cargarFoto} required={!form.fotoRostro} />{fotoBusy && <small>Preparando fotografía...</small>}{form.fotoRostro && <img src={form.fotoRostro} alt="Vista previa de tu fotografía" className="public-eventual-photo" />}</label>
          <label className="public-eventual-check"><input type="checkbox" checked={form.aceptaRegistro} onChange={(e) => setForm({ ...form, aceptaRegistro: e.target.checked })} /><span>Confirmo que mis datos y foto son míos y autorizo su uso para mi identificación y control de asistencia.</span></label>
          <button className="primary-button" disabled={busy || fotoBusy || !form.fotoRostro || !form.aceptaRegistro}>{busy ? 'Registrando...' : 'Registrarme y generar mi QR'}</button>
        </form>
      )}
    </section>
  </main>;
}
