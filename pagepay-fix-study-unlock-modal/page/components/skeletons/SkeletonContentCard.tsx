import { View } from 'react-native';
import { Skeleton } from '../Skeleton';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

/**
 * Skeleton loader that replicates the ContentCard shape.
 *
 * Structure mirrors ContentCard:
 * - 6px colored band (top)
 * - 16px padding inside
 * - Title (2 lines)
 * - Author • minutes meta row
 * - Bottom row: points pill + read CTA
 *
 * All spacing and dimensions match the real card to enable
 * seamless visual swap when data loads.
 */
export function SkeletonContentCard() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View
      style={{
        borderRadius: 14,
        overflow: 'hidden',
        marginBottom: 12,
        backgroundColor: tokens.card,
      }}
    >
      {/* Color band (top) */}
      <View style={{ height: 6, backgroundColor: tokens.border }} />

      {/* Content area with padding */}
      <View style={{ padding: 16, gap: 12 }}>
        {/* Title lines */}
        <View style={{ gap: 8 }}>
          <Skeleton height={18} width="85%" />
          <Skeleton height={18} width="65%" />
        </View>

        {/* Meta row (author • minutes) */}
        <Skeleton height={14} width="45%" marginBottom={8} />

        {/* Bottom row: points pill + read CTA */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {/* Points pill (left) */}
          <Skeleton width={90} height={28} borderRadius={12} />

          {/* Read CTA (right) */}
          <Skeleton width={60} height={20} borderRadius={6} />
        </View>
      </View>
    </View>
  );
}
