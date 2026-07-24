import { Navigate, Route, Routes } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { signOut } from "firebase/auth";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { auth } from "./services/firebase";
import { routeForRole } from "./utils/roles";
import LoginPage from "./pages/LoginPage";
import GuardiaDashboard from "./pages/guardia/GuardiaDashboard";
import SupervisorDashboard from "./pages/SupervisorDashboard";
import AdminDashboard from "./pages/admin/AdminDashboard";

function LoadingPage() {
  return (
    <main className="loading-page">
      <ShieldCheck size={44} />
      <div className="spinner-ring" />
      <p>Validando acceso...</p>
    </main>
  );
}

async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error cerrando sesión:", error);
  } finally {
    try {
      localStorage.removeItem("usuarioActivo");
      sessionStorage.clear();
    } catch {
      // No hacer nada
    }

    window.location.hash = "#/";
    window.location.reload();
  }
}

function normalizarRol(rol) {
  return String(rol || "").trim().toLowerCase();
}

function HomeRedirect() {
  const { profile, loading } = useAuth();

  if (loading) return <LoadingPage />;
  if (!profile) return <LoginPage />;

  return <Navigate to={routeForRole(profile.rol)} replace />;
}

function ProtectedRoute({ allowedRoles = [], children }) {
  const { profile, loading } = useAuth();

  if (loading) return <LoadingPage />;
  if (!profile) return <Navigate to="/" replace />;

  const rol = normalizarRol(profile.rol);
  const rolesPermitidos = Array.isArray(allowedRoles) ? allowedRoles : [];

  if (!rolesPermitidos.includes(rol)) {
    return <Navigate to={routeForRole(rol)} replace />;
  }

  if (typeof children === "function") {
    return children({
      profile,
      logout,
    });
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />

      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={["administrador"]}>
            {({ profile, logout }) => (
              <AdminDashboard profile={profile} logout={logout} />
            )}
          </ProtectedRoute>
        }
      />

      <Route
        path="/supervisor"
        element={
          <ProtectedRoute allowedRoles={["supervisor"]}>
            {({ profile, logout }) => (
              <SupervisorDashboard profile={profile} logout={logout} />
            )}
          </ProtectedRoute>
        }
      />

      <Route
        path="/guardia"
        element={
          <ProtectedRoute allowedRoles={["guardia"]}>
            {({ profile, logout }) => (
              <GuardiaDashboard profile={profile} logout={logout} />
            )}
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}