import { View } from 'react-native';
import { Skeleton } from '../Skeleton';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

/**
 * Skeleton for the Profile screen.
 *
 * Renders avatar circle, display name, role cards, payout section, and
 * settings rows — mirrors the real profile layout.
 */
export function SkeletonProfile() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: tokens.paper }}>
      {/* Avatar + name */}
      <View style={{ alignItems: 'center', marginBottom: 24 }}>
        <Skeleton width={72} height={72} borderRadius={36} marginBottom={12} />
        <Skeleton height={20} width="50%" marginBottom={6} />
        <Skeleton height={14} width="35%" />
      </View>

      {/* Roles section header */}
      <Skeleton height={12} width={60} marginBottom={12} />

      {/* Role cards */}
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: tokens.border,
            backgroundColor: tokens.card,
            marginBottom: 8,
            gap: 12,
          }}
        >
          <Skeleton width={40} height={40} borderRadius={20} />
          <View style={{ flex: 1, gap: 4 }}>
            <Skeleton height={16} width="60%" />
            <Skeleton height={12} width="40%" />
          </View>
          <Skeleton width={16} height={16} borderRadius={8} />
        </View>
      ))}

      {/* Payout section */}
      <View style={{ marginBottom: 12, marginTop: 8 }}>
        <Skeleton height={12} width={100} />
      </View>
      <View
        style={{
          padding: 16,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: tokens.border,
          backgroundColor: tokens.card,
          marginBottom: 20,
          gap: 8,
        }}
      >
        <Skeleton height={16} width="70%" />
        <Skeleton height={14} width="50%" />
      </View>
    </View>
  );
}
