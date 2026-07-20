import { Navigate, Route, Routes } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { routeForRole } from "./utils/roles";
import LoginPage from "./pages/LoginPage";
import GuardiaDashboard from "./pages/GuardiaDashboard";
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

function HomeRedirect() {
  const { profile, loading } = useAuth();

  if (loading) return <LoadingPage />;
  if (!profile) return <LoginPage />;

  return <Navigate to={routeForRole(profile.rol)} replace />;
}

function ProtectedRoute({ allowedRoles, children }) {
  const { profile, loading } = useAuth();

  if (loading) return <LoadingPage />;
  if (!profile) return <Navigate to="/" replace />;
  if (!allowedRoles.includes(profile.rol)) {
    return <Navigate to={routeForRole(profile.rol)} replace />;
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
            <AdminDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/supervisor"
        element={
          <ProtectedRoute allowedRoles={["supervisor"]}>
            <SupervisorDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/guardia"
        element={
          <ProtectedRoute allowedRoles={["guardia"]}>
            <GuardiaDashboard />
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
