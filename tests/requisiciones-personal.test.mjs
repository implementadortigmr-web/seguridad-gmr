import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './helpers/firebaseFixture.mjs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const base = {
  propiedadId: 'hrm',
  departamentoSolicitante: 'Cocina',
  puestoId: 'mesero',
  horarioId: 'dia',
  cantidadPersonas: 2,
  fechaDesde: '2026-10-30',
  fechaHasta: '2026-10-31',
  motivo: 'Fin de semana',
  descripcionCausa: 'Apoyo a la operación por incremento de servicio.',
  formaPago: 'Efectivo',
  personasPropuestas: '',
};

test('perfil solicitante queda restringido al modulo de requisiciones', () => {
  const permisos = read('shared/perfilesAcceso.js');
  const app = read('src/App.jsx');
  const roles = read('src/utils/roles.js');
  assert.match(permisos, /SOLICITAR_PERSONAL:\s*'rh\.solicitar_personal'/);
  assert.match(permisos, /AUTORIZAR_REQUISICIONES_PERSONAL:\s*'rh\.autorizar_requisiciones_personal'/);
  assert.match(permisos, /value:\s*'solicitante_personal'/);
  assert.match(permisos, /rol:\s*'solicitante'/);
  assert.match(app, /allowedRoles=\{\['solicitante'\]\}/);
  assert.match(roles, /solicitante.*solicitudes-personal/);
});

test('frontend y backend comparten catalogo de permisos actualizado', () => {
  assert.equal(read('shared/perfilesAcceso.js'), read('functions/perfilesAcceso.js'));
});

test('solicitante carga catalogos solo de sus propiedades y crea folio consecutivo', async () => {
  const h = fixture();
  const catalogos = await h.call('requisicionesCatalogos', {}, 'solicitante');
  assert.deepEqual(catalogos.propiedades.map((p) => p.id), ['hrm']);
  assert.equal(catalogos.puedeAutorizar, false);
  const one = await h.call('requisicionesCrear', base, 'solicitante');
  const two = await h.call('requisicionesCrear', { ...base, departamentoSolicitante: 'Restaurante' }, 'solicitante');
  assert.match(one.folio, /^REQ-HRM-2026-0001$/);
  assert.match(two.folio, /^REQ-HRM-2026-0002$/);
  assert.equal(h.docs.get(`requisicionesPersonal/${one.requisicionId}`).estado, 'pendiente_autorizacion');
});

test('solicitante ve solo sus requisiciones y no puede autorizar', async () => {
  const h = fixture();
  const own = await h.call('requisicionesCrear', base, 'solicitante');
  await h.call('requisicionesCrear', { ...base, departamentoSolicitante: 'Banquetes' }, 'admin');
  const list = await h.call('requisicionesListar', {}, 'solicitante');
  assert.equal(list.solicitudes.length, 1);
  assert.equal(list.solicitudes[0].id, own.requisicionId);
  await assert.rejects(h.call('requisicionesAutorizar', { requisicionId: own.requisicionId }, 'solicitante'), /autorizar/i);
});


test('RH existente con permiso de planeacion conserva autorizacion por compatibilidad', async () => {
  const h = fixture();
  h.docs.get('usuarios/rh').permisosSistema = [h.permisos.PERMISOS.PLANEACION_PERSONAL];
  const created = await h.call('requisicionesCrear', base, 'solicitante');
  const result = await h.call('requisicionesAutorizar', { requisicionId: created.requisicionId }, 'rh');
  assert.equal(result.necesidadesIds.length, 2);
  assert.equal(h.docs.get(`requisicionesPersonal/${created.requisicionId}`).estado, 'autorizada');
});

