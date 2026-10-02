export function routeForRole(rol) {
  const normalizedRole = String(rol || '').trim().toLowerCase();

  if (normalizedRole === 'administrador') return '/admin';
  if (normalizedRole === 'supervisor') return '/supervisor';
  if (normalizedRole === 'rh') return '/rh';
  if (normalizedRole === 'nominas') return '/nominas';
  if (normalizedRole === 'guardia') return '/guardia';
  if (normalizedRole === 'asistencia') return '/asistencia';

  return '/';
}
