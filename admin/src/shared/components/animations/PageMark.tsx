import { motion } from 'framer-motion';

type PageMarkVariant = 'idle' | 'pulse' | 'loading' | 'success' | 'error';

interface PageMarkProps {
  width?: number;
  height?: number;
  variant?: PageMarkVariant;
  className?: string;
}

/**
 * PagePay brand mark — a single rounded mint bar.
 *
 * Mirrors `client/components/AnimatedPageMark.tsx`. Five variants:
 *   - idle:    static mint bar with a soft breathing glow loop
 *   - pulse:   gentle scale 1 → 1.12 loop, mint
 *   - loading: full 360° spin with opacity dip, mint
 *   - success: scale 1 → 1.5 → 1.15, with a stronger glow, mint
 *   - error:   micro-shake to scale 0.92, color flashes to signal then back
 *
 * Inherits color from CSS so light/dark schemes work without a hook.
 */
export function PageMark({
  width = 32,
  height = 2,
  variant = 'idle',
  className = '',
}: PageMarkProps) {
  const baseStyle: React.CSSProperties = {
    width,
    height,
    borderRadius: height / 2,
    backgroundColor: 'var(--color-primary)',
  };

  if (variant === 'pulse') {
    return (
      <motion.div
        className={className}
        style={{ ...baseStyle, position: 'relative' }}
        animate={{ scale: [1, 1.12, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      />
    );
  }

  if (variant === 'loading') {
    return (
      <motion.div
        className={className}
        style={{ ...baseStyle, transformOrigin: 'center' }}
        animate={{ rotate: 360, opacity: [1, 0.5, 1] }}
        transition={{
          rotate: { duration: 2.2, repeat: Infinity, ease: 'linear' },
          opacity: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' },
        }}
      />
    );
  }

  if (variant === 'success') {
    return (
      <motion.div
        className={className}
        style={{ ...baseStyle, transformOrigin: 'center' }}
        initial={{ scale: 1 }}
        animate={{ scale: [1, 1.5, 1.15] }}
        transition={{ duration: 0.56, ease: 'easeOut' }}
      />
    );
  }

  if (variant === 'error') {
    return (
      <motion.div
        className={className}
        style={{ ...baseStyle, transformOrigin: 'center' }}
        initial={{ backgroundColor: 'var(--color-primary)' }}
        animate={{
          backgroundColor: ['var(--color-primary)', 'var(--color-error)', 'var(--color-error)', 'var(--color-primary)'],
          scale: [1, 0.92, 0.92, 1],
        }}
        transition={{ duration: 0.7, ease: 'easeInOut' }}
      />
    );
  }

  // idle — soft breathing glow loop, no scale change
  return (
    <motion.div
      className={className}
      style={{ ...baseStyle, position: 'relative' }}
      animate={{ opacity: [1, 0.85, 1] }}
      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}
