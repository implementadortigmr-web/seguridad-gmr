import { Copy, RefreshCcw, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

const DEVICE_KEY = "seguridad_gmr_device_id";

function generarCodigoDispositivo() {
  const base = `${Date.now()}${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;

  const limpio = base
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 12)
    .padEnd(12, "X");

  return `GMR-${limpio.slice(0, 4)}-${limpio.slice(4, 8)}-${limpio.slice(
    8,
    12
  )}`;
}

function obtenerCodigoGuardado() {
  try {
    const guardado = window.localStorage.getItem(DEVICE_KEY);

    if (guardado) return guardado;

    const nuevo = generarCodigoDispositivo();

    window.localStorage.setItem(DEVICE_KEY, nuevo);

    return nuevo;
  } catch (error) {
    console.error("No se pudo usar localStorage:", error);
    return generarCodigoDispositivo();
  }
}

function obtenerCodigoDispositivo(deviceInfo) {
  return (
    deviceInfo?.codigoDispositivo ||
    deviceInfo?.deviceId ||
    deviceInfo?.identificador ||
    deviceInfo?.gmrDeviceId ||
    deviceInfo?.nativeDeviceId ||
    ""
  );
}

export default function UnauthorizedDeviceCard({
  deviceInfo,
  registeredDevice,
  message,
  onRefresh,
}) {
  const [copied, setCopied] = useState(false);
  const [codigoLocal, setCodigoLocal] = useState("");

  const codigoDesdeDevice = obtenerCodigoDispositivo(deviceInfo);
  const codigo = codigoDesdeDevice || codigoLocal;

  useEffect(() => {
    if (!codigoDesdeDevice) {
      setCodigoLocal(obtenerCodigoGuardado());
      return;
    }

    try {
      window.localStorage.setItem(DEVICE_KEY, codigoDesdeDevice);
    } catch {
      // No hacer nada
    }

    setCodigoLocal(codigoDesdeDevice);
  }, [codigoDesdeDevice]);

  async function copiarCodigo() {
    if (!codigo) return;

    try {
      await navigator.clipboard.writeText(codigo);
      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch (error) {
      console.error("No se pudo copiar el código:", error);
      alert(`Código del dispositivo:\n${codigo}`);
    }
  }

  return (
    <div className="unauthorized-device-card">
      <div className="device-icon-box">
        <Smartphone size={42} />
      </div>

      <h2>Dispositivo no autorizado</h2>

      <p>
        Este teléfono todavía no está registrado o no tiene permiso para usar la
        app de rondines.
      </p>

      {message && <div className="device-warning-message">{message}</div>}

      <div className="device-code-box">
        <span>Código del dispositivo</span>

        {codigo ? (
          <>
            <strong>{codigo}</strong>

            <button
              type="button"
              className="secondary-button"
              onClick={copiarCodigo}
            >
              <Copy size={16} />
              {copied ? "Copiado" : "Copiar código"}
            </button>
          </>
        ) : (
          <p>No fue posible obtener el código del dispositivo.</p>
        )}
      </div>

      <div className="device-info-box">
        <small>
          Modelo: {deviceInfo?.model || "No disponible"} <br />
          Sistema: {deviceInfo?.platform || "No disponible"}{" "}
          {deviceInfo?.osVersion || ""}
        </small>
      </div>

      {registeredDevice && registeredDevice.activo !== true && (
        <div className="device-warning-message">
          El dispositivo está registrado, pero se encuentra inactivo.
        </div>
      )}

      <button type="button" className="primary-button" onClick={onRefresh}>
        <RefreshCcw size={18} />
        Validar de nuevo
      </button>
    </div>
  );
}