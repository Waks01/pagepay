import { motion } from 'framer-motion';
import { PageMark } from './PageMark';

interface AuthScreenEntranceProps {
  title: string;
  subtitle?: string;
}

/**
 * Staggered entrance for the auth card header.
 *
 * Sequence: PageMark slides in from the left (0 → 320ms) → title fades
 * in (delay 200ms, 320ms) → subtitle fades in (delay 400ms, 320ms).
 * Mirrors `client/components/AuthScreenEntrance.tsx` exactly in timing
 * and easing, swapped from Reanimated worklets to framer-motion.
 */
const EASE_OUT = [0.16, 1, 0.3, 1] as const; // expo-out

export function AuthScreenEntrance({ title, subtitle }: AuthScreenEntranceProps) {
  return (
    <div className="mb-8 flex flex-col items-center gap-3 text-center">
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.32, ease: EASE_OUT }}
      >
        <PageMark width={40} height={3} variant="pulse" />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.32, delay: 0.2, ease: EASE_OUT }}
        className="text-[28px] font-bold leading-[34px] tracking-[-0.01em] text-text-main"
        style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}
      >
        {title}
      </motion.h1>

      {subtitle ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.32, delay: 0.4, ease: EASE_OUT }}
          className="text-sm leading-5 text-text-muted"
        >
          {subtitle}
        </motion.p>
      ) : null}
    </div>
  );
}
