import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  tieneModuloAsistencia, puedeVerPropiedad, puedeConsultarReportes,
  puedeRegistrarAsistencia, permisosPropiedades, normalizarClave, validarPersonal,
  fechaEnZona, tipoRequiereFoto, validarTransicion,
} from '../shared/asistenciaDomain.js';
import {
  PERMISOS, expandirPerfilAcceso, identificarPerfilAcceso, passwordCuentaMexico, tienePermiso,
} from '../shared/perfilesAcceso.js';
import { parseCsv, csvCell } from '../src/modules/asistencia/utils/csv.js';
const require = createRequire(import.meta.url);
const { mergeRules } = require('../scripts/combinarReglasAsistencia.cjs');
const p = { activo: true, rol: 'asistencia', propiedadesPermitidas: ['mexico'] };

test('dedicated account only Mexico, cannot read reports', () => {
  assert(tieneModuloAsistencia(p)); assert(puedeRegistrarAsistencia(p)); assert(puedeVerPropiedad(p, 'mexico'));
  assert(!puedeVerPropiedad(p, 'hrm')); assert(!puedeConsultarReportes(p));
});
test('wildcard not allowed for dedicated account', () => { assert(!puedeVerPropiedad({ ...p, propiedadesPermitidas: ['*'] }, 'mexico')); });
test('empty permissions do not grant global access', () => {
  assert.deepEqual(permisosPropiedades({ propiedadId: 'todas' }), []);
  assert(!puedeVerPropiedad({ ...p, propiedadesPermitidas: [] }, 'mexico'));
});
test('old guards keep no attendance access unless explicitly enabled', () => {
  assert(!tieneModuloAsistencia({ ...p, rol: 'guardia' }));
  assert(tieneModuloAsistencia({ ...p, rol: 'guardia', modulosPermitidos: ['asistencia'] }));
});
test('supervisor de seguridad no hereda reportes de asistencia', () => {
  const s = { ...p, rol: 'supervisor', modulosPermitidos: ['asistencia'] };
  assert(!puedeConsultarReportes(s)); assert(!puedeRegistrarAsistencia(s)); assert(!puedeVerPropiedad(s, 'hrm'));
});
test('inactive admin cannot use attendance', () => { assert(!tieneModuloAsistencia({ rol: 'administrador', activo: false })); });
test('RH queda limitado a asistencia y personal, sin seguridad', () => {
  const rh = { activo: true, rol: 'rh', perfilAcceso: 'rh', propiedadesPermitidas: ['hrm'] };
  assert(tienePermiso(rh, PERMISOS.REPORTES_EVENTUALES));
  assert(tienePermiso(rh, PERMISOS.ADMINISTRAR_PUESTOS));
  assert(tienePermiso(rh, PERMISOS.RESOLVER_TURNOS_EVENTUALES));
  assert(tienePermiso(rh, PERMISOS.REPORTES_MEXICO));
  assert(!tienePermiso(rh, PERMISOS.REPORTES_RECORRIDOS));
  assert(!tienePermiso(rh, PERMISOS.REPORTES_INCIDENCIAS));
});
test('Nominas solo tiene reporte de Asistencia Mexico', () => {
  const nominas = { activo: true, rol: 'nominas', perfilAcceso: 'nominas', propiedadesPermitidas: ['mexico'] };
  assert(tienePermiso(nominas, PERMISOS.REPORTES_MEXICO));
  assert(!tienePermiso(nominas, PERMISOS.REPORTES_EVENTUALES));
  assert(!tienePermiso(nominas, PERMISOS.RESOLVER_TURNOS_EVENTUALES));
  assert(!tienePermiso(nominas, PERMISOS.REPORTES_RECORRIDOS));
});
test('keys retain leading zeroes and accents normalize', () => { assert.equal(normalizarClave(' 00036 '), '00036'); assert.equal(normalizarClave('Gmu\u00f1oz'), 'GMUNOZ'); });
test('catalog fields validated', () => {
  assert.throws(() => validarPersonal({ clave: 'x', nombre: 'a', tipo: 'administrador' }));
  assert.throws(() => validarPersonal({ clave: 'bad/code', nombre: 'a', tipo: 'eventual' }));
  assert.equal(validarPersonal({ clave: '00036', nombre: 'Nombre', tipo: 'eventual', puestoId: 'mesero' }).clave, '00036');
});
test('Mexico dates use property timezone, not UTC date', () => { assert.equal(fechaEnZona(new Date('2026-09-08T02:00:00Z')), '2026-09-07'); });
test('photo requirement comes from property, not account', () => {
  assert(tipoRequiereFoto({ asistencia: { fotoEntrada: true, fotoSalida: true } }, 'entrada'));
  assert(!tipoRequiereFoto({ asistencia: { habilitado: true } }, 'entrada'));
});
test('open shift blocks duplicate entry', () => { assert.throws(() => validarTransicion({ tipo: 'entrada', empleado: { activo: true }, estado: { jornadaAbiertaId: 'a' } }), /Ya existe/); });
test('exit requires an open shift', () => { assert.throws(() => validarTransicion({ tipo: 'salida', estado: {} }), /No hay/); });
test('changed shift rejects stale confirmation', () => {
  assert.throws(() => validarTransicion({ tipo: 'salida', estado: { jornadaAbiertaId: 'nueva' }, jornada: {}, jornadaEsperadaId: 'vieja' }), /cambio/);
});
test('overnight exit is valid', () => {
  validarTransicion({ tipo: 'salida', empleado: {}, estado: { jornadaAbiertaId: 'a' }, jornadaEsperadaId: 'a',
    jornada: { entradaEn: '2026-09-07T22:00:00Z' }, ahoraMs: Date.parse('2026-09-08T06:00:00Z') });
});
test('long pending shift can still register a real exit now', () => {
  validarTransicion({ tipo: 'salida', estado: { jornadaAbiertaId: 'a' }, jornadaEsperadaId: 'a',
    jornada: { entradaEn: '2026-09-07T01:00:00Z', estado: 'salida_pendiente' }, ahoraMs: Date.parse('2026-09-09T01:00:00Z') });
});
test('CSV supports quotes, comma in name and BOM', () => {
  const [row] = parseCsv('\uFEFFclave,nombre,tipo,area,puesto\r\n00036,"Martinez, Carlos",personal_mexico,Ventas,"Ejecutivo"\r\n');
  assert.equal(row.clave, '00036'); assert.equal(row.nombre, 'Martinez, Carlos');
});
test('CSV malformed inputs rejected', () => { assert.throws(() => parseCsv('clave,nombre,tipo\n1,"bad,eventual')); });
test('spreadsheet formula injection escaped', () => { assert.equal(csvCell('=HYPERLINK("bad")').startsWith('"\''), true); });
test('frontend and server share identical domain contract', () => {
  assert.equal(fs.readFileSync(new URL('../shared/asistenciaDomain.js', import.meta.url), 'utf8'), fs.readFileSync(new URL('../functions/asistenciaDomain.js', import.meta.url), 'utf8'));
});
test('rules merge gates old permissions and preserves originals', () => {
  const original = "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /old/{id} { allow read: if request.auth != null; } match /{rest=**} { allow read, write: if false; } } }";
  const result = mergeRules(original, 'match /new/{id} { allow read: if false; }', 'firestore');
  assert(result.includes('asiLegacyCuenta() && (request.auth != null)'));
  assert(result.includes('match /new/'));
  assert(!original.includes('asiLegacyCuenta'));
});
test('rules merge refuses broad catchall grants', () => {
  assert.throws(() => mergeRules('service firebase.storage { match /b/{bucket}/o { match /{all=**} { allow read: if request.auth != null; } } }', '', 'storage'), /recursivo/);
});
test('rules merge refuses double application', () => {
  assert.throws(() => mergeRules('function asiPerfil() {}', '', 'firestore'), /dos veces/);
});

