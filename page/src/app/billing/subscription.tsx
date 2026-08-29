import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { useCurrentUser } from '@/src/shared/lib/current-user';

export default function SubscriptionManagementScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const router = useRouter();

  // Read the user from the global store — loaded once at app start.
  const user = useCurrentUser();

  const isStudyPlusMonthly = user?.tier === 'study_plus_monthly';
  const isStudyPlusYearly = user?.tier === 'study_plus_yearly';
  const isCompletePlusMonthly = user?.tier === 'complete_plus_monthly';
  const isCompletePlusYearly = user?.tier === 'complete_plus_yearly';
  const isPremium = isStudyPlusMonthly || isStudyPlusYearly || isCompletePlusMonthly || isCompletePlusYearly;

  const handleManageSubscription = () => {
    // Open device subscription settings
    Alert.alert(
      t('subscription.alert_title'),
      t('subscription.alert_message'),
      [
        { text: t('subscription.alert_cancel'), style: 'cancel' },
        {
          text: t('subscription.alert_open'),
          onPress: () => {
            if (require('react-native').Platform.OS === 'ios') {
              Linking.openURL('itms-apps://apps.apple.com/account/subscriptions');
            } else {
              Linking.openURL('https://play.google.com/store/account/subscriptions');
            }
          },
        },
      ]
    );
  };

  const handleUpgrade = () => {
    router.push('/premium');
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tokens.paper }]}>
      <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
        {t('subscription.title')}
      </Text>

      <View style={styles.content}>
        {/* Current Plan */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.planHeader}>
            <Ionicons name="diamond" size={24} color={tokens.mint} />
            <Text style={[styles.planTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              {t('subscription.current_plan')}
            </Text>
          </View>
          
          <View style={[styles.planBadge, { backgroundColor: isPremium ? tokens.mint : tokens.inkMuted }]}>
            <Text style={[styles.planText, { color: tokens.mintText }]}>
              {isStudyPlusMonthly ? t('subscription.study_plus_monthly') : isStudyPlusYearly ? t('subscription.study_plus_yearly') : isCompletePlusMonthly ? t('subscription.complete_plus_monthly') : isCompletePlusYearly ? t('subscription.complete_plus_yearly') : t('subscription.free')}
            </Text>
          </View>

          {isPremium && (
            <View style={styles.benefits}>
              <BenefitRow icon="checkmark-circle" text={t('subscription.benefit_unlocks')} tokens={tokens} />
              <BenefitRow icon="checkmark-circle" text={t('subscription.benefit_ad_free')} tokens={tokens} />
              <BenefitRow icon="checkmark-circle" text={t('subscription.benefit_support')} tokens={tokens} />
            </View>
          )}
        </View>

        {/* Actions */}
        {isPremium ? (
          <>
            <Pressable
              onPress={handleManageSubscription}
              style={[styles.button, { backgroundColor: tokens.mint }]}
            >
              <Text style={[styles.buttonText, { color: tokens.mintText }]}>{t('subscription.manage')}</Text>
            </Pressable>

            <Pressable
              onPress={handleUpgrade}
              style={[styles.buttonOutline, { borderColor: tokens.border }]}
            >
              <Text style={[styles.buttonOutlineText, { color: tokens.ink }]}>
                {isPremiumMonthly ? t('subscription.upgrade_yearly') : t('subscription.view_plans')}
              </Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={handleUpgrade}
            style={[styles.button, { backgroundColor: tokens.mint }]}
          >
            <Text style={[styles.buttonText, { color: tokens.mintText }]}>{t('subscription.upgrade')}</Text>
          </Pressable>
        )}

        {/* Info */}
        <View style={[styles.infoCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Ionicons name="information-circle-outline" size={20} color={tokens.inkMuted} />
          <Text style={[styles.infoText, { color: tokens.inkMuted }]}>
            {t('subscription.info')}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function BenefitRow({ icon, text, tokens }: { icon: any; text: string; tokens: any }) {
  return (
    <View style={styles.benefitRow}>
      <Ionicons name={icon} size={18} color={tokens.mint} />
      <Text style={[styles.benefitText, { color: tokens.ink }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  content: {
    flex: 1,
    padding: 20,
    gap: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  planTitle: {
    fontSize: 20,
    letterSpacing: -0.3,
  },
  planBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  planText: {
    fontSize: 15,
    fontWeight: '700',
  },
  benefits: {
    gap: 12,
    paddingTop: 8,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  benefitText: {
    fontSize: 15,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  buttonOutline: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  buttonOutlineText: {
    fontSize: 16,
    fontWeight: '600',
  },
  infoCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 'auto',
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
