import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

type EarnBadgeProps = {
  points: number;
  /** Optional override label, e.g. "Earns" instead of "+X pts". */
  label?: string;
};

/**
 * EarnBadge — mint pill showing estimated points earned for a purchase.
 * Used inline in section card headers (replaces the full summary card).
 */
export function EarnBadge({ points, label }: EarnBadgeProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
      ]}
    >
      <Ionicons name="gift-outline" size={14} color={tokens.mint} />
      <Text style={[styles.text, { color: tokens.mint }]}>
        {label ? `${label} ` : ''}+{points} sp
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
