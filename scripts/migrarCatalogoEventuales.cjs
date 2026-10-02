/* Read source only; opt-in destination writes; never migrates users/passwords/payroll. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
async function main() {
  const args = process.argv.slice(2); const arg = (f) => args.includes(f) ? args[args.indexOf(f) + 1] : '';
  const source = arg('--origen'); const target = arg('--destino'); const propiedadId = arg('--propiedad');
  if (!source || !target || !propiedadId || source === target) throw new Error('Indica --origen PROYECTO_EVENTUALES --destino PROYECTO_SEGURIDAD --propiedad ID_PROPIEDAD_EXISTENTE.');
  const apply = args.includes('--aplicar');
  if (apply && arg('--confirmar') !== target) throw new Error('Para escribir tambien debes agregar --confirmar con el ID exacto del proyecto destino.');
  const sourceKeyPath = process.env.EVENTUALES_CREDENTIALS;
  const targetKeyPath = process.env.SEGURIDAD_CREDENTIALS;
  if (!sourceKeyPath || !targetKeyPath) throw new Error('Define EVENTUALES_CREDENTIALS y SEGURIDAD_CREDENTIALS con rutas privadas fuera del proyecto.');
  const readKey = (p, expected) => { const key = JSON.parse(fs.readFileSync(p, 'utf8')); if (key.project_id !== expected) throw new Error('El project_id de una credencial no coincide con el proyecto indicado.'); return key; };
  const sourceApp = initializeApp({ credential: cert(readKey(sourceKeyPath, source)), projectId: source }, 'eventuales-origen-lectura');
  const targetApp = initializeApp({ credential: cert(readKey(targetKeyPath, target)), projectId: target }, 'seguridad-destino');
  try {
    const from = getFirestore(sourceApp); const to = getFirestore(targetApp);
    const property = await to.doc(`propiedades/${propiedadId}`).get();
    if (!property.exists) throw new Error('La propiedad destino no existe.');
    const { validarPersonal } = await import('../shared/asistenciaDomain.js');
    const collections = [['workers', 'eventual'], ['interns', 'practicante']];
    const plan = []; const used = new Set(); const backup = { origen: source, destino: target, propiedadId, exportadoEn: new Date().toISOString(), catalogos: {} };
    for (const [collection, tipo] of collections) {
      const snap = await from.collection(collection).get();
      backup.catalogos[collection] = snap.docs.map((d) => ({ documentoId: d.id, datos: d.data() }));
      for (const d of snap.docs) {
        const old = d.data();
        const fields = validarPersonal({ clave: String(old.id || old.qr || ''), nombre: old.name, tipo, area: old.area || '', puesto: old.defaultRoleName || old.career || '', activo: old.active !== false });
        if (used.has(fields.clave)) throw new Error(`Clave duplicada ${fields.clave} entre catalogos. Resuelve el duplicado antes de importar. No se escribio nada.`);
        used.add(fields.clave);
        const id = `emp_${hash(`${propiedadId}\0${fields.clave}`)}`;
        const ref = to.doc(`asistenciaPersonal/${id}`); const existing = await ref.get();
        plan.push({ ref, id, exists: existing.exists, data: { ...fields, propiedadId,
          origen: { proyecto: source, coleccion: collection, documentoId: d.id },
          datosOriginalesEventuales: old,
          creadoEn: FieldValue.serverTimestamp(), creadoPor: 'migracion_controlada',
          actualizadoEn: FieldValue.serverTimestamp(),
        } });
      }
    }
    // Only the catalog is imported; preserve the source and do not overwrite security roles.
    const folder = path.resolve('exports-privados'); fs.mkdirSync(folder, { recursive: true });
    const backupPath = path.join(folder, `catalogo-eventuales-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { mode: 0o600 });
    const nuevos = plan.filter((p) => !p.exists);
    console.log(`Origen: ${source}. Destino: ${target}. Propiedad: ${propiedadId}.`);
    console.log(`Nuevos: ${nuevos.length}. Existentes omitidos: ${plan.length - nuevos.length}.`);
    console.log(`Respaldo privado local: ${backupPath}`);
    if (!apply) { console.log('SIMULACION: no se escribio en Firebase. Revisa los resultados antes de --aplicar.'); return; }
    for (const item of nuevos) {
      try { await item.ref.create(item.data); }
      catch (e) { if (e.code !== 6 && e.code !== 'already-exists') throw e; }
    }
    await to.collection('asistenciaImportaciones').add({ origen: source, propiedadId, nuevasPrevistas: nuevos.length,
      ejecutadoEn: FieldValue.serverTimestamp(), alcance: 'solo_catalogos_sin_historico_ni_pagos' });
    console.log('Catalogos importados. Historiales, pagos, usuarios y roles originales NO fueron modificados.');
  } finally { await Promise.all([deleteApp(sourceApp), deleteApp(targetApp)]); }
}
main().catch((e) => { console.error('Importacion detenida:', e.message); process.exitCode = 1; });
