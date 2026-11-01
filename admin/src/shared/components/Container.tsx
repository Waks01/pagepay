import { type ReactNode } from 'react';

interface ContainerProps {
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
}

/**
 * Responsive container wrapper with consistent padding and optional max-width.
 * Provides horizontal spacing from browser edges and centers content.
 */
export function Container({ children, size = 'md', className = '' }: ContainerProps) {
  const sizeClasses = {
    sm: 'max-w-3xl',
    md: 'max-w-5xl',
    lg: 'max-w-7xl',
    xl: 'max-w-screen-2xl',
    full: 'w-full',
  };

  return (
    <div className={`mx-auto px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10 ${sizeClasses[size]} ${className}`}>
      {children}
    </div>
  );
}
