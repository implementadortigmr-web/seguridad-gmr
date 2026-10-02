import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('frontend y backend comparten permisos de planeacion', () => {
  assert.equal(read('shared/perfilesAcceso.js'), read('functions/perfilesAcceso.js'));
  const source = read('shared/perfilesAcceso.js');
  assert.match(source, /ADMINISTRAR_HORARIOS:\s*'configuracion\.horarios'/);
  assert.match(source, /PLANEACION_PERSONAL:\s*'rh\.planeacion_personal'/);
  assert.match(source, /PERMISOS\.ADMINISTRAR_HORARIOS/);
  assert.match(source, /PERMISOS\.PLANEACION_PERSONAL/);
});

test('RH muestra horarios y planeacion como modulos separados', () => {
  const source = read('src/pages/rh/RHDashboard.jsx');
  assert.match(source, /label:\s*'Horarios'/);
  assert.match(source, /label:\s*'Planeación de personal'/);
  assert.match(source, /PERMISOS\.ADMINISTRAR_HORARIOS/);
  assert.match(source, /PERMISOS\.PLANEACION_PERSONAL/);
});

test('backend expone operaciones de fase 1 de planeacion', () => {
  const source = read('functions/index.js');
  for (const name of [
    'planeacionListarHorarios',
    'planeacionGuardarHorario',
    'planeacionListarSemana',
    'planeacionGuardarNecesidad',
    'planeacionEliminarNecesidad',
    'planeacionAsignarEventual',
    'planeacionQuitarAsignacion',
    'planeacionCopiarDia',
    'planeacionCopiarSemana',
  ]) {
    assert.match(source, new RegExp(`export const ${name}`));
  }
});

test('planeacion separa necesidades de asignaciones', () => {
  const source = read('functions/index.js');
  assert.match(source, /necesidadesPersonal/);
  assert.match(source, /programacionPersonal/);
  assert.match(source, /cantidadNecesaria/);
  assert.match(source, /costoEstimado/);
  assert.match(source, /puestoId/);
  assert.match(source, /horarioId/);
});

test('reglas e indices incluyen planeacion', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /match \/horarios\/\{horarioId\}/);
  assert.match(rules, /match \/necesidadesPersonal\/\{necesidadId\}/);
  assert.match(rules, /match \/programacionPersonal\/\{asignacionId\}/);

  const indexes = JSON.parse(read('firestore.indexes.json'));
  const groups = new Set(indexes.indexes.map((item) => item.collectionGroup));
  assert.ok(groups.has('necesidadesPersonal'));
  assert.ok(groups.has('programacionPersonal'));
});

test('fase 2A compara programacion contra asistencia real', () => {
  const backend = read('functions/index.js');
  const service = read('src/services/planeacionService.js');
  const panel = read('src/pages/admin/PlaneacionPersonalPanel.jsx');

  assert.match(backend, /export const planeacionListarSeguimientoSemana/);
  assert.match(backend, /collection\('programacionPersonal'\)/);
  assert.match(backend, /collection\('asistenciaJornadas'\)/);
  assert.match(backend, /llego_tarde/);
  assert.match(backend, /no_llego/);
  assert.match(backend, /no_ha_llegado/);
  assert.match(backend, /turno_pendiente/);
  assert.match(service, /listarSeguimientoPlaneacionSemana/);
  assert.match(panel, /Seguimiento asistencia/);
  assert.match(panel, /Llegaron sin programación/);
});

test('fase 2A es solo consulta y no modifica jornadas reales', () => {
  const backend = read('functions/index.js');
  const start = backend.indexOf('export const planeacionListarSeguimientoSemana');
  const end = backend.indexOf('export const planeacionAsignarReemplazo', start);
  const source = backend.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source, /await\s+[^;\n]*\.update\(/);
  assert.doesNotMatch(source, /await\s+[^;\n]*\.set\(/);
  assert.doesNotMatch(source, /await\s+[^;\n]*\.delete\(/);
});


test('fase 2B registra y quita reemplazos sin modificar checadas reales', () => {
  const backend = read('functions/index.js');
  const service = read('src/services/planeacionService.js');
  const panel = read('src/pages/admin/PlaneacionPersonalPanel.jsx');

  assert.match(backend, /export const planeacionAsignarReemplazo/);
  assert.match(backend, /export const planeacionQuitarReemplazo/);
  assert.match(backend, /reemplazoJornadaId/);
  assert.match(backend, /asignar_reemplazo_planeacion/);
  assert.match(backend, /quitar_reemplazo_planeacion/);
  assert.match(service, /asignarReemplazoPlaneacion/);
  assert.match(service, /quitarReemplazoPlaneacion/);
  assert.match(panel, /Asignar reemplazo/);
  assert.match(panel, /Quitar reemplazo/);
  assert.match(panel, /Cubierto por/);

  const start = backend.indexOf('export const planeacionAsignarReemplazo');
  const end = backend.indexOf('export const planeacionGuardarNecesidad', start);
  const source = backend.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source, /db\.doc\(`asistenciaJornadas\/\$\{[^}]+\}`\)\.(?:set|update|delete)/);
  assert.doesNotMatch(source, /batch\.(?:set|update|delete)\(jornadaRef/);
});

test('fase 2B solo ofrece jornadas sin programacion del mismo dia y puesto', () => {
  const panel = read('src/pages/admin/PlaneacionPersonalPanel.jsx');
  assert.match(panel, /item\.fechaJornada === replacementAssignment\.fecha/);
  assert.match(panel, /item\.puestoId === replacementAssignment\.puestoId/);
  assert.match(panel, /tracking\.sinProgramacion/);
});

test('recorridos pendientes al cerrar sesion vencen a las 6 horas y conservan evidencia', async () => {
  const expiry = await import('../src/pages/guardia/utils/routeExpiry.js');
  const inicio = Date.parse('2026-09-29T12:00:00.000Z');
  const ejecucion = {
    estado: 'en_proceso',
    sesionCerradaEn: '2026-09-29T12:00:00.000Z',
    puntosTotales: 10,
  };

  assert.equal(expiry.recorridoDebeCerrarseAutomaticamente(ejecucion, inicio + (5 * 60 + 59) * 60 * 1000), false);
  assert.equal(expiry.recorridoDebeCerrarseAutomaticamente(ejecucion, inicio + 6 * 60 * 60 * 1000), true);

  const cierre = expiry.construirCierreAutomaticoRecorrido({
    ejecucion,
    puntosCompletados: 4,
    ahoraMs: inicio + 7 * 60 * 60 * 1000,
  });
  assert.equal(cierre.estado, 'cerrado_incompleto');
  assert.equal(cierre.motivoCierreAutomatico, 'guardia_no_termino');
  assert.equal(cierre.puntosCompletados, 4);
  assert.equal(cierre.puntosPendientes, 6);
  assert.equal(cierre.pendienteSync, true);
});

test('guardia prepara recorrido local antes de cerrar sesion y no restaura uno vencido', () => {
  const db = read('src/services/offlineDb.js');
  const guard = read('src/pages/guardia/hooks/useGuardiaDashboard.js');
  const dashboard = read('src/pages/guardia/GuardiaDashboard.jsx');
  const report = read('src/pages/admin/reportes/ReportesPanel.jsx');

  assert.match(db, /marcarRecorridosPorCierreSesion/);
  assert.match(db, /cerrarRecorridosVencidosLocal/);
  assert.match(guard, /processExpiredRoutes/);
  assert.match(guard, /prepareLogout/);
  assert.match(dashboard, /guardia\.prepareLogout/);
  assert.match(report, /Guardia no terminó/);
});
