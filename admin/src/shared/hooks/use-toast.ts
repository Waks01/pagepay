import { toast as sonnerToast } from 'sonner';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  description?: string;
  duration?: number;
}

export function useToast() {
  const show = (type: ToastType, message: string, options?: ToastOptions) => {
    return sonnerToast[type](message, {
      description: options?.description,
      duration: options?.duration ?? 4000,
    });
  };

  return {
    success: (message: string, options?: ToastOptions) => show('success', message, options),
    error: (message: string, options?: ToastOptions) => show('error', message, options),
    info: (message: string, options?: ToastOptions) => show('info', message, options),
    warning: (message: string, options?: ToastOptions) => show('warning', message, options),
  };
}
