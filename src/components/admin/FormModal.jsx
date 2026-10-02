import { X } from 'lucide-react';

export default function FormModal({ open, title, subtitle, children, onClose, busy = false, width = '760px' }) {
  if (!open) return null;
  return (
    <div className="admin-form-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose?.();
    }}>
      <section className="admin-form-modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <header className="admin-form-modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="admin-form-modal-close" onClick={onClose} disabled={busy} aria-label="Cerrar">
            <X size={19} />
          </button>
        </header>
        <div className="admin-form-modal-body">{children}</div>
      </section>
    </div>
  );
}
