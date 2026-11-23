import { useContext, useId, useLayoutEffect, useRef } from 'react';
import { WorkspaceTheme } from '../layout/WorkspaceTheme';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  full: 'max-w-full mx-4',
};

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function Modal({
  isOpen,
  onClose,
  title,
  ariaLabel,
  children,
  size = 'md',
  className,
  overlayClassName,
  initialFocusRef,
  closeLabel = 'Close dialog',
}) {
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const optionsRef = useRef({ onClose, initialFocusRef });
  const titleId = `modal-title-${useId().replace(/:/g, '')}`;
  const workspace = useContext(WorkspaceTheme);

  useLayoutEffect(() => {
    optionsRef.current = { onClose, initialFocusRef };
  }, [onClose, initialFocusRef]);

  // Focus and background isolation belong to the lifetime of the open dialog.
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    const appRoot = document.getElementById('root');
    const previousInert = appRoot?.inert;
    const previousOverflow = document.body.style.overflow;
    const target = optionsRef.current.initialFocusRef?.current || dialog.querySelector(FOCUSABLE) || dialog;

    target.focus();
    if (appRoot) appRoot.inert = true;
    document.body.style.overflow = 'hidden';

    const handleKey = (event) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== dialogRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        optionsRef.current.onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE)]
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      if (appRoot) appRoot.inert = previousInert;
      if (opener?.isConnected) opener.focus?.({ preventScroll: true });
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={cn('fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4', overlayClassName)}
      onMouseDown={(event) => event.target === overlayRef.current && onClose?.()}
    >
      <div className="pointer-events-none absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? (ariaLabel || 'Dialog') : undefined}
        tabIndex={-1}
        className={cn(
          'glass relative w-full rounded-t-2xl sm:rounded-2xl shadow-card animate-slide-up sm:animate-scale-in',
          'max-h-[90vh] flex flex-col outline-none',
          sizes[size],
          workspace && 'workspace-theme workspace-dialog',
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-navy-700/60 shrink-0">
            <h2 id={titleId} className="font-semibold text-slate-100">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              title="Close"
              className="min-w-11 min-h-11 p-2 rounded-lg hover:bg-navy-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
