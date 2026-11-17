import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dibujarPrenomina, dibujarHojaRegistro } from '../src/services/pdfPlaneacionService.js';
import { resumenPrenomina } from '../shared/operacionEventuales.js';
import { PdfDrawingRecorder, visibleText } from './helpers/pdfDrawingRecorder.mjs';

const person = 'NOMBRE PRIVADO NO IMPRIMIR EN PRENOMINA';
const propiedad = { id: 'hrm', codigo: 'HRM', nombre: 'Hotel Real de Minas' };
const necesidad = { id: 'n', fecha: '2026-10-27', puestoId: 'm', puestoNombre: 'Mesero', horaInicio: '07:00', horaFin: '15:00', minutosDuracion: 480, cantidadNecesaria: 2, tarifaHora: 100 };
const asignacion = { id: 'a', necesidadId: 'n', empleadoId: 'e', empleadoNombre: person, versionTarifa: 2, tarifaHoraPlanificada: 110 };
const params = { propiedad, semanaInicio: '2026-10-26', semanaFin: '2026-11-01', necesidades: [necesidad], asignaciones: [asignacion] };
const render = (options = params) => dibujarPrenomina(new PdfDrawingRecorder(), options);
const cash = (value) => value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function withinPage(doc) {
  for (const page of doc.pages) for (const op of page) {
    if (['rect', 'roundedRect', 'image'].includes(op.op)) {
      assert(op.x >= 0 && op.y >= 0 && op.x + op.w <= 792.01 && op.y + op.h <= 612.01, JSON.stringify(op));
    }
    if (op.op === 'text') {
      assert(op.x >= 0 && op.x <= 792 && op.y >= 0 && op.y <= 600, JSON.stringify(op));
      const lines = Array.isArray(op.value) ? op.value : [op.value];
      assert(op.y + (lines.length - 1) * op.style.size * op.style.factor <= 600, JSON.stringify(op));
    }
  }
}

function headerTexts(doc) {
  const result = [];
  for (const page of doc.pages) {
    const backgrounds = [];
    for (const op of page) {
      if (['rect', 'roundedRect'].includes(op.op) && op.paint.includes('F')) backgrounds.push(op);
      if (op.op !== 'text') continue;
      const bg = [...backgrounds].reverse().find((b) => op.x >= b.x && op.x <= b.x + b.w && op.y >= b.y && op.y <= b.y + b.h);
      if (bg && bg.style.fill.join(',') === '17,30,50') result.push(op);
    }
  }
  return result;
}

test('PDF has only summary and job/shift detail, without nominal annexes', () => {
  const doc = render();
  assert.equal(doc.getNumberOfPages(), 2);
  assert.match(visibleText(doc), /Resumen semanal/);
  assert.match(visibleText(doc), /Detalle por d\u00eda, puesto y horario/);
  assert(!visibleText(doc).includes(person));
  assert.doesNotMatch(visibleText(doc), /Resumen semanal por persona|Personal asignado y tarifa/);
  withinPage(doc);
});

test('PDF removes all marked phrases and assignment counters', () => {
  const text = visibleText(render());
  assert.doesNotMatch(text, /Asignados|Asignaciones:|Pendientes|Faltantes|Vacantes pendientes|Personas distintas|Una persona puede|Incluye vacantes|no asistencia real|SEGURIDAD GMR \|/i);
  assert.match(text, /Pren\u00f3mina semanal/);
  assert.match(text, /PRE-HRM-2026-S44/);
});

test('PDF keeps required turns, hours and exact existing calculation including vacancies', () => {
  const before = JSON.stringify(params);
  const summary = resumenPrenomina(params.necesidades, params.asignaciones);
  const text = visibleText(render());
  assert.equal(summary.total.importe, 1680);
  assert(text.includes(cash(summary.total.importe)));
  assert.equal(JSON.stringify(params), before);
});

