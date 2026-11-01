/**
 * Phase 5: Premium Benefits Comparison Component
 * 
 * Displays feature comparison between Free and Premium tiers
 * Uses tier_benefits.json data from backend
 */

import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTierBenefitsConfig, useUserTier } from '@/src/shared/hooks/useTierBenefits';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

interface BenefitRowProps {
  feature: string;
  free: string;
  premium: string;
  highlight?: boolean;
  tokens: any;
}

function BenefitRow({ feature, free, premium, highlight, tokens }: BenefitRowProps) {
  return (
    <View style={[
      styles.benefitRow,
      { borderBottomColor: tokens.border },
      highlight && { backgroundColor: tokens.primaryFaint }
    ]}>
      <Text style={[styles.featureName, { color: tokens.ink }]}>
        {feature}
      </Text>
      <View style={styles.tierColumns}>
        <View style={styles.tierColumn}>
          <Text style={[styles.tierValue, { color: tokens.textMuted }]}>
            {free}
          </Text>
        </View>
        <View style={styles.tierColumn}>
          <Text style={[
            styles.tierValue,
            { color: tokens.primary, fontFamily: 'SpaceGrotesk_700Bold' }
          ]}>
            {premium}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function PremiumBenefitsComparison() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { benefits, loading } = useTierBenefitsConfig();
  const { tierStatus } = useUserTier();

  if (loading || !benefits) {
    return (
      <View style={styles.container}>
        <Text style={[styles.loadingText, { color: tokens.textMuted }]}>
          Loading benefits...
        </Text>
      </View>
    );
  }

  const comparison = benefits.comparison;

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: tokens.card }]}>
        <Text style={[styles.title, { color: tokens.ink }]}>
          Compare Plans
        </Text>
        <View style={styles.tierHeaders}>
          <Text style={[styles.tierHeader, { color: tokens.textMuted }]}>
            Free
          </Text>
          <Text style={[styles.tierHeader, { color: tokens.primary }]}>
            Premium
          </Text>
        </View>
      </View>

      {/* Reading Novels */}
      <View style={[styles.section, { backgroundColor: tokens.paper }]}>
        <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
          📚 Reading Novels
        </Text>
        <BenefitRow
          feature="Points per slice (no ads)"
          free={comparison.reading_novels.free_no_ads}
          premium={comparison.reading_novels.premium_no_ads}
          tokens={tokens}
          highlight
        />
        <BenefitRow
          feature="Points per slice (with ads)"
          free={comparison.reading_novels.free_with_ads}
          premium={comparison.reading_novels.premium_with_ads}
          tokens={tokens}
        />
        <Text style={[styles.note, { color: tokens.textMuted }]}>
          {comparison.reading_novels.unit}
        </Text>
      </View>

      {/* Reading Study Materials */}
      <View style={[styles.section, { backgroundColor: tokens.paper }]}>
        <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
          🎓 Study Materials
        </Text>
        <BenefitRow
          feature="Points per slice"
          free={`${comparison.reading_study_materials.free}`}
          premium={`${comparison.reading_study_materials.premium}`}
          tokens={tokens}
          highlight
        />
        <Text style={[styles.note, { color: tokens.textMuted }]}>
          {comparison.reading_study_materials.note}
        </Text>
      </View>

      {/* Ad Rewards */}
      <View style={[styles.section, { backgroundColor: tokens.paper }]}>
        <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
          📺 Ad Rewards
        </Text>
        <BenefitRow
          feature="Points per rewarded ad"
          free={`${comparison.ad_reward_points.free} points`}
          premium={`${comparison.ad_reward_points.premium} points (${comparison.ad_reward_points.premium_multiplier})`}
          tokens={tokens}
          highlight
        />
        <BenefitRow
          feature="Novel ad experience"
          free={comparison.novel_ad_experience.free}
          premium={comparison.novel_ad_experience.premium}
          tokens={tokens}
        />
      </View>

      {/* Study Materials */}
      <View style={[styles.section, { backgroundColor: tokens.paper }]}>
        <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
          📖 Study Material Access
        </Text>
        <BenefitRow
          feature="Unlock cost"
          free={`${comparison.study_unlock_cost.free} points`}
          premium="FREE"
          tokens={tokens}
          highlight
        />
        <BenefitRow
          feature="Education unlock"
          free={comparison.education_unlock.free}
          premium={comparison.education_unlock.premium}
          tokens={tokens}
        />
        <BenefitRow
          feature="Listen mode"
          free={comparison.listen_mode_access.free}
          premium={comparison.listen_mode_access.premium}
          tokens={tokens}
        />
      </View>

      {/* Task & Daily Rewards */}
      <View style={[styles.section, { backgroundColor: tokens.paper }]}>
        <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
          ⚡ Rewards Multipliers
        </Text>
        <BenefitRow
          feature="Task rewards"
          free={comparison.task_rewards.free}
          premium={comparison.task_rewards.premium}
          tokens={tokens}
          highlight
        />
        <BenefitRow
          feature="Daily rewards"
          free={comparison.daily_rewards.free}
          premium={comparison.daily_rewards.premium}
          tokens={tokens}
          highlight
        />
        <BenefitRow
          feature="Bills cashback"
          free={comparison.bills_cashback.free}
          premium={comparison.bills_cashback.premium}
          tokens={tokens}
          highlight
        />
      </View>

      {/* Current Tier Badge */}
      {tierStatus && (
        <View style={[
          styles.currentTierBadge,
          { 
            backgroundColor: tierStatus.isPremium ? tokens.primary : tokens.textMuted,
          }
        ]}>
          <Ionicons 
            name={tierStatus.isPremium ? "star" : "person"} 
            size={16} 
            color="#fff" 
          />
          <Text style={styles.currentTierText}>
            Your current plan: {tierStatus.tier === 'premium_monthly' ? 'Premium Monthly' : tierStatus.tier === 'premium_yearly' ? 'Premium Yearly' : 'Free'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingText: {
    textAlign: 'center',
    marginTop: 20,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 24,
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 16,
  },
  tierHeaders: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  tierHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  section: {
    marginTop: 16,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 12,
  },
  benefitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  featureName: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  tierColumns: {
    flexDirection: 'row',
    flex: 1,
  },
  tierColumn: {
    flex: 1,
    alignItems: 'center',
  },
  tierValue: {
    fontSize: 14,
    fontFamily: 'SpaceGrotesk_500Medium',
    textAlign: 'center',
  },
  note: {
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_400Regular',
    fontStyle: 'italic',
    marginTop: 4,
  },
  currentTierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    margin: 16,
    borderRadius: 8,
    gap: 8,
  },
  currentTierText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'SpaceGrotesk_600SemiBold',
  },
});
