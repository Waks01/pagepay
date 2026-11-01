import { View } from 'react-native';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

/**
 * The PagePay signature mark: a single 32x2 mint bar.
 *
 * Reads as a book chapter opening rule + a Naira note engraved line +
 * a "you are here" indicator. Always paired with the brand wordmark.
 */
export function PageMark({ width = 32, height = 2 }: { width?: number; height?: number }) {
  const scheme = useEffectiveScheme();
  const color = PagePay[scheme].mint;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ width, height, borderRadius: height / 2, backgroundColor: color }}
    />
  );
}