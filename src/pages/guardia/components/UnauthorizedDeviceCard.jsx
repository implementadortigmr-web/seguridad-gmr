import { RefreshCw, Smartphone } from "lucide-react";
import { getDeviceMessage } from "../utils/guardiaHelpers";

export default function UnauthorizedDeviceCard({
  deviceStatus,
  deviceId,
  onRetry,
}) {
  return (
    <section className="route-card unauthorized-device-card">
      <div className="device-icon-box">
        <Smartphone size={34} />
      </div>

      <p className="eyebrow">Dispositivo no autorizado</p>
      <h2>{getDeviceMessage(deviceStatus, deviceId)}</h2>

      {deviceId && (
        <div className="device-id-display">
          <strong>ID del dispositivo</strong>
          <span>{deviceId}</span>
        </div>
      )}

      <button className="secondary-button" type="button" onClick={onRetry}>
        <RefreshCw size={17} />
        Validar de nuevo
      </button>
    </section>
  );
}