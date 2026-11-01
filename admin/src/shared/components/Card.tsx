import { type ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

interface StatCardProps {
  label: string;
  value: string | number;
  change?: { value: number; trend: 'up' | 'down' };
  icon?: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`rounded-xl border border-border bg-bg-card shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="flex flex-col gap-1 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div>
        <h3 className="text-sm font-semibold text-text-main">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {action && <div className="mt-2 sm:mt-0">{action}</div>}
    </div>
  );
}

export function StatCard({ label, value, change, icon, className = '' }: StatCardProps) {
  return (
    <Card className={`p-4 sm:p-5 ${className}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-muted">{label}</p>
        {icon && <div className="text-text-muted">{icon}</div>}
      </div>
      <p className="mt-2 text-2xl font-bold text-text-main sm:text-3xl">{value}</p>
      {change && (
        <p className={`mt-2 text-sm font-semibold ${change.trend === 'up' ? 'text-success' : 'text-error'}`}>
          {change.trend === 'up' ? '↑' : '↓'} {Math.abs(change.value)}%
        </p>
      )}
    </Card>
  );
}
