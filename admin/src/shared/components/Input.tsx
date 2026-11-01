import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div className={className}>
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-text-main">
          {label}
        </label>
      )}
      <input
        {...props}
        className={`
          w-full rounded-lg border bg-bg-main px-3 py-2 text-sm text-text-main
          placeholder:text-text-muted
          focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1
          disabled:cursor-not-allowed disabled:opacity-50
          transition-colors
          ${error ? 'border-error' : 'border-border hover:border-border-hover'}
        `}
      />
      {error && (
        <p className="mt-1.5 text-sm text-error">{error}</p>
      )}
    </div>
  );
}