test('Storage fragment stays within two unique Firestore document reads', () => {
  const rules = fs.readFileSync(new URL('../rules/storage.asistencia.fragment.rules', import.meta.url), 'utf8');
  assert.equal((rules.match(/firestore\.get\(/g) || []).length, 2);
  assert(!rules.includes('/documents/asistenciaPersonal/'));
  assert(rules.includes('allow update, delete: if false;'));
});

test('web administrative roles do not register normal attendance', () => {
  assert(!puedeRegistrarAsistencia({ rol: 'administrador', activo: true }));
  assert(!puedeRegistrarAsistencia({ rol: 'supervisor', activo: true, modulosPermitidos: ['asistencia'] }));
});
test('access presets preserve prior attendance grants without enabling every guard', () => {
  assert.equal(identificarPerfilAcceso({ rol: 'guardia', modulosPermitidos: [] }), 'guardia');
  assert.deepEqual(expandirPerfilAcceso('guardia').modulosPermitidos, []);
  assert.equal(identificarPerfilAcceso({ rol: 'guardia', modulosPermitidos: ['asistencia'] }), 'guardia_asistencia');
  assert.deepEqual(expandirPerfilAcceso('guardia_asistencia').modulosPermitidos, ['asistencia']);
  assert.throws(() => expandirPerfilAcceso('root', { estricto: true }));
});
test('Mexico temporary PIN stays compatible with existing login, normal password is not modified', () => {
  assert.deepEqual(passwordCuentaMexico('1234'), { password: 'GMR1234', claveCorta: true });
  assert.deepEqual(passwordCuentaMexico('PruebaLocal789'), { password: 'PruebaLocal789', claveCorta: false });
  assert.throws(() => passwordCuentaMexico('999')); assert.throws(() => passwordCuentaMexico('123456'));
  assert.throws(() => passwordCuentaMexico(' abcdef12345'));
});
test('frontend/server access preset contracts match', () => {
  assert.equal(fs.readFileSync(new URL('../shared/perfilesAcceso.js', import.meta.url), 'utf8'), fs.readFileSync(new URL('../functions/perfilesAcceso.js', import.meta.url), 'utf8'));
});
test('attendance UI restricts registration to native and uses lazy components', () => {
  const code = fs.readFileSync(new URL('../src/modules/asistencia/AsistenciaModulo.jsx', import.meta.url), 'utf8');
  assert(/const\s+registro\s*=\s*native\s*&&\s*puedeRegistrarAsistencia\(profile\)/m.test(code));
  assert(/lazy\(\s*\(\)\s*=>\s*import\(\s*['\"]\.\/components\/RegistroAsistencia['\"]\s*\)\s*\)/s.test(code));
  assert(!code.includes('asistencia?.habilitado'));
});
test('user editor uses presets without extra module checkbox', () => {
  const code = fs.readFileSync(new URL('../src/pages/admin/UsuariosPanel.jsx', import.meta.url), 'utf8');
  assert(code.includes('PERFILES_ACCESO.map'));
  assert(code.includes('changeProfile'));
  assert(!code.includes('asistenciaHabilitada'));
});
test('admin loads report evidence only for the selected route', () => {
  const admin = fs.readFileSync(new URL('../src/pages/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
  const report = fs.readFileSync(new URL('../src/pages/admin/reportes/ReportesPanel.jsx', import.meta.url), 'utf8');
  assert(!admin.includes('evidenciasPuntos'));
  assert(report.includes('consultarEvidenciasRecorrido(selectedExecution.id)'));
});

test('background attendance refresh does not unmount successful account confirmation', () => {
  const code = fs.readFileSync(new URL('../src/modules/asistencia/AsistenciaModulo.jsx', import.meta.url), 'utf8');
  assert(code.includes('setRefreshing(true)'));
  assert(!code.includes('setLoading(true)'));
});

test('recent exit control uses global decision modal and explicit reopen endpoint', () => {
  const ui = fs.readFileSync(new URL('../src/modules/asistencia/components/RegistroAsistencia.jsx', import.meta.url), 'utf8');
  const backend = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert(ui.includes('feedback.decision'));
  assert(ui.includes("asistenciaReabrirJornadaReciente"));
  assert(!ui.includes('window.confirm('));
  assert(backend.includes('MINUTOS_REAPERTURA_TURNO_DEFAULT'));
  assert(backend.includes('confirmar_turno_reciente'));
  assert(backend.includes('reabrir_jornada_salida_reciente'));
});

test('route reports default to today and query only the selected date range', () => {
  const admin = fs.readFileSync(new URL('../src/pages/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
  const supervisor = fs.readFileSync(new URL('../src/pages/SupervisorDashboard.jsx', import.meta.url), 'utf8');
  const report = fs.readFileSync(new URL('../src/pages/admin/reportes/ReportesPanel.jsx', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../src/services/reportesRecorridosService.js', import.meta.url), 'utf8');

  assert(report.includes('const [fechaInicio, setFechaInicio] = useState(hoy)'));
  assert(report.includes('const [fechaFin, setFechaFin] = useState(hoy)'));
  assert(report.includes('consultarRecorridosPorRango'));
  assert(service.includes("where('finalizadaEn', '>=', inicioIso)"));
  assert(service.includes("where('finalizadaEn', '<=', finIso)"));
  assert(!admin.includes("'ejecucionesRecorridos'"));
  assert(!supervisor.includes("'evidenciasPuntos'"));
});

test('route report toolbar keeps actions and result count inside the filter card', () => {
  const report = fs.readFileSync(new URL('../src/pages/admin/reportes/ReportesPanel.jsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

  assert(report.includes('className="report-filter-fields"'));
  assert(report.includes('className="report-filter-actions"'));
  assert(report.includes('PDF general'));
  assert(!report.includes('className="report-query-status"'));
  assert(css.includes('.report-filter-actions .report-filter-summary'));
});

test('admin groups users roles and permissions into one access management module', () => {
  const admin = fs.readFileSync(new URL('../src/pages/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
  const access = fs.readFileSync(new URL('../src/pages/admin/AccesosPanel.jsx', import.meta.url), 'utf8');

  assert(admin.includes("label: 'Administración general'"));
  assert(admin.includes("label: 'Seguridad'"));
  assert(admin.includes("label: 'Recursos Humanos'"));
  assert(admin.includes("label: 'Asistencia y pagos'"));
  assert(admin.includes("id: 'accesos', label: 'Usuarios y accesos'"));
  assert(access.includes("id: 'usuarios'"));
  assert(access.includes("id: 'roles'"));
  assert(access.includes("id: 'permisos'"));
});


test('guard session survives temporary connectivity loss with local persistence and cached profile', () => {
  const auth = fs.readFileSync(new URL('../src/context/AuthContext.jsx', import.meta.url), 'utf8');
  assert(auth.includes('browserLocalPersistence'));
  assert(auth.includes('setPersistence(auth, browserLocalPersistence)'));
  assert(auth.includes('guardarPerfilLocal'));
  assert(auth.includes('leerPerfilLocal'));
  assert(auth.includes('una falla temporal de internet NO debe cerrar la sesión'));
  assert(auth.includes('if (!transient)'));
});

test('active route is restored from Dexie after app restart', () => {
  const dbCode = fs.readFileSync(new URL('../src/services/offlineDb.js', import.meta.url), 'utf8');
  const guard = fs.readFileSync(new URL('../src/pages/guardia/hooks/useGuardiaDashboard.js', import.meta.url), 'utf8');
  assert(dbCode.includes('listarEjecucionesActivasLocal'));
  assert(dbCode.includes('ejecucion.estado === "en_proceso"'));
  assert(guard.includes('restoreActiveExecution'));
  assert(guard.includes('Recorrido recuperado del dispositivo'));
  assert(guard.includes('await refreshEvidence(execution.id)'));
  assert(guard.includes('Ya existe un recorrido activo guardado en este dispositivo'));
});
