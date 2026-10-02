'use strict';

/**
 * Utilidad de apoyo para integrar fragmentos históricos de reglas.
 * No se usa en runtime de la app. Se conserva para validaciones y
 * migraciones controladas del proyecto.
 */
function mergeRules(original, fragment, kind = 'firestore') {
  const source = String(original || '');
  const extra = String(fragment || '').trim();

  if (!source.trim()) {
    throw new Error('No se recibieron reglas originales.');
  }

  if (/function\s+asiPerfil\s*\(/.test(source)) {
    throw new Error('El fragmento de Asistencia ya fue aplicado; no lo apliques dos veces.');
  }

  if (kind === 'storage') {
    const recursiveBlocks = source.match(/match\s+\/\{[^}]+=\*\*\}\s*\{[\s\S]*?\}/g) || [];
    for (const block of recursiveBlocks) {
      if (/allow\s+(?:read|write|read\s*,\s*write|write\s*,\s*read)\s*:\s*if\s+(?!false\b)/.test(block)) {
        throw new Error('No se puede integrar sobre un permiso recursivo amplio.');
      }
    }
  }

  const helper = kind === 'storage'
    ? "\n    function asiLegacyCuenta() { return request.auth != null; }\n"
    : "\n    function asiLegacyCuenta() { return request.auth != null; }\n";

  // Protege permisos antiguos para que la integración no convierta
  // accidentalmente Asistencia en un permiso global.
  let gated = source.replace(
    /(allow\s+[a-zA-Z,\s]+\s*:\s*if\s*)([^;]+)(;)/g,
    (full, prefix, expression, suffix) => {
      if (/^\s*false\s*$/.test(expression)) return full;
      if (/asiLegacyCuenta\s*\(/.test(expression)) return full;
      return `${prefix}asiLegacyCuenta() && (${expression.trim()})${suffix}`;
    }
  );

  const marker = kind === 'storage'
    ? /match\s+\/b\/\{bucket\}\/o\s*\{/
    : /match\s+\/databases\/\{database\}\/documents\s*\{/;

  const match = gated.match(marker);
  if (!match || match.index == null) {
    throw new Error('No se encontró el bloque principal de reglas.');
  }

  const insertAt = match.index + match[0].length;
  gated = gated.slice(0, insertAt) + helper + gated.slice(insertAt);

  if (extra) {
    // Inserta el fragmento antes del último cierre del bloque principal.
    // Para archivos estándar de Firebase, los dos últimos cierres son
    // el match principal y el service.
    const last = gated.lastIndexOf('}');
    const previous = gated.lastIndexOf('}', last - 1);
    const target = previous >= 0 ? previous : last;
    gated = `${gated.slice(0, target)}\n${extra}\n${gated.slice(target)}`;
  }

  return gated;
}

module.exports = { mergeRules };
