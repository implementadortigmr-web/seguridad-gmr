import { LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function AppHeader() {
  const { profile, logout } = useAuth();

  return (
    <header className="app-header">
      <div className="header-brand">
        <ShieldCheck size={28} />
        <div>
          <strong>Rondines Seguridad</strong>
          <span>{profile?.propiedad || "Sistema de seguridad"}</span>
        </div>
      </div>

      <button className="logout-button" onClick={logout}>
        <LogOut size={18} />
        Salir
      </button>
    </header>
  );
}
