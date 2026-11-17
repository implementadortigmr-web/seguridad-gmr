import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const functions = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/pages/admin/PersonalPanel.jsx', import.meta.url), 'utf8');
const tools = readFileSync(new URL('../src/pages/admin/EventualesTools.jsx', import.meta.url), 'utf8');
const publicPage = readFileSync(new URL('../src/pages/public/RegistroEventualPage.jsx', import.meta.url), 'utf8');

test('registro eventual tiene ruta publica separada del login', () => {
  assert.match(app, /path="\/registro-eventual"/);
  assert.match(app, /RegistroEventualPage/);
});

test('backend separa endpoints publicos de endpoints autenticados', () => {
  assert.match(functions, /function publicEndpoint/);
  assert.match(functions, /eventualFormularioCatalogoPublico = publicEndpoint/);
  assert.match(functions, /eventualRegistrarSolicitudPublica = publicEndpoint/);
  assert.match(functions, /eventualConsultarSolicitudPublica = publicEndpoint/);
  assert.match(functions, /eventualListarSolicitudes = endpoint/);
  assert.match(functions, /eventualResolverSolicitud = endpoint/);
});

test('alta publica crea personal y QR inmediatamente con foto', () => {
  const requestPos = functions.indexOf('eventualRegistrarSolicitudPublica');
  const approvePos = functions.indexOf('eventualResolverSolicitud');
  const requestBlock = functions.slice(requestPos, approvePos);
  assert.match(requestBlock, /estado: 'aprobada'/);
  assert.match(requestBlock, /asistenciaPersonal/);
  assert.match(requestBlock, /fotoRostroPath/);
});

test('aprobacion crea personal eventual, clave y QR', () => {
  const approvePos = functions.indexOf('eventualResolverSolicitud');
  const listPos = functions.indexOf('export const asistenciaListarPersonal');
  const block = functions.slice(approvePos, listPos);
  assert.match(block, /asistenciaPersonal/);
  assert.match(block, /asistenciaClaves/);
  assert.match(block, /codigoPersonal\('eventual'\)/);
  assert.match(block, /qr: clave/);
});

test('panel de personal incorpora solicitudes e importacion sin reemplazar el alta existente', () => {
  assert.match(panel, /EventualesTools/);
  assert.match(panel, /Nuevo eventual/);
  assert.match(tools, /Solicitudes pendientes/);
  assert.match(tools, /Importar lista/);
  assert.match(tools, /Copiar liga de registro/);
});

test('registro e importacion contemplan encargado y grupo', () => {
  assert.match(publicPage, /encargadoNombre/);
  assert.doesNotMatch(publicPage, /grupoNombre/);
  assert.match(panel, /encargadoNombre/);
  assert.match(panel, /grupoNombre/);
  assert.match(functions, /datosExtraEventual/);
});


test('formulario publico no pide propiedad y solo consulta puestos', () => {
  assert.doesNotMatch(publicPage, /<label>Propiedad/);
  assert.doesNotMatch(publicPage, /public-eventual-all-properties/);
  const inicio = functions.indexOf('export const eventualFormularioCatalogoPublico');
  const fin = functions.indexOf('export const eventualRegistrarSolicitudPublica');
  const catalogo = functions.slice(inicio, fin);
  assert.match(catalogo, /puestos:/);
  assert.doesNotMatch(catalogo, /propiedades:/);
  const registro = functions.slice(fin, functions.indexOf('export const eventualConsultarSolicitudPublica'));
  assert.match(registro, /alcancePropiedades: 'todas_operativas'/);
  assert.doesNotMatch(registro, /req\.data\?\.propiedadId/);
});

test('aprobacion publica usa propiedades operativas autorizadas sin incluir Mexico', () => {
  const inicio = functions.indexOf('async function propiedadesOperativasEventuales');
  const helper = functions.slice(inicio, functions.indexOf('export const eventualFormularioCatalogoPublico'));
  assert.match(helper, /mexicoId/);
  assert.match(helper, /doc\.id !== mexicoId/);
  const approve = functions.slice(functions.indexOf('export const eventualResolverSolicitud'), functions.indexOf('export const asistenciaListarPersonal'));
  assert.match(approve, /propiedadesOperativasEventuales\(\)/);
  assert.match(approve, /await autorizarPropiedad\(actor, propiedadId\)/);
  assert.match(approve, /propiedadesPermitidas: propiedadesAprobadas/);
  assert.match(approve, /propiedadId: propiedadesAprobadas\[0\]/);
});

test('importacion de Eventuales acepta lista sin propiedad y asigna todas las activas', () => {
  assert.match(tools, /index\.nombre < 0 \|\| index\.puesto < 0/);
  assert.match(tools, /propiedadesPermitidas: row\.property\.ids/);
  assert.match(tools, /Todas las propiedades/);
});

test('funciones publicas incluyen CORS y Hosting evita cachear HTML', () => {
  assert.match(functions, /onCall\(\{ \.\.\.options, cors: true, invoker: 'public' \}/);
  const firebase = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
  assert.ok(firebase.hosting.headers.some((entry) => entry.headers.some((header) =>
    header.key === 'Cache-Control' && header.value.includes('no-cache'))));
});

test('registro visible pide foto y solamente encargado opcional', () => {
  assert.match(publicPage, /Fotografía de rostro \(obligatoria\)/);
  assert.match(publicPage, /fotoRostro/);
  assert.match(publicPage, /Encargado que te invitó/);
  assert.doesNotMatch(publicPage, /Área \(opcional\)|Grupo \/ cuadrilla|revisará tu solicitud/);
});


test('nuevos eventuales se normalizan a mayusculas desde dominio y autorregistro', () => {
  assert.match(functions, /toLocaleUpperCase\('es-MX'\)/);
  const domain = readFileSync(new URL('../shared/asistenciaDomain.js', import.meta.url), 'utf8');
  assert.match(domain, /data\?\.tipo === 'eventual'.*toLocaleUpperCase\('es-MX'\)/);
});
