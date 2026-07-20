import { Wifi, WifiOff } from "lucide-react";
import { useConnectionStatus } from "../hooks/useConnectionStatus";

export default function ConnectionBadge() {
  const online = useConnectionStatus();

  return (
    <span className={`connection-badge ${online ? "online" : "offline"}`}>
      {online ? <Wifi size={16} /> : <WifiOff size={16} />}
      {online ? "Con conexión" : "Sin conexión"}
    </span>
  );
}
