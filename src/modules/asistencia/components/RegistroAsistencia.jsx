import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  Camera,
  CameraDirection,
  CameraResultType,
  CameraSource,
} from '@capacitor/camera';
import { App } from '@capacitor/app';
import {
  AlertTriangle,
  Camera as CameraIcon,
  Clock,
  LogIn,
  LogOut,
  QrCode,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { Scanner } from '@yudiel/react-qr-scanner';

import { compressImage } from '../../../utils/image';
import {
  llamarAsistencia,
  mensajeAsistencia,
  subirFotoAsistencia,
} from '../services/asistenciaService';
import {
  guardarBorrador,
  leerBorrador,
  quitarBorrador,
} from '../services/borradorService';
import CamaraAsistencia from './CamaraAsistencia';
import { useFeedback } from '../../../context/FeedbackContext';

function normalizar(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function esPropiedadMexico(propiedad) {
  return normalizar(
    `${propiedad?.codigo || ''} ${propiedad?.nombre || ''}`
  ).includes('MEXICO');
}

export default function RegistroAsistencia({
  profile,
  propiedad,
  onPendiente,
}) {
  const uid = profile?.id || profile?.uid || '';
  const mexico = esPropiedadMexico(propiedad);

  const [clave, setClave] = useState('');
  const [pin, setPin] = useState('');
  const [draft, setDraft] = useState(null);
  const [pendingShift, setPendingShift] = useState(null);
  const [turnosPendientes, setTurnosPendientes] = useState([]);
  const [loadingTurnos, setLoadingTurnos] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  const [preview, setPreview] = useState('');
  const [webCamera, setWebCamera] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [progress, setProgress] = useState('');

  const busyRef = useRef(false);
  const mounted = useRef(false);
  const draftRef = useRef(null);
  const generation = useRef(0);
  const feedback = useFeedback();
  const input = useRef(null);
  const pinInput = useRef(null);


  useEffect(() => {
    if (!error) return;
    feedback.error(error);
  }, [error, feedback]);

  useEffect(() => {
    if (!success) return;

    const titulo = success.jornadaReabierta || success.tipo === 'reapertura'
      ? 'Turno anterior continuado'
      : success.turnoAnteriorSinSalida
        ? 'Nueva entrada registrada'
        : success.tipo === 'entrada'
          ? 'Entrada registrada'
          : 'Salida registrada';

    const fecha = success.registradaEn
      ? new Date(success.registradaEn).toLocaleString('es-MX', {
          timeZone: propiedad?.asistencia?.zonaHoraria || 'America/Mexico_City',
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '';

    const nota = success.jornadaReabierta || success.tipo === 'reapertura'
      ? ' La salida reciente se anuló y el mismo turno quedó nuevamente en curso.'
      : success.turnoAnteriorSinSalida
        ? ' El turno anterior quedó marcado como Sin salida registrada.'
        : '';

    feedback.success(
      `${success.empleadoNombre || 'Empleado'}${fecha ? ` · ${fecha}` : ''}.${nota}`,
      { title: titulo }
    );

    setSuccess(null);
  }, [success, propiedad, feedback]);

  useEffect(() => {
    draftRef.current = draft;
    onPendiente?.(Boolean(draft || pendingShift));
  }, [draft, pendingShift, onPendiente]);

  useEffect(() => {
    mounted.current = true;

    let listener;
    let alive = true;

    async function boot() {
      try {
        const saved = await leerBorrador(uid);

        if (!alive) return;

        if (
          saved &&
          saved.propiedadId !== propiedad.id
        ) {
          setError(
            'Tienes un registro pendiente en otra propiedad. Finalízalo antes de continuar.'
          );
          onPendiente?.(true);
        } else if (saved) {
          draftRef.current = saved;
          setDraft(saved);
        }

        if (Capacitor.isNativePlatform()) {
          listener = await App.addListener(
            'appRestoredResult',
            async (event) => {
              if (
                event.pluginId !== 'Camera' ||
                !['getPhoto', 'takePhoto'].includes(
                  event.methodName
                )
              ) {
                return;
              }

              try {
                const pending =
                  await leerBorrador(uid);

                if (
                  !alive ||
                  !pending?.cameraPending ||
                  pending.propiedadId !==
                    propiedad.id
                ) {
                  return;
                }

                draftRef.current = pending;
                setDraft(pending);

                if (
                  event.success &&
                  event.data?.webPath
                ) {
                  await acceptPhoto(
                    event.data,
                    pending
                  );
                } else {
                  setError(
                    'No se tomó la fotografía. Inténtalo nuevamente.'
                  );
                }
              } catch (e) {
                if (alive) {
                  setError(
                    mensajeAsistencia(e)
                  );
                }
              }
            }
          );

          if (!alive) {
            await listener.remove();
          }
        }
      } catch (e) {
        if (alive) {
          setError(mensajeAsistencia(e));
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    boot();

    return () => {
      alive = false;
      mounted.current = false;
      generation.current += 1;
      listener?.remove();
      onPendiente?.(false);
    };

    // La instancia se reinicia por uid/propiedad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, propiedad.id]);

  useEffect(() => {
    if (!draft?.foto) {
      setPreview('');
      return;
    }

    const url = URL.createObjectURL(draft.foto);
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [draft?.foto]);

  async function persist(next) {
    await guardarBorrador(uid, next);

    if (mounted.current) {
      draftRef.current = next;
      setDraft(next);
    }
  }


  function fechaCorta(value) {
    if (!value) return 'Sin fecha';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin fecha';
    return date.toLocaleString('es-MX', {
      timeZone: propiedad?.asistencia?.zonaHoraria || 'America/Mexico_City',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  async function cargarTurnosPendientes() {
    if (mexico || !propiedad?.id) {
      setTurnosPendientes([]);
      return;
    }

    setLoadingTurnos(true);
    try {
      const result = await llamarAsistencia('asistenciaListarTurnosPendientes', {
        propiedadId: propiedad.id,
      });
      if (mounted.current) {
        setTurnosPendientes(Array.isArray(result?.rows) ? result.rows : []);
      }
    } catch (e) {
      if (mounted.current) setError(mensajeAsistencia(e));
    } finally {
      if (mounted.current) setLoadingTurnos(false);
    }
  }

  useEffect(() => {
    if (!loading && !mexico) cargarTurnosPendientes();
    // Se recarga al cambiar de propiedad o terminar el arranque.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, mexico, propiedad.id]);

  async function buscarClave(rawValue) {
    const codigo = String(rawValue || '')
      .trim()
      .toUpperCase();

    if (
      busyRef.current ||
      !codigo ||
      draft
    ) {
      return;
    }

    if (mexico && !/^\d{4}$/.test(pin)) {
      setError(
        'Captura el PIN de 4 dígitos.'
      );
      pinInput.current?.focus();
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError('');
    setSuccess(null);

    try {
      const pendiente =
        await leerBorrador(uid);

      if (pendiente) {
        throw new Error(
          'Primero finaliza el registro pendiente antes de buscar otra persona.'
        );
      }

      const result = await llamarAsistencia(
        'asistenciaConsultarEmpleado',
        {
          clave: codigo,
          propiedadId: propiedad.id,
          ...(mexico ? { pin } : {}),
        }
      );

      if (result?.movimiento === 'resolver_pendiente' && result?.turnoPendiente) {
        setPendingShift({
          empleado: result.empleado,
          turno: result.turnoPendiente,
        });
        setClave('');
        setPin('');
        setScannerOpen(false);
        return;
      }

      let confirmarNuevoTurnoReciente = false;
      let jornadaRecienteId = null;

      if (result?.movimiento === 'confirmar_turno_reciente' && result?.turnoReciente) {
        const reciente = result.turnoReciente;
        const salidaTexto = fechaCorta(reciente.salidaEn);
        const decision = await feedback.decision({
          type: 'warning',
          title: 'Salida registrada hace poco',
          message: `${result.empleado.nombre} registró salida ${salidaTexto} (${reciente.minutosDesdeSalida} min). ¿Qué deseas hacer?`,
          details: 'Continuar turno anula esa salida y conserva la auditoría. Nuevo turno mantiene la jornada anterior cerrada y crea una entrada independiente.',
          closeOnBackdrop: false,
          actions: [
            { value: 'cancelar', label: 'Cancelar' },
            { value: 'nuevo', label: 'Iniciar nuevo turno' },
            { value: 'continuar', label: 'Continuar turno anterior', primary: true },
          ],
        });

        if (!decision || decision === 'cancelar') {
          setClave('');
          setPin('');
          setScannerOpen(false);
          return;
        }

        if (decision === 'continuar') {
          const solicitudId = crypto.randomUUID();
          let reapertura = null;
          try {
            reapertura = await llamarAsistencia('asistenciaReabrirJornadaReciente', {
              solicitudId,
              empleadoId: result.empleado.id,
              propiedadId: propiedad.id,
              jornadaCerradaId: reciente.id,
            });
          } catch (reopenError) {
            const existing = await llamarAsistencia('asistenciaConsultarSolicitud', { solicitudId }).catch(() => null);
            if (existing?.confirmado && existing?.tipo === 'reapertura') {
              reapertura = { ...existing, jornadaReabierta: true };
            } else {
              throw reopenError;
            }
          }

          setSuccess({ ...reapertura, jornadaReabierta: true });
          setClave('');
          setPin('');
          setScannerOpen(false);
          await cargarTurnosPendientes();
          return;
        }

        if (decision === 'nuevo') {
          const confirmar = await feedback.confirm({
            type: 'warning',
            title: 'Confirmar nuevo turno',
            message: `La última jornada de ${result.empleado.nombre} terminó hace solo ${reciente.minutosDesdeSalida} min. ¿Confirmas que regresó para un turno diferente?`,
            confirmText: 'Sí, iniciar nuevo turno',
            cancelText: 'Cancelar',
            closeOnBackdrop: false,
          });

          if (!confirmar) {
            setClave('');
            setPin('');
            setScannerOpen(false);
            return;
          }

          confirmarNuevoTurnoReciente = true;
          jornadaRecienteId = reciente.id;
        }
      }

      const movimientoEfectivo = confirmarNuevoTurnoReciente
        ? 'entrada'
        : result.movimiento;

      const requiereFoto =
        mexico ||
        result?.propiedad?.asistencia?.[
          movimientoEfectivo === 'entrada'
            ? 'fotoEntrada'
            : 'fotoSalida'
        ] === true;

      const next = {
        solicitudId: crypto.randomUUID(),

        propiedadId: propiedad.id,
        propiedadNombre: propiedad.nombre,

        empleado: result.empleado,
        tipo: movimientoEfectivo,

        jornadaEsperadaId:
          result.jornadaAbierta?.id || null,

        entradaEn:
          result.jornadaAbierta?.entradaEn ||
          null,

        requiereFoto,

        validacionPin:
          result.validacionPin || '',

        confirmarNuevoTurnoReciente,
        jornadaRecienteId,

        foto: null,
        fotoPath: '',
        enviada: false,

        cameraPending: false,
      };

      await persist(next);

      setClave('');
      setPin('');
      setScannerOpen(false);
    } catch (e) {
      setError(mensajeAsistencia(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function buscar(event) {
    event.preventDefault();
    await buscarClave(clave);
  }

  async function acceptPhoto(
    photo,
    current = draftRef.current
  ) {
    if (!current) {
      throw new Error(
        'No hay una persona seleccionada.'
      );
    }

    const token = generation.current;
    let blob = photo;

    if (!(photo instanceof Blob)) {
      if (!photo?.webPath) {
        throw new Error(
          'No se recibió la fotografía.'
        );
      }

      await persist({
        ...current,
        cameraPending: false,
        cameraWebPath: photo.webPath,
      });

      const response = await fetch(
        photo.webPath
      );

      if (!response.ok) {
        throw new Error(
          'No se pudo leer la fotografía.'
        );
      }

      blob = await response.blob();
    }

    const file = new File(
      [blob],
      'asistencia.jpg',
      {
        type:
          blob.type || 'image/jpeg',
      }
    );

    const optimized =
      await compressImage(file);

    if (
      token !== generation.current ||
      !mounted.current
    ) {
      return;
    }

    await persist({
      ...current,
      foto: optimized,
      fotoPath: '',
      cameraPending: false,
      cameraWebPath: null,
      capturadaEnCliente:
        new Date().toISOString(),
    });

    setWebCamera(false);
    setError('');
  }

  async function tomarFotoNativa() {
    if (
      !draft ||
      busyRef.current
    ) {
      return;
    }

    setWebCamera(false);
    setError('');

    busyRef.current = true;
    setBusy(true);

    try {
      const pending = {
        ...draft,
        cameraPending: true,
      };

      await persist(pending);

      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType:
          CameraResultType.Uri,
        direction:
          CameraDirection.Front,
        quality: 65,
        width: 960,
        height: 960,
        allowEditing: false,
        correctOrientation: true,
        saveToGallery: false,
      });

      await acceptPhoto(
        photo,
        pending
      );
    } catch (e) {
      if (
        !/cancel/i.test(
          e?.message || ''
        )
      ) {
        setError(mensajeAsistencia(e));
      }

      const current =
        draftRef.current;

      if (current) {
        await persist({
          ...current,
          cameraPending: false,
        }).catch(() => {});
      }
    } finally {
      busyRef.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  async function tomarFoto() {
    if (!draft || busyRef.current) {
      return;
    }

    setError('');

    /*
     * En la APK usamos el flujo nativo estable que ya funcionaba:
     * abre la camara del telefono, solicita la frontal y regresa
     * automaticamente a la app con la fotografia capturada.
     *
     * Algunos fabricantes pueden ignorar la preferencia Front;
     * aun asi este flujo es mas estable que mantener un stream
     * embebido dentro del WebView.
     */
    if (Capacitor.isNativePlatform()) {
      await tomarFotoNativa();
      return;
    }

    setWebCamera(true);
  }


  async function prepararSalidaPendiente() {
    if (!pendingShift || busyRef.current) return;
    if (pendingShift.turno.propiedadId !== propiedad.id) {
      setError('La salida actual solo puede registrarse en la propiedad donde se abrió el turno.');
      return;
    }

    const next = {
      solicitudId: crypto.randomUUID(),
      propiedadId: propiedad.id,
      propiedadNombre: propiedad.nombre,
      empleado: pendingShift.empleado,
      tipo: 'salida',
      jornadaEsperadaId: pendingShift.turno.id,
      entradaEn: pendingShift.turno.entradaEn,
      requiereFoto: false,
      validacionPin: '',
      foto: null,
      fotoPath: '',
      enviada: false,
      cameraPending: false,
    };

    await persist(next);
    setPendingShift(null);
    setError('');
  }

  async function marcarSinSalidaYNuevaEntrada() {
    if (!pendingShift || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setProgress('Cerrando turno anterior y registrando nueva entrada...');

    try {
      const result = await llamarAsistencia('asistenciaResolverTurnoPendiente', {
        solicitudId: crypto.randomUUID(),
        empleadoId: pendingShift.empleado.id,
        propiedadId: propiedad.id,
        jornadaPendienteId: pendingShift.turno.id,
      });
      setPendingShift(null);
      setSuccess(result);
      setClave('');
      await cargarTurnosPendientes();
    } catch (e) {
      setError(mensajeAsistencia(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress('');
    }
  }

  async function confirmar() {
    if (!draft || busyRef.current) {
      return;
    }

    if (
      draft.requiereFoto &&
      !draft.foto &&
      !draft.fotoPath
    ) {
      setError(
        'Toma una fotografía antes de continuar.'
      );
      return;
    }

    if (navigator.onLine === false) {
      setError(
        'Necesitas conexión a internet para registrar la asistencia.'
      );
      return;
    }

    busyRef.current = true;
    setBusy(true);

    setError('');
    setProgress(
      'Registrando asistencia...'
    );

    try {
      let current = {
        ...draft,
        enviada: true,
      };

      await persist(current);

      let result = null;

      const existing =
        await llamarAsistencia(
          'asistenciaConsultarSolicitud',
          {
            solicitudId:
              current.solicitudId,
          }
        );

      if (existing?.confirmado) {
        result = existing;
      }

      if (!result) {
        if (
          current.foto &&
          !current.fotoPath
        ) {
          setProgress(
            'Guardando fotografía...'
          );

          const path =
            await subirFotoAsistencia({
              borrador: current,
              uid,
            });

          current = {
            ...current,
            fotoPath: path,
          };

          await persist(current);
        }

        setProgress(
          'Confirmando registro...'
        );

        result =
          await llamarAsistencia(
            'asistenciaRegistrarMovimiento',
            {
              solicitudId:
                current.solicitudId,

              propiedadId:
                current.propiedadId,

              empleadoId:
                current.empleado.id,

              tipo: current.tipo,

              jornadaEsperadaId:
                current.jornadaEsperadaId,

              fotoPath:
                current.fotoPath || '',

              capturadaEnCliente:
                current.capturadaEnCliente ||
                null,

              validacionPin:
                current.validacionPin || '',

              confirmarNuevoTurnoReciente:
                current.confirmarNuevoTurnoReciente === true,

              jornadaRecienteId:
                current.jornadaRecienteId || null,
            }
          );
      }

      await quitarBorrador(uid);

      draftRef.current = null;
      setDraft(null);

      setSuccess(result);
      setClave('');
      setPin('');
      if (!mexico) await cargarTurnosPendientes();

      setTimeout(() => {
        input.current?.focus();
      }, 50);
    } catch (e) {
      setError(mensajeAsistencia(e));

      const current =
        draftRef.current;

      if (current) {
        await persist({
          ...current,
          enviada: false,
        }).catch(() => {});
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress('');
    }
  }

  async function cancelar() {
    if (
      !draft ||
      busyRef.current
    ) {
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError('');

    try {
      if (draft.enviada) {
        const result =
          await llamarAsistencia(
            'asistenciaConsultarSolicitud',
            {
              solicitudId:
                draft.solicitudId,
            }
          );

        if (result?.confirmado) {
          setSuccess(result);
        }
      }

      generation.current += 1;

      await quitarBorrador(uid);

      draftRef.current = null;
      setDraft(null);

      setClave('');
      setPin('');
      setPreview('');
    } catch (e) {
      setError(mensajeAsistencia(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="asistencia-simple-loading">
        <div className="pdf-loading-spinner" />
        <span>Cargando...</span>
      </div>
    );
  }

  return (
    <section className="asistencia-registro asistencia-registro-simple">
      {error && null}

      {success && null}

      {!mexico && !pendingShift && !draft && (
        <div className="asistencia-pending-summary">
          <div className="asistencia-pending-summary-header">
            <div>
              <span className="asistencia-eyebrow">Seguimiento</span>
              <h3>Turnos pendientes</h3>
            </div>
            <span className="asistencia-pending-count">{loadingTurnos ? '…' : turnosPendientes.length}</span>
          </div>
          {loadingTurnos ? (
            <div className="asistencia-pending-loading"><div className="pdf-loading-spinner" /> Revisando turnos pendientes...</div>
          ) : turnosPendientes.length ? (
            <div className="asistencia-pending-list">
              {turnosPendientes.slice(0, 5).map((turno) => (
                <div key={turno.id} className="asistencia-pending-item">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>{turno.empleadoNombre}</strong>
                    <span>{turno.puestoNombre || (turno.tipoPersonal === 'practicante' ? 'Practicante' : 'Eventual')} · Entrada {fechaCorta(turno.entradaEn)}</span>
                  </div>
                </div>
              ))}
              {turnosPendientes.length > 5 && <small>Y {turnosPendientes.length - 5} turno(s) pendiente(s) más.</small>}
            </div>
          ) : (
            <p className="asistencia-pending-empty"><Clock size={17} /> No hay turnos con salida pendiente en esta propiedad.</p>
          )}
        </div>
      )}

      {pendingShift ? (
        <div className="asistencia-pending-resolution">
          <div className="asistencia-pending-icon"><AlertTriangle size={28} /></div>
          <span className="asistencia-eyebrow">Turno anterior sin cerrar</span>
          <h2>{pendingShift.empleado.nombre}</h2>
          <p>{pendingShift.empleado.puestoNombre || (pendingShift.empleado.tipo === 'practicante' ? 'Practicante' : 'Eventual')}</p>

          <div className="asistencia-pending-details">
            <div><span>Entrada</span><strong>{fechaCorta(pendingShift.turno.entradaEn)}</strong></div>
            <div><span>Propiedad</span><strong>{pendingShift.turno.propiedadNombre || 'Propiedad'}</strong></div>
            <div><span>Tiempo abierto</span><strong>{pendingShift.turno.horasTranscurridas ?? '—'} h</strong></div>
          </div>

          <p className="asistencia-note">Seguridad no captura una hora manual. Elige según lo que está ocurriendo en este momento.</p>

          <div className="asistencia-pending-actions">
            {pendingShift.turno.propiedadId === propiedad.id && (
              <button type="button" className="asistencia-primary" disabled={busy} onClick={prepararSalidaPendiente}>
                <LogOut size={18} /> Registrar salida ahora
              </button>
            )}
            <button type="button" className="secondary-button" disabled={busy} onClick={marcarSinSalidaYNuevaEntrada}>
              <LogIn size={18} /> No checó salida e iniciar nuevo turno
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setPendingShift(null)}>
              Cancelar
            </button>
          </div>
          {progress && <div className="asistencia-progress"><div className="pdf-loading-spinner" /><span>{progress}</span></div>}
        </div>
      ) : !draft ? (
        <form
          onSubmit={buscar}
          className="asistencia-search asistencia-search-simple"
        >
          <div className="asistencia-search-icon">
            <UserRound size={30} />
          </div>

          <h2>
            Registrar entrada o salida
          </h2>

          {mexico ? (
            <>
              <label htmlFor="asistencia-clave">
                Clave del empleado
              </label>

              <input
                id="asistencia-clave"
                ref={input}
                value={clave}
                onChange={(e) =>
                  setClave(
                    e.target.value.toUpperCase()
                  )
                }
                placeholder="Escribe la clave"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={32}
                required
                disabled={busy}
              />

              <label
                htmlFor="asistencia-pin"
                style={{
                  marginTop: 14,
                }}
              >
                PIN
              </label>

              <input
                id="asistencia-pin"
                ref={pinInput}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) =>
                  setPin(
                    e.target.value
                      .replace(/\D/g, '')
                      .slice(0, 4)
                  )
                }
                placeholder="4 dígitos"
                maxLength={4}
                pattern="[0-9]{4}"
                required
                disabled={busy}
              />

              <button
                type="submit"
                className="asistencia-primary asistencia-large-button"
                disabled={
                  busy ||
                  !clave.trim() ||
                  pin.length !== 4
                }
              >
                <Search size={18} />
                {busy
                  ? 'Buscando...'
                  : 'Continuar'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="asistencia-primary asistencia-scan-button"
                onClick={() =>
                  setScannerOpen(true)
                }
                disabled={busy}
              >
                <QrCode size={20} />
                Escanear QR
              </button>

              <label htmlFor="asistencia-clave">
                Código manual
              </label>

              <input
                id="asistencia-clave"
                ref={input}
                value={clave}
                onChange={(e) =>
                  setClave(
                    e.target.value.toUpperCase()
                  )
                }
                placeholder="Escribe el código si no puedes escanear el QR"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={64}
                required
                disabled={busy}
              />

              <button
                type="submit"
                className="secondary-button asistencia-large-button"
                disabled={
                  busy || !clave.trim()
                }
              >
                Continuar
              </button>
            </>
          )}
        </form>
      ) : (
        <div className="asistencia-confirm asistencia-confirm-simple">
          <div className="asistencia-person-card">
            <span>Empleado</span>
            <h2>
              {draft.empleado.nombre}
            </h2>
            <p>
              {draft.empleado.clave}
            </p>
          </div>

          <div
            className={`asistencia-movement asistencia-movement-${draft.tipo}`}
          >
            {draft.tipo === 'entrada' ? (
              <LogIn size={28} />
            ) : (
              <LogOut size={28} />
            )}

            <strong>
              {draft.tipo === 'entrada'
                ? 'ENTRADA'
                : 'SALIDA'}
            </strong>
          </div>

          {draft.entradaEn &&
            draft.tipo === 'salida' && (
              <div className="asistencia-entry-reference">
                <span>
                  Entrada registrada
                </span>

                <strong>
                  {new Date(
                    draft.entradaEn
                  ).toLocaleString(
                    'es-MX',
                    {
                      timeZone:
                        propiedad
                          ?.asistencia
                          ?.zonaHoraria ||
                        'America/Mexico_City',
                      dateStyle:
                        'medium',
                      timeStyle:
                        'short',
                    }
                  )}
                </strong>
              </div>
            )}

          {draft.requiereFoto && (
            <div className="asistencia-photo-section">
              {preview ? (
                <div className="asistencia-photo-preview-container">
                  <img
                    className="asistencia-preview"
                    src={preview}
                    alt="Fotografía de asistencia"
                  />
                </div>
              ) : (
                <div className="asistencia-photo-placeholder">
                  <CameraIcon
                    size={36}
                  />
                  <strong>
                    Toma una fotografía
                  </strong>
                </div>
              )}

              <button
                type="button"
                className="secondary-button asistencia-photo-button"
                onClick={tomarFoto}
                disabled={busy}
              >
                <CameraIcon size={19} />
                {preview
                  ? 'Tomar otra foto'
                  : 'Tomar fotografía'}
              </button>
            </div>
          )}

          {progress && (
            <div className="asistencia-progress">
              <div className="pdf-loading-spinner" />
              <span>{progress}</span>
            </div>
          )}

          <div className="asistencia-actions asistencia-actions-simple">
            <button
              type="button"
              className="secondary-button"
              onClick={cancelar}
              disabled={busy}
            >
              Cancelar
            </button>

            <button
              type="button"
              className="asistencia-primary"
              onClick={confirmar}
              disabled={
                busy ||
                (draft.requiereFoto &&
                  !draft.foto &&
                  !draft.fotoPath)
              }
            >
              {busy
                ? 'Registrando...'
                : draft.tipo ===
                    'entrada'
                  ? 'Registrar entrada'
                  : 'Registrar salida'}
            </button>
          </div>
        </div>
      )}

      {scannerOpen && !mexico && (
        <div className="asistencia-camera-overlay">
          <div className="asistencia-camera-card asistencia-scanner-card">
            <div className="asistencia-scanner-header">
              <div>
                <span className="asistencia-eyebrow">
                  Identificación
                </span>
                <h3>Escanear QR</h3>
              </div>

              <button
                type="button"
                onClick={() =>
                  setScannerOpen(false)
                }
              >
                <X size={18} />
              </button>
            </div>

            <Scanner
              constraints={{
                facingMode:
                  'environment',
              }}
              onScan={(result) => {
                const value =
                  result?.[0]
                    ?.rawValue;

                if (value) {
                  buscarClave(value);
                }
              }}
              onError={(scannerError) =>
                setError(
                  scannerError?.message ||
                    'No fue posible abrir el lector QR.'
                )
              }
            />
          </div>
        </div>
      )}

      {webCamera && (
        <CamaraAsistencia
          onPhoto={acceptPhoto}
          onClose={() =>
            setWebCamera(false)
          }
          onFallback={
            Capacitor.isNativePlatform()
              ? tomarFotoNativa
              : undefined
          }
        />
      )}
    </section>
  );
}
