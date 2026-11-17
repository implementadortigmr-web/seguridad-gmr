// Adaptador de prueba, NO implementacion de jsPDF. Registra las instrucciones
// de dibujo para verificar contenido, paginacion, colores y coordenadas.
export class PdfDrawingRecorder {
  constructor({ metrics = null } = {}) {
    this.metrics = metrics;
    this.pages = [[]];
    this.page = 0;
    this.style = { size: 12, font: 'normal', text: [0, 0, 0], fill: [0, 0, 0], stroke: [0, 0, 0], line: 0.5, factor: 1.15 };
    this.internal = { pageSize: { getWidth: () => 792, getHeight: () => 612 } };
  }
  record(op, data) { this.pages[this.page].push({ op, ...data, style: structuredClone(this.style) }); return this; }
  color(values) { return values.length === 1 ? Array(3).fill(values[0]) : values; }
  setFont(name, style = 'normal') { this.style.font = style; return this; }
  setFontSize(size) { this.style.size = size; return this; }
  setTextColor(...values) { this.style.text = this.color(values); return this; }
  setFillColor(...values) { this.style.fill = this.color(values); return this; }
  setDrawColor(...values) { this.style.stroke = this.color(values); return this; }
  setLineWidth(line) { this.style.line = line; return this; }
  setLineHeightFactor(factor) { this.style.factor = factor; return this; }
  getTextWidth(text) {
    const map = this.metrics?.[this.style.font];
    return [...String(text)].reduce((sum, ch) => sum + (map?.[ch] ?? (/\s/.test(ch) ? 278 : /[ilI.,:!]/.test(ch) ? 278 : /[MW@]/.test(ch) ? 833 : 556)), 0) * this.style.size / 1000;
  }
  splitTextToSize(text, width) {
    const out = [];
    for (const paragraph of String(text).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        const candidate = line ? `${line} ${word}` : word;
        if (this.getTextWidth(candidate) <= width) { line = candidate; continue; }
        if (line) { out.push(line); line = ''; }
        if (this.getTextWidth(word) <= width) { line = word; continue; }
        for (const ch of word) {
          if (line && this.getTextWidth(line + ch) > width) { out.push(line); line = ''; }
          line += ch;
        }
      }
      out.push(line);
    }
    return out;
  }
  text(value, x, y, options = {}) {
    this.record('text', { value, x, y, options });
    // Al escribir texto se emite el color no-trazo. Reproduce el riesgo que
    // originaba el fallo de encabezados, para evitar regresiones.
    this.style.fill = [...this.style.text];
    return this;
  }
  rect(x, y, w, h, paint = 'S') { return this.record('rect', { x, y, w, h, paint }); }
  roundedRect(x, y, w, h, rx, ry, paint = 'S') { return this.record('roundedRect', { x, y, w, h, rx, ry, paint }); }
  line(x1, y1, x2, y2) { return this.record('line', { x1, y1, x2, y2 }); }
  addImage(data, format, x, y, w, h, alias) { return this.record('image', { data, format, x, y, w, h, alias }); }
  getImageProperties() { return { width: 2048, height: 682 }; }
  addPage() { this.pages.push([]); this.page = this.pages.length - 1; return this; }
  setPage(page) { this.page = page - 1; return this; }
  getNumberOfPages() { return this.pages.length; }
}

export function visibleText(doc) {
  return doc.pages.flat().filter((op) => op.op === 'text').flatMap((op) => Array.isArray(op.value) ? op.value : [op.value]).join('\n');
}
