import { useEffect } from 'react';
import { motion, useAnimationControls } from 'framer-motion';

interface ErrorShakeProps {
  trigger?: boolean;
  children: React.ReactNode;
}

/**
 * Wraps any content and shakes it horizontally on error.
 *
 * Three oscillations (-10, 10, -8, 8, -4, 0) using the Material
 * standard bezier for a snappier feel than a generic ease. The final
 * step lands at 0 so re-triggering always starts from a known origin.
 * Mirrors `client/components/ErrorShake.tsx`.
 */
const EASE = [0.36, 0.07, 0.19, 0.97] as const;
const KEYFRAMES = [-10, 10, -8, 8, -4, 0];

export function ErrorShake({ trigger = false, children }: ErrorShakeProps) {
  const controls = useAnimationControls();

  useEffect(() => {
    if (trigger) {
      controls.set({ x: 0 });
      controls.start({
        x: KEYFRAMES,
        transition: { duration: 0.42, ease: EASE, times: [0, 0.17, 0.34, 0.51, 0.68, 1] },
      });
    }
  }, [trigger, controls]);

  return <motion.div animate={controls}>{children}</motion.div>;
}
