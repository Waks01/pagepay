/**
 * Resolve the effective color scheme by layering the user's theme
 * preference on top of the OS color scheme.
 *
 * - `theme === 'system'` → defer to `useColorScheme()` (OS default)
 * - `theme === 'light'`  → always light
 * - `theme === 'dark'`   → always dark
 * - `theme === 'sepia'`  → always sepia (paper-toned, easier on eyes)
 *
 * Returns `'light'` as a safe default during the first frame, before
 * the preferences store has hydrated. This avoids a flicker where
 * every screen reads `undefined` and renders as light, only to flip
 * to dark a moment later when the store hydrates.
 */
import { useColorScheme } from 'react-native';
import { usePreferences } from '@/src/shared/lib/preferences';

export type EffectiveScheme = 'light' | 'dark' | 'sepia';

export function useEffectiveScheme(): EffectiveScheme {
  const os = useColorScheme();
  const theme = usePreferences((s) => s.theme);
  if (theme === 'light' || theme === 'dark' || theme === 'sepia') return theme;
  return os === 'dark' ? 'dark' : 'light';
}