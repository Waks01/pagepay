import { type ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

interface TableHeaderProps {
  children: ReactNode;
  className?: string;
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
}

interface TableCellProps {
  children: ReactNode;
  className?: string;
  header?: boolean;
}

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-bg-card ${className}`}>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">{children}</table>
      </div>
    </div>
  );
}

export function TableHeader({ children, className = '' }: TableHeaderProps) {
  return (
    <thead className={`bg-bg-muted ${className}`}>
      {children}
    </thead>
  );
}

export function TableRow({ children, className = '' }: TableRowProps) {
  return (
    <tr className={`border-b border-border last:border-b-0 ${className}`}>
      {children}
    </tr>
  );
}

export function TableCell({ children, className = '', header = false }: TableCellProps) {
  const baseClasses = header
    ? 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted'
    : 'px-4 py-3 text-sm text-text-main';
  return <td className={`${baseClasses} ${className}`}>{children}</td>;
}

export function TableHeaderCell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted ${className}`}>{children}</th>;
}