test('autorizar requisicion crea necesidades de todos los dias del periodo', async () => {
  const h = fixture();
  const created = await h.call('requisicionesCrear', base, 'solicitante');
  const result = await h.call('requisicionesAutorizar', { requisicionId: created.requisicionId }, 'rh');
  assert.equal(result.necesidadesIds.length, 2);
  assert.equal(result.creadas, 2);
  for (const id of result.necesidadesIds) {
    const need = h.docs.get(`necesidadesPersonal/${id}`);
    assert.equal(need.cantidadNecesaria, 2);
    assert.equal(need.puestoId, 'mesero');
    assert.equal(need.horarioId, 'dia');
    assert.equal(need.requisicionesOrigen[0].requisicionId, created.requisicionId);
  }
  const req = h.docs.get(`requisicionesPersonal/${created.requisicionId}`);
  assert.equal(req.estado, 'autorizada');
  assert.equal(req.autorizadoPor, 'rh');
});

test('autorizar suma la requisicion a una necesidad existente sin borrar su planeacion', async () => {
  const h = fixture();
  await h.call('planeacionGuardarNecesidadesVariosDias', {
    propiedadId: 'hrm', horarioId: 'dia', puestoId: 'mesero', cantidadNecesaria: 3,
    fechas: ['2026-10-30'], observaciones: 'Necesidad previa',
  }, 'rh');
  const created = await h.call('requisicionesCrear', { ...base, fechaHasta: '2026-10-30' }, 'solicitante');
  const result = await h.call('requisicionesAutorizar', { requisicionId: created.requisicionId }, 'rh');
  assert.equal(result.actualizadas, 1);
  const need = h.docs.get(`necesidadesPersonal/${result.necesidadesIds[0]}`);
  assert.equal(need.cantidadNecesaria, 5);
  assert.equal(need.observaciones, 'Necesidad previa');
});

test('rechazar requisicion exige motivo y no crea necesidades', async () => {
  const h = fixture();
  const created = await h.call('requisicionesCrear', base, 'solicitante');
  await assert.rejects(h.call('requisicionesRechazar', { requisicionId: created.requisicionId, motivoRechazo: '' }, 'rh'), /Motivo/);
  await h.call('requisicionesRechazar', { requisicionId: created.requisicionId, motivoRechazo: 'No autorizado por operación.' }, 'rh');
  const req = h.docs.get(`requisicionesPersonal/${created.requisicionId}`);
  assert.equal(req.estado, 'rechazada');
  assert.equal([...h.docs.keys()].filter((k) => k.startsWith('necesidadesPersonal/')).length, 0);
});

test('encabezado del detalle PDF usa una sola banda oscura para que todos los titulos sean visibles', () => {
  const pdf = read('src/services/pdfRequisicionPersonalService.js');
  assert.match(pdf, /const totalWidth = widths\.reduce/);
  assert.match(pdf, /doc\.rect\(M, y, totalWidth, 24, 'F'\)/);
  assert.match(pdf, /'PUESTO'/);
  assert.match(pdf, /'HORARIO'/);
  assert.match(pdf, /'PERSONAS'/);
  assert.match(pdf, /'TURNOS-PERSONA'/);
  assert.doesNotMatch(pdf, /widths\.forEach\(\(width, index\) => \{\s*doc\.rect\(x, y, width, 24, 'F'\)/);
});

test('UI incluye nueva requisicion, autorizacion, rechazo, PDF y paso a planeacion', () => {
  const panel = read('src/pages/admin/RequisicionesPersonalPanel.jsx');
  const pdf = read('src/services/pdfRequisicionPersonalService.js');
  const admin = read('src/pages/admin/AdminDashboard.jsx');
  const rh = read('src/pages/rh/RHDashboard.jsx');
  assert.match(panel, /Nueva requisición/);
  assert.match(panel, /Autorizar y pasar a Planeación/);
  assert.match(panel, /Rechazar/);
  assert.match(panel, /crearRequisicionPersonalPDF/);
  assert.match(pdf, /REQUISICIÓN DE PERSONAL/);
  assert.match(pdf, /Departamento solicitante/);
  assert.match(pdf, /Nombres de las personas requeridas/);
  assert.match(admin, /Requisiciones de personal/);
  assert.match(rh, /Requisiciones de personal/);
});

test('requisiciones no tienen escritura directa desde cliente', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /match \/requisicionesPersonal\/\{requisicionId\}[\s\S]*allow read, write: if false/);
});

