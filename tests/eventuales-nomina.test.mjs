import test from 'node:test';
import assert from 'node:assert/strict';
import {
  horasPagablesDesdeMinutos,
  rangoSemanaISO,
  resumirSemanaEventuales,
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
      estado: 'completa', salidaEn: '2026-09-09T18:00:00Z', minutos: 8 * 60 + 50,
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
    estado: 'completa', salidaEn: '2026-09-12T15:00:00Z', minutos: 5 * 60,
    tarifaHoraAplicada: 100,
  }];
  const summary = resumirSemanaEventuales(rows, rango);
  assert.equal(summary.personas[0].horasNormales, 8);
  assert.equal(summary.personas[0].total, 800);
});
