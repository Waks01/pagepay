import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

interface AnimatedSubmitButtonProps {
  title: string;
  onClick: () => void;
  isLoading?: boolean;
  isSuccess?: boolean;
  isError?: boolean;
  disabled?: boolean;
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * Submit button with a four-state visual state machine.
 *
 *   idle    → primary mint background, label visible
 *   loading → primary-600 tint, spinner fades in, label fades out
 *   success → primary-700 deeper green, checkmark scales in 0.6 → 1.25 → 1
 *   error   → brief flash to error red, then back to primary
 *
 * Mirrors `client/components/AnimatedSubmitButton.tsx`. On press, the
 * whole button dips to 0.96 then springs back to 1. All transitions
 * use the same expo-out easing as the client.
 */
export function AnimatedSubmitButton({
  title,
  onClick,
  isLoading = false,
  isSuccess = false,
  isError = false,
  disabled = false,
}: AnimatedSubmitButtonProps) {
  const [state, setState] = useState<SubmitState>('idle');

  useEffect(() => {
    if (isLoading) setState('loading');
    else if (isSuccess) setState('success');
    else if (isError) {
      setState('error');
      const t = setTimeout(() => setState('idle'), 600);
      return () => clearTimeout(t);
    } else setState('idle');
  }, [isLoading, isSuccess, isError]);

  // Background color tracks the current state. The `error` flash is
  // handled by a one-shot animation rather than a steady color.
  const bgClass =
    state === 'loading'
      ? 'bg-primary-600'
      : state === 'success'
        ? 'bg-primary-700'
        : 'bg-primary';

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled || state === 'loading' || state === 'success'}
      whileTap={{ scale: 0.96 }}
      transition={{ duration: 0.12, ease: EASE_OUT }}
      animate={
        state === 'error'
          ? { backgroundColor: ['var(--color-primary)', 'var(--color-error)', 'var(--color-primary)'] }
          : undefined
      }
      className={[
        'relative flex w-full items-center justify-center overflow-hidden',
        'rounded-xl px-6 py-3.5 text-base font-bold text-white',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2',
        state === 'error' ? '' : bgClass,
      ].join(' ')}
      style={{ minHeight: 52, fontFamily: "'Space Grotesk', system-ui, sans-serif" }}
    >
      {/* Label */}
      <AnimatePresence mode="wait">
        {state === 'idle' || state === 'error' ? (
          <motion.span
            key="label"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            {title}
          </motion.span>
        ) : null}

        {state === 'loading' ? (
          <motion.span
            key="spinner"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="inline-flex"
          >
            <Loader2 size={20} className="animate-spin" />
          </motion.span>
        ) : null}

        {state === 'success' ? (
          <motion.span
            key="check"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: [0.6, 1.25, 1] }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            className="inline-flex"
          >
            <Check size={20} strokeWidth={3} />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.button>
  );
}
