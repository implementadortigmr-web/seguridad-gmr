import { useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw } from 'lucide-react';
import MessageBox from '../../../components/MessageBox';

/**
 * Camara frontal embebida.
 * Se usa principalmente en Mexico para evitar que algunos Xiaomi
 * abran la camara trasera aunque CameraDirection.Front sea solicitado.
 */
export default function CamaraAsistencia({
  onPhoto,
  onClose,
  onFallback,
}) {
  const video = useRef(null);
  const streamRef = useRef(null);

  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [opening, setOpening] = useState(true);

  useEffect(() => {
    let alive = true;

    async function abrirCamaraFrontal() {
      setOpening(true);
      setError('');

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          'No fue posible abrir la cámara frontal desde la app.'
        );
        setOpening(false);
        return;
      }

      try {
        let stream;

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { exact: 'user' },
              width: { ideal: 960 },
              height: { ideal: 960 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 960 },
              height: { ideal: 960 },
            },
            audio: false,
          });
        }

        if (!alive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => {});
        }
      } catch (e) {
        if (alive) {
          setError(
            'No se pudo abrir la cámara frontal. Verifica el permiso de cámara.'
          );
        }
      } finally {
        if (alive) setOpening(false);
      }
    }

    abrirCamaraFrontal();

    return () => {
      alive = false;
      streamRef.current
        ?.getTracks()
        ?.forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  async function capture() {
    if (
      !video.current?.videoWidth ||
      !video.current?.videoHeight ||
      capturing
    ) {
      return;
    }

    setCapturing(true);
    setError('');

    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(
        960 / video.current.videoWidth,
        1
      );

      canvas.width = Math.round(
        video.current.videoWidth * scale
      );
      canvas.height = Math.round(
        video.current.videoHeight * scale
      );

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error(
          'No se pudo preparar la fotografía.'
        );
      }

      context.drawImage(
        video.current,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const blob = await new Promise((resolve) => {
        canvas.toBlob(
          resolve,
          'image/jpeg',
          0.68
        );
      });

      if (!blob) {
        throw new Error(
          'No se pudo capturar la fotografía.'
        );
      }

      await onPhoto(blob);
    } catch (e) {
      setError(
        e?.message ||
          'No se pudo capturar la fotografía.'
      );
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div
      className="asistencia-camera-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Tomar fotografía de asistencia"
    >
      <section className="asistencia-camera-card asistencia-front-camera-card">
        <div className="asistencia-camera-title">
          <div>
            <span>Fotografía</span>
            <h3>Cámara frontal</h3>
          </div>

          <Camera size={22} />
        </div>

        <div className="asistencia-front-camera-preview">
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            onLoadedData={() => setReady(true)}
          />

          {opening && (
            <div className="asistencia-camera-state">
              Abriendo cámara...
            </div>
          )}
        </div>

        {error && (
          <MessageBox type="error">{error}</MessageBox>
        )}

        <div className="asistencia-actions">
          <button
            type="button"
            onClick={onClose}
            disabled={capturing}
          >
            Cancelar
          </button>

          {error && typeof onFallback === 'function' ? (
            <button
              type="button"
              className="secondary-button"
              disabled={capturing}
              onClick={onFallback}
            >
              <RotateCcw size={17} />
              Abrir cámara del teléfono
            </button>
          ) : (
            <button
              type="button"
              className="asistencia-primary"
              onClick={capture}
              disabled={!ready || capturing}
            >
              <Camera size={18} />
              {capturing ? 'Capturando...' : 'Tomar foto'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