test('no changes to employee or money source when labels are removed', () => {
  const many = { ...params, asignaciones: Array.from({ length: 30 }, (_, i) => ({ ...asignacion, necesidadId: 'other', empleadoNombre: `PRIVATE-${i}` })) };
  const doc = render(many);
  assert.equal(doc.pages.length, 2);
  assert.doesNotMatch(visibleText(doc), /PRIVATE-/);
});

test('all prenomina header cells are white on their dark band, including continuation pages', () => {
  const needs = Array.from({ length: 60 }, (_, i) => ({ ...necesidad, id: `n${i}`, puestoNombre: `Puesto ${i}` }));
  const doc = render({ ...params, necesidades: needs });
  const heads = headerTexts(doc);
  assert(heads.length > 20);
  for (const op of heads) assert.deepEqual(op.style.text, [255, 255, 255]);
  for (let i = 1; i < doc.pages.length; i++) {
    const text = doc.pages[i].filter((op) => op.op === 'text').map((op) => op.value).flat().join(' ');
    assert(text.includes('Solicitud de efectivo'));
    assert(text.includes('Puesto'));
  }
  for (let i = 0; i < 60; i++) assert(visibleText(doc).includes(`Puesto ${i}`));
  withinPage(doc);
});

test('detail columns occupy exactly the landscape printable area', () => {
  const doc = render();
  const bands = doc.pages.flat().filter((op) => op.op === 'rect' && op.style.fill.join(',') === '17,30,50' && op.paint === 'F');
  assert(bands.length >= 2);
  for (const band of bands) { assert.equal(band.x, 28); assert.equal(band.w, 736); }
});

test('register retains names, blank real-entry/exit and signature columns', () => {
  const doc = dibujarHojaRegistro(new PdfDrawingRecorder(), { ...params, renglonesExtra: 0 });
  const text = visibleText(doc);
  assert(text.includes('NOMBRE PRIVADO'));
  assert.match(text, /PROGRAMACI\u00d3N/);
  assert.match(text, /ENTRADA/);
  assert.match(text, /SALIDA/);
  assert.match(text, /SEGURIDAD/);
  assert.match(text, /FACTURA/);
  assert.doesNotMatch(text, /POR ASIGNAR/);
  withinPage(doc);
});

test('register header cells are white on a single dark band', () => {
  const doc = dibujarHojaRegistro(new PdfDrawingRecorder(), { ...params, renglonesExtra: 2 });
  const heads = headerTexts(doc);
  assert.equal(heads.length, 12);
  for (const op of heads) assert.deepEqual(op.style.text, [255, 255, 255]);
});

test('register pagination repeats labels and never loses any assigned person', () => {
  const needs = [{ ...necesidad, cantidadNecesaria: 20 }];
  const assignments = Array.from({ length: 20 }, (_, i) => ({ ...asignacion, empleadoId: `e${i}`, empleadoNombre: `PERSONA-${String(i).padStart(2, '0')}` }));
  const doc = dibujarHojaRegistro(new PdfDrawingRecorder(), { ...params, necesidades: needs, asignaciones: assignments });
  assert(doc.pages.length >= 3);
  for (let i = 0; i < 20; i++) assert(visibleText(doc).includes(`PERSONA-${String(i).padStart(2, '0')}`));
  assert.equal(headerTexts(doc).length, doc.pages.length * 12);
  withinPage(doc);
});

test('register only prints active assignments and keeps overnight marker', () => {
  const doc = dibujarHojaRegistro(new PdfDrawingRecorder(), { ...params,
    necesidades: [{ ...necesidad, horaInicio: '17:00', horaFin: '02:00', cruzaDia: true }],
    asignaciones: [{ ...asignacion, activo: false }], renglonesExtra: -4,
  });
  assert.doesNotMatch(visibleText(doc), /NOMBRE PRIVADO/);
  assert(visibleText(doc).includes('(+1 d\u00eda)'));
  withinPage(doc);
});

