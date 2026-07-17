import { type ReactNode } from 'react';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-success-50 text-success-600 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-warning-50 text-warning-600 dark:bg-yellow-900/30 dark:text-yellow-400',
  error: 'bg-error-50 text-error-600 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-info-50 text-info-600 dark:bg-blue-900/30 dark:text-blue-400',
  neutral: 'bg-bg-muted text-text-muted',
};

export function Badge({ children, variant = 'neutral', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
