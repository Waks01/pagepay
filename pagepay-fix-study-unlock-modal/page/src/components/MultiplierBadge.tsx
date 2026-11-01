/**
 * Phase 5: Multiplier Badge Component
 * 
 * Shows user's current earning multiplier
 * Displays "2x" badge for premium users
 */

import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMultipliers } from '@/src/shared/hooks/useTierBenefits';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

interface Props {
  activityType: 'reading' | 'ad' | 'task' | 'daily' | 'bills';
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
}

export function MultiplierBadge({ 
  activityType, 
  size = 'medium',
  showLabel = true 
}: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { multipliers, loading } = useMultipliers();

  if (loading || !multipliers) {
    return null;
  }

  // Get multiplier for the activity type
  const multiplierMap = {
    reading: multipliers.reading_points,
    ad: multipliers.ad_rewards,
    task: multipliers.task_rewards,
    daily: multipliers.daily_rewards,
    bills: multipliers.bills_cashback,
  };

  const multiplier = multiplierMap[activityType];

  // Don't show badge for 1x multiplier
  if (multiplier === 1) {
    return null;
  }

  const badgeSize = {
    small: { width: 32, height: 20, fontSize: 10 },
    medium: { width: 40, height: 24, fontSize: 12 },
    large: { width: 48, height: 28, fontSize: 14 },
  }[size];

  return (
    <View style={styles.container}>
      <View style={[
        styles.badge,
        {
          backgroundColor: tokens.primary,
          width: badgeSize.width,
          height: badgeSize.height,
        }
      ]}>
        <Ionicons name="flash" size={badgeSize.fontSize} color="#fff" />
        <Text style={[styles.multiplierText, { fontSize: badgeSize.fontSize }]}>
          {multiplier}x
        </Text>
      </View>
      {showLabel && (
        <Text style={[styles.label, { color: tokens.primary }]}>
          Premium Boost
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 6,
    gap: 2,
  },
  multiplierText: {
    color: '#fff',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  label: {
    fontSize: 10,
    fontFamily: 'SpaceGrotesk_600SemiBold',
  },
});
