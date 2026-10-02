import { lazy, Suspense, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { ShieldCheck } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import MessageBox from './components/MessageBox';
import { routeForRole } from './utils/roles';
import LoginPage from './pages/LoginPage';
const GuardiaDashboard = lazy(() => import('./pages/guardia/GuardiaDashboard'));
const SupervisorDashboard = lazy(() => import('./pages/SupervisorDashboard'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const RHDashboard = lazy(() => import('./pages/rh/RHDashboard'));
const NominasDashboard = lazy(() => import('./pages/nominas/NominasDashboard'));
const AsistenciaDashboard = lazy(() => import('./modules/asistencia/AsistenciaDashboard'));

function LoadingPage() {
  return <main className="loading-page"><ShieldCheck size={44} /><div className="spinner-ring" /><p>Validando acceso...</p></main>;
}
function platformAllows(profile) {
  const allowed = Capacitor.isNativePlatform() ? ['guardia', 'asistencia'] : ['administrador', 'supervisor', 'rh', 'nominas'];
  return allowed.includes(profile?.rol);
}
function AccesoNoDisponible() {
  const { logout } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function salir() {
    if (busy) return;
    setBusy(true); setError('');
    try { await logout(); }
    catch { setError('No se pudo cerrar sesion. Intenta nuevamente.'); }
    finally { setBusy(false); }
  }
  return <main className="loading-page"><ShieldCheck size={40} /><h2>Acceso no disponible aqui</h2>
    <p>{Capacitor.isNativePlatform() ? 'Administracion y supervision se usan desde el portal web.' : 'La cuenta de guardia o Asistencia se usa desde la APK.'}</p>
    {error && <MessageBox type="error">{error}</MessageBox>}<button type="button" className="secondary-button" onClick={salir} disabled={busy}>Cerrar sesion y cambiar de cuenta</button></main>;
}
function Home() {
  const { profile, loading } = useAuth();
  if (loading) return <LoadingPage />;
  if (!profile) return <LoginPage mode={Capacitor.isNativePlatform() ? 'guardia' : 'admin'} />;
  if (!platformAllows(profile)) return <AccesoNoDisponible />;
  return <Navigate to={routeForRole(profile.rol)} replace />;
}
function ProtectedRoute({ allowedRoles, children }) {
  const { profile, loading } = useAuth();
  if (loading) return <LoadingPage />;
  if (!profile) return <Navigate to="/" replace />;
  if (!platformAllows(profile)) return <AccesoNoDisponible />;
  if (!allowedRoles.includes(profile.rol)) return <Navigate to={routeForRole(profile.rol)} replace />;
  return children;
}
function AppRoutes() {
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/admin-login" element={<Home />} />
    <Route path="/login" element={<Home />} />
    <Route path="/admin" element={<ProtectedRoute allowedRoles={['administrador']}><AdminDashboard /></ProtectedRoute>} />
    <Route path="/supervisor" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorDashboard /></ProtectedRoute>} />
    <Route path="/rh" element={<ProtectedRoute allowedRoles={['rh']}><RHDashboard /></ProtectedRoute>} />
    <Route path="/nominas" element={<ProtectedRoute allowedRoles={['nominas']}><NominasDashboard /></ProtectedRoute>} />
    <Route path="/guardia" element={<ProtectedRoute allowedRoles={['guardia']}><GuardiaDashboard /></ProtectedRoute>} />
    <Route path="/asistencia" element={<ProtectedRoute allowedRoles={['asistencia']}><Suspense fallback={<LoadingPage />}><AsistenciaDashboard /></Suspense></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
export default function App() { return <AuthProvider><Suspense fallback={<LoadingPage />}><AppRoutes /></Suspense></AuthProvider>; }
