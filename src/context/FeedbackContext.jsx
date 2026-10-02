import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import {
  inferFeedbackType,
  registerFeedbackApi,
  showFeedback,
  confirmFeedback,
} from '../services/feedbackService';
import './feedback.css';

const FeedbackContext = createContext(null);

const TYPE_META = {
  success: {
    title: 'Operación realizada',
    Icon: CheckCircle2,
  },
  error: {
    title: 'No se pudo completar',
    Icon: XCircle,
  },
  warning: {
    title: 'Revisa la información',
    Icon: AlertTriangle,
  },
  info: {
    title: 'Información',
    Icon: Info,
  },
  danger: {
    title: 'Confirmar acción',
    Icon: ShieldAlert,
  },
};

function normalizeItem(input = {}) {
  const message = String(input.message || '').trim();
  const type = inferFeedbackType(message, input.type || 'info');
  const meta = TYPE_META[type] || TYPE_META.info;

  return {
    id: input.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    title: input.title || meta.title,
    message,
    details: input.details || '',
    confirmText: input.confirmText || 'Aceptar',
    cancelText: input.cancelText || 'Cancelar',
    showCancel: Boolean(input.showCancel),
    closeOnBackdrop: input.closeOnBackdrop !== false,
    actions: Array.isArray(input.actions) ? input.actions.filter((action) => action?.label) : null,
    resolve: input.resolve,
  };
}

function FeedbackModal({ item, onResolve }) {
  const primaryRef = useRef(null);
  const meta = TYPE_META[item.type] || TYPE_META.info;
  const Icon = meta.Icon;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 30);

    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      if (item.actions?.length) onResolve(null);
      else if (item.showCancel) onResolve(false);
      else onResolve(true);
    }

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [item, onResolve]);

  return createPortal(
    <div
      className="gmr-feedback-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || !item.closeOnBackdrop) return;
        onResolve(item.actions?.length ? null : item.showCancel ? false : true);
      }}
    >
      <section
        className={`gmr-feedback-modal ${item.type}`}
        role={item.showCancel || item.actions?.length ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby="gmr-feedback-title"
        aria-describedby="gmr-feedback-message"
      >
        <button
          type="button"
          className="gmr-feedback-close"
          aria-label="Cerrar mensaje"
          onClick={() => onResolve(item.actions?.length ? null : item.showCancel ? false : true)}
        >
          <X size={19} />
        </button>

        <div className={`gmr-feedback-icon ${item.type}`}>
          <Icon size={34} strokeWidth={2.2} />
        </div>

        <div className="gmr-feedback-copy">
          <p className="gmr-feedback-kicker">
            {item.type === 'success'
              ? 'Listo'
              : item.type === 'error'
                ? 'Error'
                : item.type === 'warning' || item.type === 'danger'
                  ? 'Atención'
                  : 'Seguridad GMR'}
          </p>
          <h2 id="gmr-feedback-title">{item.title}</h2>
          <p id="gmr-feedback-message">{item.message}</p>
          {item.details && <pre className="gmr-feedback-details">{item.details}</pre>}
        </div>

        <div className={`gmr-feedback-actions ${item.actions?.length === 3 ? 'three' : ''}`}>
          {item.actions?.length ? (
            item.actions.map((action, index) => (
              <button
                key={`${action.value ?? index}-${action.label}`}
                ref={action.primary ? primaryRef : null}
                type="button"
                className={`gmr-feedback-button ${action.primary ? 'primary' : 'secondary'} ${action.danger ? 'danger' : ''}`}
                onClick={() => onResolve(action.value)}
              >
                {action.label}
              </button>
            ))
          ) : (
            <>
              {item.showCancel && (
                <button
                  type="button"
                  className="gmr-feedback-button secondary"
                  onClick={() => onResolve(false)}
                >
                  {item.cancelText}
                </button>
              )}

              <button
                ref={primaryRef}
                type="button"
                className={`gmr-feedback-button primary ${item.type === 'danger' ? 'danger' : ''}`}
                onClick={() => onResolve(true)}
              >
                {item.confirmText}
              </button>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

export function FeedbackProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const lastNoticeRef = useRef({ key: '', at: 0 });

  const notify = useCallback((input = {}) => {
    const item = normalizeItem(input);
    if (!item.message && !item.title) return undefined;

    const key = `${item.type}|${item.title}|${item.message}`;
    const now = Date.now();
    if (
      lastNoticeRef.current.key === key &&
      now - lastNoticeRef.current.at < 900
    ) {
      return item.id;
    }

    lastNoticeRef.current = { key, at: now };
    setQueue((current) => [...current, item]);
    return item.id;
  }, []);

  const confirm = useCallback((input = {}) => {
    return new Promise((resolve) => {
      const base = normalizeItem({
        ...input,
        type: input.type || 'danger',
        showCancel: true,
        closeOnBackdrop: input.closeOnBackdrop !== false,
        confirmText: input.confirmText || 'Confirmar',
        cancelText: input.cancelText || 'Cancelar',
      });

      setQueue((current) => [...current, { ...base, resolve }]);
    });
  }, []);

  const decision = useCallback((input = {}) => {
    return new Promise((resolve) => {
      const actions = Array.isArray(input.actions) ? input.actions : [];
      const base = normalizeItem({
        ...input,
        type: input.type || 'warning',
        showCancel: false,
        closeOnBackdrop: input.closeOnBackdrop !== false,
        actions,
      });

      setQueue((current) => [...current, { ...base, resolve }]);
    });
  }, []);

  const resolveActive = useCallback((result) => {
    setQueue((current) => {
      if (!current.length) return current;
      const [active, ...rest] = current;
      active.resolve?.(active.actions?.length ? result : Boolean(result));
      return rest;
    });
  }, []);

  useEffect(() => registerFeedbackApi({ notify, confirm }), [notify, confirm]);

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (message) => {
      notify({
        type: inferFeedbackType(message),
        message: String(message || ''),
      });
    };

    return () => {
      window.alert = originalAlert;
    };
  }, [notify]);

  const value = useMemo(
    () => ({
      notify,
      confirm,
      decision,
      success: (message, options = {}) => notify({ ...options, type: 'success', message }),
      error: (message, options = {}) => notify({ ...options, type: 'error', message }),
      warning: (message, options = {}) => notify({ ...options, type: 'warning', message }),
      info: (message, options = {}) => notify({ ...options, type: 'info', message }),
    }),
    [notify, confirm, decision]
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {queue[0] && <FeedbackModal item={queue[0]} onResolve={resolveActive} />}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const value = useContext(FeedbackContext);

  if (!value) {
    return {
      notify: showFeedback,
      confirm: confirmFeedback,
      decision: async (options = {}) => {
        const actions = Array.isArray(options.actions) ? options.actions : [];
        const primary = actions.find((action) => action.primary) || actions[actions.length - 1];
        const ok = await confirmFeedback({
          ...options,
          confirmText: primary?.label || 'Continuar',
          cancelText: 'Cancelar',
        });
        return ok ? primary?.value ?? true : null;
      },
      success: (message, options = {}) => showFeedback({ ...options, type: 'success', message }),
      error: (message, options = {}) => showFeedback({ ...options, type: 'error', message }),
      warning: (message, options = {}) => showFeedback({ ...options, type: 'warning', message }),
      info: (message, options = {}) => showFeedback({ ...options, type: 'info', message }),
    };
  }

  return value;
}
