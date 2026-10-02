export function parseCsv(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (!quoted && cell.length) throw new Error('CSV: comillas fuera de lugar.');
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some((v) => v.trim())) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV: falta cerrar comillas.');
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  if (new Set(headers).size !== headers.length) throw new Error('CSV: hay columnas repetidas.');
  if (!['clave', 'nombre', 'tipo'].every((h) => headers.includes(h))) throw new Error('El CSV necesita columnas clave,nombre,tipo,area,puesto.');
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV: columnas incompletas en fila ${index + 2}.`);
    return Object.fromEntries(headers.map((h, i) => [h, values[i].trim()]));
  });
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`; // prevent spreadsheet formulas
  return `"${text.replaceAll('"', '""')}"`;
}
export function descargarTexto(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
