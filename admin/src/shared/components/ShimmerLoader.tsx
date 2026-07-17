import { type ReactNode } from 'react';

interface SkeletonProps {
  className?: string;
  children?: ReactNode;
}

export function Skeleton({ className = '', children }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md bg-bg-muted ${className}`}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

interface ShimmerLoaderProps {
  lines?: number;
  className?: string;
}

export function ShimmerLoader({ lines = 3, className = '' }: ShimmerLoaderProps) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
    </div>
  );
}
