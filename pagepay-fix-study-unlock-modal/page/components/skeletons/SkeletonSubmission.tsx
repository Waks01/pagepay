import { View } from 'react-native';
import { Skeleton } from '../Skeleton';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

/**
 * Skeleton for a submission card (sponsor task detail).
 *
 * Shows worker email, status badge, proof items, and action buttons.
 */
export function SkeletonSubmission() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View
      style={{
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.card,
        gap: 12,
      }}
    >
      {/* Header: email + status badge */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ gap: 4, flex: 1 }}>
          <Skeleton height={16} width="60%" />
          <Skeleton height={12} width="40%" />
        </View>
        <Skeleton width={70} height={22} borderRadius={12} />
      </View>

      {/* Proof items */}
      <Skeleton height={14} width="50%" />
      <Skeleton height={14} width="65%" />

      {/* Action buttons */}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
        <Skeleton width="48%" height={40} borderRadius={8} />
        <Skeleton width="48%" height={40} borderRadius={8} />
      </View>
    </View>
  );
}