test('una requisicion puede guardar varias necesidades con distintos horarios y dias', async () => {
  const h = fixture();
  h.docs.set('horarios/tarde', { nombre: 'Tarde', horaInicio: '15:00', horaFin: '23:00', minutosDuracion: 480, cruzaDia: false, activo: true });
  const result = await h.call('requisicionesCrear', {
    propiedadId: 'hrm',
    departamentoSolicitante: 'Restaurante',
    motivo: 'Fin de semana',
    descripcionCausa: 'Cobertura de los turnos solicitados para servicio.',
    formaPago: 'Efectivo',
    personasPropuestas: '',
    partidas: [
      { partidaId: 'manana', puestoId: 'mesero', horarioId: 'dia', cantidadPersonas: 3, fechaDesde: '2026-11-02', fechaHasta: '2026-11-02' },
      { partidaId: 'tarde', puestoId: 'mesero', horarioId: 'tarde', cantidadPersonas: 2, fechaDesde: '2026-11-02', fechaHasta: '2026-11-02' },
      { partidaId: 'seguridad', puestoId: 'seguridad', horarioId: 'dia', cantidadPersonas: 1, fechaDesde: '2026-11-03', fechaHasta: '2026-11-05' },
    ],
  }, 'solicitante');
  const req = h.docs.get(`requisicionesPersonal/${result.requisicionId}`);
  assert.equal(req.partidas.length, 3);
  assert.equal(req.cantidadPartidas, 3);
  assert.equal(req.turnosPersonaSolicitados, 8);
  assert.equal(req.fechaDesde, '2026-11-02');
  assert.equal(req.fechaHasta, '2026-11-05');
  assert.equal(req.partidas[1].horaInicio, '15:00');
  assert.equal(req.partidas[1].horaFin, '23:00');
});

test('autorizar requisicion multiple crea todas las necesidades con sus cantidades', async () => {
  const h = fixture();
  h.docs.set('horarios/tarde', { nombre: 'Tarde', horaInicio: '15:00', horaFin: '23:00', minutosDuracion: 480, cruzaDia: false, activo: true });
  const created = await h.call('requisicionesCrear', {
    propiedadId: 'hrm', departamentoSolicitante: 'Restaurante', motivo: 'Evento',
    descripcionCausa: 'Necesidades de mañana y tarde en el mismo folio.', formaPago: 'Efectivo',
    partidas: [
      { puestoId: 'mesero', horarioId: 'dia', cantidadPersonas: 3, fechaDesde: '2026-11-02', fechaHasta: '2026-11-02' },
      { puestoId: 'mesero', horarioId: 'tarde', cantidadPersonas: 2, fechaDesde: '2026-11-02', fechaHasta: '2026-11-02' },
      { puestoId: 'seguridad', horarioId: 'dia', cantidadPersonas: 1, fechaDesde: '2026-11-03', fechaHasta: '2026-11-04' },
    ],
  }, 'solicitante');
  const result = await h.call('requisicionesAutorizar', { requisicionId: created.requisicionId }, 'rh');
  assert.equal(result.necesidadesIds.length, 4);
  assert.equal(result.creadas, 4);
  const needs = result.necesidadesIds.map((id) => h.docs.get(`necesidadesPersonal/${id}`));
  assert.ok(needs.some((n) => n.fecha === '2026-11-02' && n.horarioId === 'dia' && n.puestoId === 'mesero' && n.cantidadNecesaria === 3));
  assert.ok(needs.some((n) => n.fecha === '2026-11-02' && n.horarioId === 'tarde' && n.puestoId === 'mesero' && n.cantidadNecesaria === 2));
  assert.equal(needs.filter((n) => n.puestoId === 'seguridad').length, 2);
});

