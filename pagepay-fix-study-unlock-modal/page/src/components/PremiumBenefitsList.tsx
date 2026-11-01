/**
 * Phase 5: Premium Benefits List Component
 * 
 * Simple list of premium benefits from tier_benefits.json
 * Used in modals, quick upsells, and premium screen
 */

import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTierBenefitsConfig } from '@/src/shared/hooks/useTierBenefits';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

interface Props {
  tier?: 'premium_monthly' | 'premium_yearly';
  limit?: number;
}

export function PremiumBenefitsList({ tier = 'premium_monthly', limit }: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { benefits, loading } = useTierBenefitsConfig();

  if (loading || !benefits) {
    return (
      <View style={styles.container}>
        <Text style={[styles.loadingText, { color: tokens.textMuted }]}>
          Loading benefits...
        </Text>
      </View>
    );
  }

  const tierConfig = benefits[tier];
  const benefitsList = tierConfig.benefits_display;
  const displayList = limit ? benefitsList.slice(0, limit) : benefitsList;

  return (
    <View style={styles.container}>
      {displayList.map((benefit, index) => (
        <View key={index} style={styles.benefitItem}>
          <Ionicons 
            name="checkmark-circle" 
            size={20} 
            color={tokens.success || tokens.primary} 
            style={styles.icon}
          />
          <Text style={[styles.benefitText, { color: tokens.ink }]}>
            {benefit}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  loadingText: {
    textAlign: 'center',
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  icon: {
    marginTop: 2,
  },
  benefitText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'SpaceGrotesk_400Regular',
    lineHeight: 20,
  },
});
