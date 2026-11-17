import test from 'node:test';
import assert from 'node:assert/strict';
import {
  horasPagablesDesdeMinutos,
  rangoSemanaISO,
  resumirSemanaEventuales,
  turnoProgramadoTexto,
} from '../src/modules/asistencia/utils/eventualesNomina.js';

test('redondeo de pago usa umbral de 50 minutos', () => {
  assert.equal(horasPagablesDesdeMinutos(6 * 60 + 49), 6);
  assert.equal(horasPagablesDesdeMinutos(6 * 60 + 50), 7);
  assert.equal(horasPagablesDesdeMinutos(2 * 60 + 50), 3);
  assert.equal(horasPagablesDesdeMinutos(8 * 60 + 49), 8);
  assert.equal(horasPagablesDesdeMinutos(8 * 60 + 50), 9);
});

test('semana ISO 37 de 2026 va de lunes 7 a domingo 13', () => {
  const rango = rangoSemanaISO('2026-W37');
  assert.equal(rango.desde, '2026-09-07');
  assert.equal(rango.hasta, '2026-09-13');
});

test('resumen semanal separa normales y extras a la misma tarifa', () => {
  const rango = rangoSemanaISO('2026-W37');
  const rows = [
    {
      id: '1', empleadoId: 'e1', empleadoNombre: 'Persona', claveEmpleado: 'EV1',
      puestoNombre: 'MESERO', area: 'A&B', fechaJornada: '2026-09-09',
      estado: 'completa', entradaEn: '2026-09-09T09:10:00Z', salidaEn: '2026-09-09T18:00:00Z', minutos: 8 * 60 + 50,
      tarifaHoraAplicada: 100,
    },
  ];
  const summary = resumirSemanaEventuales(rows, rango);
  assert.equal(summary.personas[0].horasNormales, 8);
  assert.equal(summary.personas[0].horasExtra, 1);
  assert.equal(summary.personas[0].total, 900);
});


test('sabado albanil con 5 horas o mas conserva jornada completa de 8 horas', () => {
  const rango = rangoSemanaISO('2026-W37');
  const rows = [{
    id: '2', empleadoId: 'e2', empleadoNombre: 'Albanil', claveEmpleado: 'EV2',
    puestoNombre: 'ALBAÑIL', area: 'Mantenimiento', fechaJornada: '2026-09-12',
    estado: 'completa', entradaEn: '2026-09-12T10:00:00Z', salidaEn: '2026-09-12T15:00:00Z', minutos: 5 * 60,
    tarifaHoraAplicada: 100,
  }];
  const summary = resumirSemanaEventuales(rows, rango);
  assert.equal(summary.personas[0].horasNormales, 8);
  assert.equal(summary.personas[0].total, 800);
});


test('turno programado de 10 horas define 10 horas normales antes de extra', () => {
  const rango = rangoSemanaISO('2026-W37');
  const base = {
    id: 't10', empleadoId: 'e10', empleadoNombre: 'Carlos Martinez', claveEmpleado: 'EV10',
    puestoNombre: 'MESERO', fechaJornada: '2026-09-09', estado: 'completa',
    entradaEn: '2026-09-09T09:00:00Z', tarifaHoraAplicada: 100,
    horaInicioPlanificada: '09:00', horaFinPlanificada: '19:00', minutosTurnoPlanificado: 600,
  };
  const exacto = resumirSemanaEventuales([{ ...base, salidaEn: '2026-09-09T19:00:00Z', minutos: 600 }], rango).personas[0];
  assert.equal(exacto.horasNormales, 10);
  assert.equal(exacto.horasExtra, 0);
  assert.equal(exacto.total, 1000);
  const excedido = resumirSemanaEventuales([{ ...base, salidaEn: '2026-09-09T19:50:00Z', minutos: 650 }], rango).personas[0];
  assert.equal(excedido.horasNormales, 10);
  assert.equal(excedido.horasExtra, 1);
  assert.equal(excedido.total, 1100);
});

test('turno programado de 12 horas no genera cuatro horas extra por usar base fija de ocho', () => {
  const rango = rangoSemanaISO('2026-W37');
  const row = {
    id: 't12', empleadoId: 'e12', empleadoNombre: 'Maria Lopez', claveEmpleado: 'EV12',
    puestoNombre: 'SEGURIDAD', fechaJornada: '2026-09-10', estado: 'completa',
    entradaEn: '2026-09-10T07:00:00Z', salidaEn: '2026-09-10T19:00:00Z', minutos: 720, tarifaHoraAplicada: 90,
    horaInicioPlanificada: '07:00', horaFinPlanificada: '19:00', minutosTurnoPlanificado: 720,
  };
  const person = resumirSemanaEventuales([row], rango).personas[0];
  assert.equal(person.horasNormales, 12);
  assert.equal(person.horasExtra, 0);
  assert.equal(person.total, 1080);
  assert.equal(person.nombre, 'MARIA LOPEZ');
  assert.equal(turnoProgramadoTexto(row), '07:00 - 19:00');
});

test('sin turno programado conserva regla historica de 8 horas normales', () => {
  const rango = rangoSemanaISO('2026-W37');
  const person = resumirSemanaEventuales([{
    id: 'legacy', empleadoId: 'legacy', empleadoNombre: 'Persona Legacy', puestoNombre: 'MESERO',
    fechaJornada: '2026-09-11', estado: 'completa', entradaEn: '2026-09-11T09:00:00Z', salidaEn: '2026-09-11T17:50:00Z',
    minutos: 530, tarifaHoraAplicada: 100,
  }], rango).personas[0];
  assert.equal(person.horasNormales, 8);
  assert.equal(person.horasExtra, 1);
  assert.equal(turnoProgramadoTexto({}), 'SIN TURNO');
});
