/**
 * Phase 5: Premium Upsell Card Component
 * 
 * Contextual upsell cards shown to free users
 * Highlights specific benefits relevant to current screen
 */

import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useUserTier } from '@/src/shared/hooks/useTierBenefits';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

interface Props {
  context: 'reading' | 'ads' | 'tasks' | 'daily' | 'bills' | 'study';
  onPress?: () => void;
}

const contextMessages = {
  reading: {
    icon: 'book',
    title: 'Earn 2x Reading Points',
    subtitle: 'Premium users earn 4 points per slice instead of 2',
  },
  ads: {
    icon: 'tv',
    title: 'Earn 1.5x Ad Rewards',
    subtitle: 'Get 30 points per ad (vs 20) and skip ads on novels',
  },
  tasks: {
    icon: 'checkmark-circle',
    title: 'Earn 2x Task Rewards',
    subtitle: 'Double your points on every task completion',
  },
  daily: {
    icon: 'gift',
    title: 'Earn 2x Daily Rewards',
    subtitle: 'Double your daily login streak bonuses',
  },
  bills: {
    icon: 'wallet',
    title: 'Earn 2x Bills Cashback',
    subtitle: 'Double your cashback on airtime, data, and bills',
  },
  study: {
    icon: 'school',
    title: 'Free Study Material Access',
    subtitle: 'Unlock all study materials and skip unit progression',
  },
};

export function PremiumUpsellCard({ context, onPress }: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const router = useRouter();
  const { tierStatus } = useUserTier();

  // Don't show to premium users
  if (tierStatus?.isPremium) {
    return null;
  }

  const message = contextMessages[context];

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      router.push('/premium');
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: tokens.primaryFaint || `${tokens.primary}15`,
          borderColor: tokens.primary,
          opacity: pressed ? 0.8 : 1,
        }
      ]}
    >
      <View style={styles.iconContainer}>
        <View style={[styles.iconCircle, { backgroundColor: tokens.primary }]}>
          <Ionicons name={message.icon as any} size={24} color="#fff" />
        </View>
      </View>
      
      <View style={styles.content}>
        <View style={styles.textContent}>
          <Text style={[styles.title, { color: tokens.ink }]}>
            {message.title}
          </Text>
          <Text style={[styles.subtitle, { color: tokens.textMuted }]}>
            {message.subtitle}
          </Text>
        </View>
        
        <View style={styles.ctaContainer}>
          <Text style={[styles.ctaText, { color: tokens.primary }]}>
            Upgrade
          </Text>
          <Ionicons name="arrow-forward" size={16} color={tokens.primary} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 8,
    marginHorizontal: 16,
    gap: 12,
  },
  iconContainer: {
    justifyContent: 'center',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: 8,
  },
  textContent: {
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  subtitle: {
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_400Regular',
    lineHeight: 18,
  },
  ctaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ctaText: {
    fontSize: 14,
    fontFamily: 'SpaceGrotesk_600SemiBold',
  },
});
