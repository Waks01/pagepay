import { type ReactNode, useEffect } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /**
   * Tailwind width class for the panel. Defaults to `max-w-lg`
   * (28rem). Use `max-w-xl` / `max-w-2xl` for forms with many fields.
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
  footer?: ReactNode;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export function Modal({ isOpen, onClose, title, size = 'lg', children, footer }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Lock body scroll while the modal is open so the page underneath
  // doesn't shift when the user interacts with the modal.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      {/* Panel: capped at 90vh so the body can scroll when content is tall. */}
      <div
        className={`relative z-10 flex w-full ${SIZE_CLASS[size]} flex-col rounded-xl bg-bg-card shadow-xl max-h-[90vh]`}
      >
        {title && (
          <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
            <h3 className="text-lg font-semibold text-text-main">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-text-muted hover:bg-bg-hover hover:text-text-main"
            >
              ✕
            </button>
          </div>
        )}
        {/* Body: scrolls when content exceeds the panel height. */}
        <div className="flex-1 overflow-y-auto px-6 py-4 text-sm text-text-main">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-border px-6 py-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