test('partidas coincidentes en una misma requisicion se consolidan al autorizar', async () => {
  const h = fixture();
  const created = await h.call('requisicionesCrear', {
    propiedadId: 'hrm', departamentoSolicitante: 'Banquetes', motivo: 'Evento',
    descripcionCausa: 'Dos bloques del mismo turno capturados en la misma requisicion.', formaPago: 'Efectivo',
    partidas: [
      { puestoId: 'mesero', horarioId: 'dia', cantidadPersonas: 2, fechaDesde: '2026-11-02', fechaHasta: '2026-11-02' },
      { puestoId: 'mesero', horarioId: 'dia', cantidadPersonas: 3, fechaDesde: '2026-11-02', fechaHasta: '2026-11-02' },
    ],
  }, 'solicitante');
  const result = await h.call('requisicionesAutorizar', { requisicionId: created.requisicionId }, 'rh');
  assert.equal(result.necesidadesIds.length, 1);
  assert.equal(h.docs.get(`necesidadesPersonal/${result.necesidadesIds[0]}`).cantidadNecesaria, 5);
});

test('UI de requisicion multiple permite agregar editar eliminar y enviar una sola requisicion', () => {
  const panel = read('src/pages/admin/RequisicionesPersonalPanel.jsx');
  const pdf = read('src/services/pdfRequisicionPersonalService.js');
  assert.match(panel, /Agregar necesidad/);
  assert.match(panel, /Guardar necesidad/);
  assert.match(panel, /Necesidades agregadas/);
  assert.match(panel, /Guardar cambios/);
  assert.match(panel, /Eliminar/);
  assert.match(panel, /Enviar requisición completa/);
  assert.match(panel, /turnos-persona/);
  assert.match(pdf, /Detalle solicitado/);
  assert.match(pdf, /TURNOS-PERSONA/);
});

test('requisicion con calendario usa solo los dias seleccionados y no rellena intermedios', async () => {
  const h = fixture();
  const created = await h.call('requisicionesCrear', {
    propiedadId: 'hrm', departamentoSolicitante: 'Restaurante', motivo: 'Evento',
    descripcionCausa: 'Cobertura en dias especificos elegidos desde el calendario.', formaPago: 'Efectivo',
    partidas: [
      { puestoId: 'mesero', horarioId: 'dia', cantidadPersonas: 3, fechas: ['2026-11-02', '2026-11-04', '2026-11-06'] },
    ],
  }, 'solicitante');
  const req = h.docs.get(`requisicionesPersonal/${created.requisicionId}`);
  assert.deepEqual(req.partidas[0].fechas, ['2026-11-02', '2026-11-04', '2026-11-06']);
  assert.equal(req.partidas[0].diasSolicitados, 3);
  assert.equal(req.turnosPersonaSolicitados, 9);
  const result = await h.call('requisicionesAutorizar', { requisicionId: created.requisicionId }, 'rh');
  assert.equal(result.necesidadesIds.length, 3);
  const fechas = result.necesidadesIds.map((id) => h.docs.get(`necesidadesPersonal/${id}`).fecha).sort();
  assert.deepEqual(fechas, ['2026-11-02', '2026-11-04', '2026-11-06']);
  assert.equal(h.docs.has('necesidadesPersonal/nec_2026-11-03'), false);
});

test('UI de requisicion usa un calendario multiseleccion en lugar de Del y Al', () => {
  const panel = read('src/pages/admin/RequisicionesPersonalPanel.jsx');
  const css = read('src/pages/admin/requisicionesPersonal.css');
  const pdf = read('src/services/pdfRequisicionPersonalService.js');
  assert.match(panel, /Días seleccionados/);
  assert.match(panel, /calendarCells\(calendarMonth\)/);
  assert.match(panel, /toggleDate\(date\)/);
  assert.doesNotMatch(panel, /className="field-label">Del/);
  assert.doesNotMatch(panel, /className="field-label">Al/);
  assert.match(css, /requisition-calendar-grid/);
  assert.match(pdf, /DÍAS SOLICITADOS/);
});
