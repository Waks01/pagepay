import { View } from 'react-native';
import { Skeleton } from '../Skeleton';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

type Props = {
  /** Number of card skeletons to render (default 3) */
  count?: number;
  /** Whether to include a header skeleton row (default true) */
  header?: boolean;
};

/**
 * Full-page skeleton layout.
 *
 * Renders a header skeleton (title + optional right icon) followed by
 * `count` card skeletons — perfect for any list/feed screen.
 *
 * Usage: return <SkeletonPage count={4} /> in loading state.
 */
export function SkeletonPage({ count = 3, header = true }: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: tokens.paper }}>
      {header && (
        <View style={{ marginBottom: 20 }}>
          <Skeleton height={24} width="55%" marginBottom={12} />
        </View>
      )}

      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            backgroundColor: tokens.card,
            borderRadius: 12,
            padding: 16,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: tokens.border,
            gap: 10,
          }}
        >
          <Skeleton height={14} width="40%" borderRadius={6} />
          <Skeleton height={18} width="85%" />
          <Skeleton height={14} width="65%" />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Skeleton width={80} height={24} borderRadius={6} />
            <Skeleton width={60} height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}
