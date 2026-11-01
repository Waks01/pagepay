import { View } from 'react-native';
import { Skeleton } from '../Skeleton';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

/**
 * Skeleton loader for a transaction row in the wallet list.
 *
 * Structure mirrors a single transaction item:
 * - Left column: icon placeholder + transaction type/description
 * - Right column: amount (±) + date
 *
 * Used to show structure while transaction list is loading.
 */
export function SkeletonTransactionRow() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: tokens.border,
      }}
    >
      {/* Left: icon + description */}
      <View style={{ flexDirection: 'row', gap: 12, flex: 1 }}>
        {/* Icon placeholder */}
        <Skeleton width={40} height={40} borderRadius={20} />

        {/* Description */}
        <View style={{ gap: 6, flex: 1 }}>
          <Skeleton height={14} width="70%" />
          <Skeleton height={12} width="50%" />
        </View>
      </View>

      {/* Right: amount + date */}
      <View style={{ gap: 6, alignItems: 'flex-end' }}>
        <Skeleton width={70} height={14} />
        <Skeleton width={60} height={12} />
      </View>
    </View>
  );
}
