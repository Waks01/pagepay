import { Modal, Button, Input } from '@/shared/components';
import React, { type ReactNode } from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (inputValue?: string) => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary' | 'secondary';
  confirmVariant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral';
  requireInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  isLoading?: boolean;
  children?: ReactNode;
  hideCancel?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  confirmVariant,
  requireInput = false,
  inputLabel = '',
  inputPlaceholder = '',
  isLoading = false,
  children,
  hideCancel = false,
}: ConfirmModalProps) {
  const [inputValue, setInputValue] = React.useState('');

  const handleConfirm = () => {
    if (requireInput && !inputValue.trim()) {
      return;
    }
    onConfirm(requireInput ? inputValue : undefined);
    setInputValue('');
  };

  const handleClose = () => {
    setInputValue('');
    onClose();
  };

  // Map confirmVariant to Button variant
  const buttonVariant = confirmVariant || variant;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title}>
      <div className="space-y-4">
        {message && <p className="text-text-main">{message}</p>}
        
        {requireInput && (
          <Input
            label={inputLabel}
            placeholder={inputPlaceholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
          />
        )}

        {children}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {!hideCancel && (
            <Button variant="secondary" onClick={handleClose} disabled={isLoading}>
              {cancelText}
            </Button>
          )}
          <Button
            variant={buttonVariant}
            onClick={handleConfirm}
            disabled={isLoading || (requireInput && !inputValue.trim())}
            loading={isLoading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
