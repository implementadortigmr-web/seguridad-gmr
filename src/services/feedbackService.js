let feedbackApi = null;

const nativeAlert =
  typeof window !== 'undefined' && typeof window.alert === 'function'
    ? window.alert.bind(window)
    : null;

const nativeConfirm =
  typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm.bind(window)
    : null;

export function registerFeedbackApi(api) {
  feedbackApi = api || null;
  return () => {
    if (feedbackApi === api) feedbackApi = null;
  };
}

export function inferFeedbackType(message, preferred = 'info') {
  if (preferred && preferred !== 'info') return preferred;

  const text = String(message || '').toLowerCase();

  if (
    /correctamente|guardad[oa]|actualizad[oa]|cread[oa]|registrad[oa]|finalizad[oa]|sincronizad[oa]|completad[oa]|generad[oa]|eliminad[oa]|activad[oa]|desactivad[oa]|éxito|exito|aprobad[oa]/.test(
      text
    )
  ) {
    return 'success';
  }

  if (
    /no fue posible|error|rechaz|deneg|sin permiso|no tienes permiso|fall[oó]|inv[aá]lid|no se pudo|no se encontr[oó]|no existe|unauthorized|permission/.test(
      text
    )
  ) {
    return 'error';
  }

  if (
    /selecciona|agrega|obligatori|pendiente|confirma|revisa|advertencia|solo se puede|debes|primero|sin salida|no hay conexi[oó]n/.test(
      text
    )
  ) {
    return 'warning';
  }

  return preferred || 'info';
}

export function isTransientFeedback(message) {
  const text = String(message || '').trim().toLowerCase();

  if (!text) return false;

  return /^(cargando|guardando|actualizando|preparando|iniciando|reanudando|pausando|finalizando|subiendo|sincronizando|cerrando|importando|procesando|consultando|capturando|descargando|editando|mostrando|revisando)/.test(
    text
  );
}

export function showFeedback(options) {
  const normalized =
    typeof options === 'string'
      ? { message: options }
      : { ...(options || {}) };

  if (feedbackApi?.notify) {
    return feedbackApi.notify(normalized);
  }

  nativeAlert?.(String(normalized.message || normalized.title || ''));
  return undefined;
}

export function confirmFeedback(options) {
  const normalized =
    typeof options === 'string'
      ? { message: options }
      : { ...(options || {}) };

  if (feedbackApi?.confirm) {
    return feedbackApi.confirm(normalized);
  }

  return Promise.resolve(
    nativeConfirm
      ? nativeConfirm(String(normalized.message || normalized.title || ''))
      : false
  );
}

export const feedback = {
  show: showFeedback,
  success(message, options = {}) {
    return showFeedback({ ...options, type: 'success', message });
  },
  error(message, options = {}) {
    return showFeedback({ ...options, type: 'error', message });
  },
  warning(message, options = {}) {
    return showFeedback({ ...options, type: 'warning', message });
  },
  info(message, options = {}) {
    return showFeedback({ ...options, type: 'info', message });
  },
  confirm: confirmFeedback,
};
