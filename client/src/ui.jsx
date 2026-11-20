import React, { useEffect } from 'react';
import { initials } from './lib.js';

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children }) => (
  <label className="field">
    <span className="field-label">{label}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>
);

export const ErrorBox = ({ error }) => (error ? <div className="alert alert-error" role="alert">{error}</div> : null);

export const Avatar = ({ name, color, size = 32 }) => (
  <span className="avatar" style={{ background: color || '#64748b', width: size, height: size, fontSize: size * 0.4 }}>
    {initials(name)}
  </span>
);

export const Empty = ({ icon, title, children }) => (
  <div className="empty">
    <div className="empty-icon" aria-hidden>{icon}</div>
    <div className="empty-title">{title}</div>
    {children && <div className="empty-text">{children}</div>}
  </div>
);

export const Badge = ({ n }) => (n > 0 ? <span className="badge">{n > 99 ? '99+' : n}</span> : null);
