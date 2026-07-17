import { View } from 'react-native';
import { Skeleton } from '../Skeleton';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

/**
 * Skeleton loader for the wallet balance card.
 *
 * Structure mirrors the balance card header:
 * - Label row ("Available balance")
 * - Large balance value (animated)
 * - Subtext (e.g., "₦0.00")
 *
 * Used in the wallet screen to show structure while
 * user data is loading.
 */
export function SkeletonBalanceCard() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View
      style={{
        borderRadius: 12,
        padding: 20,
        gap: 12,
        backgroundColor: tokens.card,
        borderWidth: 1,
        borderColor: tokens.border,
        marginBottom: 16,
      }}
    >
      {/* Label */}
      <Skeleton height={14} width="45%" marginBottom={4} />

      {/* Large balance value */}
      <Skeleton height={32} width="70%" marginBottom={8} />

      {/* Subtext (currency amount) */}
      <Skeleton height={16} width="50%" />
    </View>
  );
}
