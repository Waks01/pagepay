import { View } from 'react-native';
import { Skeleton } from '../Skeleton';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

/**
 * Skeleton for a detail/content screen (book detail, task detail, reader).
 *
 * Shows a back-button placeholder, title, meta pills, and body lines.
 */
export function SkeletonDetailPage() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: tokens.paper }}>
      {/* Back button + header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
        <View style={{ marginRight: 12 }}>
          <Skeleton width={32} height={32} borderRadius={16} />
        </View>
      </View>

      {/* Category badge */}
      <Skeleton height={18} width={80} borderRadius={4} marginBottom={12} />

      {/* Title */}
      <Skeleton height={26} width="90%" marginBottom={8} />
      <Skeleton height={26} width="60%" marginBottom={16} />

      {/* Meta pills row */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
        <Skeleton width={90} height={28} borderRadius={14} />
        <Skeleton width={100} height={28} borderRadius={14} />
      </View>

      {/* Body paragraphs */}
      <View style={{ gap: 10 }}>
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="85%" />
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="70%" />
      </View>
    </View>
  );
}