test('safe handling of absent logo and empty needs', () => {
  assert.match(visibleText(render()), /M\u00c9XICO REAL/);
  assert.throws(() => dibujarHojaRegistro(new PdfDrawingRecorder(), { necesidades: [] }), /No hay necesidades/);
  const doc = render({ ...params, necesidades: [], asignaciones: [] });
  assert.equal(doc.pages.length, 2);
  assert(visibleText(doc).includes(cash(0)));
});

test('long property/event/employee text wraps without dropping characters or page overflow', () => {
  const longName = 'ANA MARIA DEL CARMEN DE LOS ANGELES SANCHEZ RODRIGUEZ HERNANDEZ';
  const longProperty = { ...propiedad, nombre: 'Hotel y Centro de Convenciones de Grupo Mexico Real en San Miguel de Allende' };
  const doc = dibujarHojaRegistro(new PdfDrawingRecorder(), { ...params, propiedad: longProperty,
    evento: 'Servicio de alimentos y bebidas para capacitacion y celebracion de cierre de temporada',
    asignaciones: [{ ...asignacion, empleadoNombre: longName }],
  });
  assert(visibleText(doc).replace(/\s+/g, ' ').includes(longName));
  withinPage(doc);
});

test('logo is reused on every generated page with the corporate header', () => {
  const doc = render({ ...params, logo: 'data:image/png;base64,example' });
  assert.equal(doc.pages.flat().filter((op) => op.op === 'image').length, 2);
  assert(doc.pages.flat().filter((op) => op.op === 'image').every((op) => op.alias === 'gmr-planeacion-logo'));
});

test('modal preview also hides assignment and individual counters', () => {
  const source = fs.readFileSync(new URL('../src/pages/admin/ReportesPlaneacion.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /t\.personasUnicas|t\.turnosAsignados|t\.faltantes/);
  assert.match(source, /t\.importe/);
  assert.match(source, /Sin listado de personas/);
});


test('weekly payments offer the Eventuales PDF again, while receipts and CSV are kept', () => {
  const source = fs.readFileSync(new URL('../src/pages/admin/reportes/ReporteSemanalEventuales.jsx', import.meta.url), 'utf8');
  assert.match(source, /pdfEventuales/);
  assert.match(source, /PDF Eventuales/);
  assert.match(source, /FileText/);
  assert.match(source, /PDF recibos/);
  assert.match(source, /Excel \/ CSV/);
  assert.match(source, /pdfRecibos\(\{ propiedad, rango, summary, folio \}\)/);
  assert.match(source, /descargarCsv\(\{ propiedad, rango, summary, folio \}\)/);
  assert.match(source, /Control de efectivo/);
  assert.match(source, /Detalle de registros/);
  assert.match(source, /RevisionJornadaModal/);
});

test('cash request PDF remains available from planning', () => {
  const source = fs.readFileSync(new URL('../src/pages/admin/ReportesPlaneacion.jsx', import.meta.url), 'utf8');
  assert.match(source, /solicitar efectivo/);
  assert.match(source, /crearPrenominaPDF\(\{propiedad,semanaInicio/);
  assert.match(source, /Generar PDF/);
});


test('registro deja vacias las plazas sin persona para poder escribir el nombre a mano', () => {
  const doc = dibujarHojaRegistro(new PdfDrawingRecorder(), { ...params, necesidades: [{ ...necesidad, cantidadNecesaria: 2 }], asignaciones: [asignacion], renglonesExtra: 0 });
  assert.doesNotMatch(visibleText(doc), /POR ASIGNAR/);
});

test('reporte semanal quita area, muestra turno programado y enumera recibos', () => {
  const source = fs.readFileSync(new URL('../src/pages/admin/reportes/ReporteSemanalEventuales.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<th>Área<\/th>|'ÁREA'/);
  assert.match(source, /Detalle de turnos y asistencia/);
  assert.match(source, /TURNO PROGRAMADO/);
  assert.match(source, /Horas turno/);
  assert.match(source, /Recibo \$\{String\(receiptNumber\)/);
  assert.match(source, /asistenciaProgramacionesReporte/);
});
