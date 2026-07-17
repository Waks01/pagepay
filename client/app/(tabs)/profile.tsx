import { useCallback, useState, useEffect } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PLATFORM_ENV } from '@/src/shared/lib/ads';
import {
  displayName,
  initials,
} from '@/src/shared/lib/display-name';
import {
  persistLanguage,
  persistTheme,
  usePreferences,
  type LanguagePref,
  type ThemePref,
} from '@/src/shared/lib/preferences';
import { clearToken } from '@/src/shared/lib/storage';
import { useBiometricAuth } from '@/src/shared/hooks/use-biometric-auth';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';
import { PageMark } from '@/components/PageMark';
import { Skeleton } from '@/components/Skeleton';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import {
  LinkPayoutAccountModal,
  PayoutAccount,
} from '@/components/LinkPayoutAccountModal';
import { HelpModal } from '@/components/HelpModal';
import { AboutModal } from '@/components/AboutModal';
import { NotificationSettingsModal } from '@/components/NotificationSettingsModal';
import { useReferralStats, useGenerateReferral } from '@/src/features/community/hooks/use-community';
import { NativeAdBanner } from '@/components/ads/NativeAdBanner';
import { ErrorBoundary } from '@/components/ErrorBoundary';

type UserMe = {
  id: number;
  email: string | null;
  phone: string | null;
  points_balance: number;
  tier: string;
  is_worker: boolean;
  is_sponsor: boolean;
};

const languageOptions: { value: LanguagePref; label: string; available: boolean }[] = [
  { value: 'en', label: 'English', available: true },
  { value: 'pcm', label: 'Pidgin', available: true },
  { value: 'yo', label: 'Yoruba', available: true },
  { value: 'ha', label: 'Hausa', available: true },
  { value: 'ig', label: 'Igbo', available: true },
];

const themeOptions: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'sepia', label: 'Sepia' },
];

export default function ProfileScreen() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const theme = usePreferences((s) => s.theme);
  const setTheme = usePreferences((s) => s.setTheme);
  const language = usePreferences((s) => s.language);
  const setLanguage = usePreferences((s) => s.setLanguage);
  const biometricEnabled = usePreferences((s) => s.biometricEnabled);
  const setBiometricEnabled = usePreferences((s) => s.setBiometricEnabled);
  const { isSupported, isEnrolled, authenticate } = useBiometricAuth();

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showPayout, setShowPayout] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  // Fetch ad config for native unit
  const [nativeAdUnit, setNativeAdUnit] = useState('');
  const { data: adConfig } = useQuery({
    queryKey: ['ads-config'],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/config/ads?env=${PLATFORM_ENV}`);
      if (!res.ok) return {};
      return (await res.json()) as Record<string, string>;
    },
  });

  useEffect(() => {
    if (adConfig) {
      const platform = Platform.OS;
      const unitKey = platform === 'android' ? 'in_feed_android' : 'in_feed_ios';
      setNativeAdUnit(adConfig[unitKey] || '');
    }
  }, [adConfig]);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) throw new Error('Failed to load profile');
      return (await res.json()) as UserMe;
    },
  });

  const payoutQuery = useQuery({
    queryKey: ['payout', 'account'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/payouts/account');
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to load payout account');
      return (await res.json()) as PayoutAccount;
    },
    staleTime: 30_000,
  });

  const pinStatusQuery = useQuery({
    queryKey: ['pin', 'status'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/pin/status');
      if (!res.ok) throw new Error('Failed to load PIN status');
      return (await res.json()) as { has_pin: boolean };
    },
  });

  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ['pin', 'status'] });
    }, [qc]),
  );

  const getTierLabel = (tier: string) => {
    const key = tier as 'free' | 'premium_monthly' | 'premium_yearly';
    return t(`profile.tier.${key}`, { defaultValue: tier });
  };

  const handleThemeChange = useCallback(
    (next: ThemePref) => {
      setTheme(next);
      // Fire-and-forget; persistence failure shouldn't crash the UI.
      void persistTheme(next);
    },
    [setTheme],
  );

  const handleLanguageChange = useCallback(
    async (next: LanguagePref) => {
      const opt = languageOptions.find((o) => o.value === next);
      if (!opt?.available) {
        Alert.alert(t('profile.coming_soon'), t('profile.coming_soon_message', { language: opt?.label ?? 'That language' }));
        return;
      }
      
      // Change language using i18n
      try {
        const i18n = await import('@/src/lib/i18n');
        await i18n.default.changeLanguage(next);
        setLanguage(next);
        void persistLanguage(next);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        Alert.alert(t('common.error'), t('profile.language_error'));
      }
    },
    [setLanguage, t],
  );

  const handleNotifications = useCallback(() => {
    setShowNotifications(true);
  }, []);

  const handleBiometricToggle = useCallback(
    async (next: boolean) => {
      if (next && (!isSupported || !isEnrolled)) {
        Alert.alert(
          t('profile.biometric.unavailable_title', { defaultValue: 'Biometric Unavailable' }),
          t('profile.biometric.unavailable_message', { defaultValue: 'Biometric authentication is not set up on this device. Please add a fingerprint or face recognition in your device settings first.' }),
        );
        return;
      }

      if (next && !pinStatusQuery.data?.has_pin) {
        Alert.alert(
          t('profile.pin.required_title', { defaultValue: 'Set Transaction PIN First' }),
          t('profile.pin.required_message', { defaultValue: 'You must set a transaction PIN before enabling biometric login. This PIN will also be used as fallback if biometric fails.' }),
          [
            { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
            {
              text: t('profile.pin.setup_button', { defaultValue: 'Set PIN' }),
              onPress: () => router.push('/pin/setup'),
            },
          ],
        );
        return;
      }

      if (next) {
        const result = await authenticate();
        if (!result.success) {
          Alert.alert(
            t('profile.biometric.failed_title', { defaultValue: 'Authentication Failed' }),
            result.error || t('profile.biometric.failed_message', { defaultValue: 'Biometric authentication failed. Please try again.' }),
          );
          return;
        }
      }

      setBiometricEnabled(next);
      await import('@/src/shared/lib/preferences').then((m) =>
        m.persistBiometricEnabled(next),
      );
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      if (next) {
        Alert.alert(
          t('profile.biometric.success_title', { defaultValue: 'Biometric Enabled' }),
          t('profile.biometric.success_message', { defaultValue: 'You can now use biometric to sign in.' }),
        );
      }
    },
    [isSupported, isEnrolled, authenticate, setBiometricEnabled, pinStatusQuery.data, router, t],
  );

  const handleSignOut = useCallback(async () => {
    // Best-effort server-side logout. We don't block UI on it — the
    // real "logout" is clearing local auth state. If the call fails we
    // still want to drop the token and route the user to login.
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Network error is fine here — the local token clear is what
      // actually protects the user.
    }

    const { clearToken } = await import('@/src/shared/lib/storage');
    const biometric = usePreferences.getState().biometricEnabled;
    await clearToken(!biometric);

    qc.clear();
    router.replace('/(auth)/');
  }, [qc, router]);

  const version =
    (Constants.expoConfig?.version as string | undefined) ||
    ((Constants.manifest as { version?: string } | undefined)?.version as string | undefined) ||
    '1.0.0';
  const platformLabel = scheme === 'dark' ? t('profile.appearance.theme_dark') : t('profile.appearance.theme_light');

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tokens.paper }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ── Header ───────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: tokens.mintSoft, borderColor: tokens.border }]}>
            <Text style={[styles.avatarText, { color: tokens.mint, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              {initials(meQuery.data)}
            </Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={[styles.displayName, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              {displayName(meQuery.data)}
            </Text>
            <Text style={[styles.identifier, { color: tokens.inkMuted }]}>
              {meQuery.data?.email || meQuery.data?.phone || t('profile.no_contact')}
            </Text>
            <View style={styles.tierRow}>
              <Text style={[styles.tier, { color: tokens.mint }]}>
                {getTierLabel(meQuery.data?.tier ?? 'free')}
              </Text>
              {meQuery.data?.tier && meQuery.data.tier !== 'free' && (
                <View style={[styles.premiumBadge, { backgroundColor: tokens.mint }]}>
                  <Ionicons name="diamond" size={10} color={tokens.mintText} />
                  <Text style={[styles.premiumLabel, { color: tokens.mintText }]}>{t('profile.premium_badge')}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Phase 7 Roles ───────────────────────────────────── */}
        <Text style={[styles.section, { color: tokens.inkMuted }]}>{t('profile.sections.roles')}</Text>
        <View style={{ gap: 10 }}>
          <Pressable
            onPress={() => router.push('/(tabs)/tasks')}
            style={({ pressed }) => [
              styles.roleCard,
              { backgroundColor: tokens.card, borderColor: tokens.border, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={[styles.roleIcon, { backgroundColor: tokens.mintSoft }]}>
              <Ionicons name="briefcase-outline" size={20} color={tokens.mint} />
            </View>
            <View style={styles.roleInfo}>
              <Text style={[styles.roleTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                {t('profile.roles.tasks_title')}
              </Text>
              <Text style={[styles.roleSubtitle, { color: tokens.inkMuted }]}>
                {t('profile.roles.tasks_subtitle')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={tokens.inkMuted} />
          </Pressable>

          {!meQuery.data?.is_sponsor && (
            <Pressable
              onPress={() => router.push('/sponsor/register')}
              style={({ pressed }) => [
                styles.roleCard,
                { backgroundColor: tokens.card, borderColor: tokens.mint, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={[styles.roleIcon, { backgroundColor: tokens.mintSoft }]}>
                <Ionicons name="add-circle-outline" size={20} color={tokens.mint} />
              </View>
              <View style={styles.roleInfo}>
                <Text style={[styles.roleTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                  {t('profile.roles.become_sponsor')}
                </Text>
                <Text style={[styles.roleSubtitle, { color: tokens.inkMuted }]}>
                  {t('profile.roles.become_sponsor_subtitle')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={tokens.mint} />
            </Pressable>
          )}

          {meQuery.data?.is_sponsor && (
            <Pressable
              onPress={() => router.push('/sponsor/dashboard')}
              style={({ pressed }) => [
                styles.roleCard,
                { backgroundColor: tokens.card, borderColor: tokens.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={[styles.roleIcon, { backgroundColor: tokens.mintSoft }]}>
                <Ionicons name="planet-outline" size={20} color={tokens.mint} />
              </View>
              <View style={styles.roleInfo}>
                <Text style={[styles.roleTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                  {t('profile.roles.sponsor_dashboard')}
                </Text>
                <Text style={[styles.roleSubtitle, { color: tokens.inkMuted }]}>
                  {t('profile.roles.sponsor_dashboard_subtitle')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={tokens.inkMuted} />
            </Pressable>
          )}
        </View>

        {/* ── Payout account ───────────────────────────────────── */}
        <ErrorBoundary
          fallback={
            <View style={[styles.payoutCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <View style={styles.payoutInner}>
                <View style={[styles.payoutIcon, { backgroundColor: tokens.signalSoft }]}>
                  <Ionicons name="alert-circle-outline" size={18} color={tokens.signal} />
                </View>
                <View style={styles.payoutInfo}>
                  <Text style={[styles.payoutBank, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                    {t('profile.payout.error')}
                  </Text>
                  <Text style={[styles.payoutHint, { color: tokens.inkMuted }]}>
                    {t('profile.payout.error_hint')}
                  </Text>
                </View>
              </View>
            </View>
          }
        >
          <Text style={[styles.section, { color: tokens.inkMuted }]}>{t('profile.sections.payout_account')}</Text>
          <View style={[styles.payoutCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            {payoutQuery.isLoading ? (
              <View style={{ gap: 8, padding: 4 }}>
                <Skeleton height={16} width="70%" borderRadius={6} />
                <Skeleton height={14} width="50%" borderRadius={6} />
              </View>
            ) : payoutQuery.data ? (
              <View style={styles.payoutInner}>
                <View style={[styles.payoutIcon, { backgroundColor: tokens.mintSoft }]}>
                  <Ionicons name="business" size={18} color={tokens.mint} />
                </View>
                <View style={styles.payoutInfo}>
                  <Text style={[styles.payoutBank, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                    {payoutQuery.data.bank_name} ···{payoutQuery.data.account_number_last4}
                  </Text>
                  <View style={styles.verifyRow}>
                    {payoutQuery.data.verified ? (
                      <>
                        <Ionicons name="checkmark-circle" size={14} color={tokens.mint} />
                        <Text style={[styles.verifyText, { color: tokens.mint }]}>{t('profile.payout.verified')}</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="hourglass-outline" size={14} color={tokens.signal} />
                        <Text style={[styles.verifyText, { color: tokens.signal }]}>{t('profile.payout.pending')}</Text>
                      </>
                    )}
                  </View>
                  {payoutQuery.data.account_name ? (
                    <Text style={[styles.accountName, { color: tokens.inkMuted }]}>
                      {payoutQuery.data.account_name}
                    </Text>
                  ) : null}
                  <Text style={[styles.accountName, { color: tokens.inkMuted }]}>
                    {t('profile.payout.min_withdrawal')}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setShowPayout(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={[styles.change, { color: tokens.mint }]}>{t('profile.payout.change')}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.payoutInner}>
                <View style={[styles.payoutIcon, { backgroundColor: tokens.signalSoft }]}>
                  <Ionicons name="business-outline" size={18} color={tokens.signal} />
                </View>
                <View style={styles.payoutInfo}>
                  <Text style={[styles.payoutBank, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                    {t('profile.payout.no_account')}
                  </Text>
                  <Text style={[styles.payoutHint, { color: tokens.inkMuted }]}>
                    {t('profile.payout.no_account_hint')}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setShowPayout(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={[styles.change, { color: tokens.mint }]}>{t('profile.payout.link')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </ErrorBoundary>

        {/* ── Referral ──────────────────────────────────────────── */}
        <ErrorBoundary
          fallback={
            <View style={[styles.referralCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <View style={styles.referralHeader}>
                <Ionicons name="alert-circle-outline" size={20} color={tokens.signal} />
                <Text style={[styles.referralTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                  {t('profile.referral.unavailable')}
                </Text>
              </View>
              <Text style={[styles.referralSubtitle, { color: tokens.inkMuted }]}>
                {t('profile.referral.unavailable_hint')}
              </Text>
            </View>
          }
        >
          <ReferralSection tokens={tokens} />
        </ErrorBoundary>

        {/* ── Native ad after stats ─────────────────────────────── */}
        <ErrorBoundary fallback={null}>
          {nativeAdUnit && (
            <NativeAdBanner
              adUnit={nativeAdUnit}
              sessionId={null}
            />
          )}
        </ErrorBoundary>

        {/* ── Settings rows ────────────────────────────────────── */}
        <Text style={[styles.section, { color: tokens.inkMuted }]}>{t('profile.sections.account')}</Text>
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Row
            tokens={tokens}
            icon="lock-closed-outline"
            label={t('profile.account.change_password')}
            onPress={() => setShowChangePassword(true)}
          />
          <Divider tokens={tokens} />
          <Row
            tokens={tokens}
            icon="receipt-outline"
            label={t('profile.account.billing_history')}
            onPress={() => router.push('/billing/history')}
          />
          {meQuery.data?.tier && meQuery.data.tier !== 'free' && (
            <>
              <Divider tokens={tokens} />
              <Row
                tokens={tokens}
                icon="card-outline"
                label={t('profile.account.manage_subscription')}
                onPress={() => router.push('/billing/subscription')}
              />
            </>
          )}
          <Divider tokens={tokens} />
          <Row
            tokens={tokens}
            icon="notifications-outline"
            label={t('profile.account.notifications')}
            onPress={handleNotifications}
          />
          <Divider tokens={tokens} />
          <Row
            tokens={tokens}
            icon="finger-print-outline"
            label={t('profile.biometric.title', { defaultValue: 'Biometric Login' })}
            trailing={
              <Switch
                value={biometricEnabled}
                onValueChange={handleBiometricToggle}
                trackColor={{ false: tokens.border, true: tokens.mint }}
                thumbColor={biometricEnabled ? tokens.mintText : tokens.inkMuted}
              />
            }
          />
          <Divider tokens={tokens} />
          <Row
            tokens={tokens}
            icon="key-outline"
            label={t('profile.pin.title', { defaultValue: 'Transaction PIN' })}
            trailing={
              <Text style={[styles.rowTrailing, { color: tokens.inkMuted }]}>
                {pinStatusQuery.data?.has_pin
                  ? t('profile.pin.set', { defaultValue: 'Set' })
                  : t('profile.pin.not_set', { defaultValue: 'Not set' })}
              </Text>
            }
            onPress={() => router.push(pinStatusQuery.data?.has_pin ? '/pin/change' : '/pin/setup')}
          />
        </View>

        <Text style={[styles.section, { color: tokens.inkMuted }]}>{t('profile.sections.appearance')}</Text>
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="sunny-outline" size={18} color={tokens.inkMuted} />
              <Text style={[styles.rowLabel, { color: tokens.ink }]}>{t('profile.appearance.theme')}</Text>
            </View>
          </View>
          <View style={[styles.segmented, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
            {themeOptions.map((opt) => {
              const active = theme === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => handleThemeChange(opt.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.segment,
                    {
                      backgroundColor: active ? tokens.mint : 'transparent',
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentLabel,
                      {
                        color: active ? tokens.mintText : tokens.ink,
                        fontFamily: active ? 'SpaceGrotesk_700Bold' : 'SpaceGrotesk_500Medium',
                      },
                    ]}
                  >
                    {t(`profile.appearance.theme_${opt.value}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Divider tokens={tokens} />

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="language-outline" size={18} color={tokens.inkMuted} />
              <Text style={[styles.rowLabel, { color: tokens.ink }]}>{t('profile.appearance.language')}</Text>
            </View>
          </View>
          <View style={[styles.langGrid, { borderColor: tokens.border }]}>
            {languageOptions.map((opt) => {
              const active = language === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => handleLanguageChange(opt.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.langPill,
                    {
                      backgroundColor: active ? tokens.mint : tokens.paper,
                      borderColor: tokens.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.langLabel,
                      {
                        color: active ? tokens.mintText : tokens.ink,
                        fontFamily: active ? 'SpaceGrotesk_700Bold' : 'SpaceGrotesk_500Medium',
                      },
                    ]}
                  >
                    {t(`profile.appearance.language_${opt.label.toLowerCase()}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={[styles.section, { color: tokens.inkMuted }]}>{t('profile.sections.support')}</Text>
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Row
            tokens={tokens}
            icon="help-circle-outline"
            label={t('profile.support.help')}
            onPress={() => setShowHelp(true)}
          />
          <Divider tokens={tokens} />
          <Row
            tokens={tokens}
            icon="information-circle-outline"
            label={t('profile.support.about')}
            trailing={<Text style={[styles.trailingHint, { color: tokens.inkMuted }]}>v{version}</Text>}
            onPress={() => setShowAbout(true)}
          />
        </View>

        {/* ── Sign out ─────────────────────────────────────────── */}
        <Pressable
          onPress={handleSignOut}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.signOut,
            {
              backgroundColor: tokens.signalSoft,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="log-out-outline" size={18} color={tokens.signal} />
          <Text style={[styles.signOutText, { color: tokens.signal, fontFamily: 'SpaceGrotesk_700Bold' }]}>
            {t('profile.sign_out')}
          </Text>
        </Pressable>

        {/* ── Footer ───────────────────────────────────────────── */}
        <View style={styles.footer}>
          <PageMark />
          <Text style={[styles.footerText, { color: tokens.inkMuted }]}>
            {t('profile.footer', { version, theme: platformLabel })}
          </Text>
        </View>
      </ScrollView>

      <ChangePasswordModal
        visible={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
      <LinkPayoutAccountModal
        visible={showPayout}
        current={payoutQuery.data ?? null}
        onClose={() => setShowPayout(false)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ['payout', 'account'] });
          void qc.invalidateQueries({ queryKey: ['me'] });
        }}
      />
      <HelpModal visible={showHelp} onClose={() => setShowHelp(false)} />
      <AboutModal visible={showAbout} onClose={() => setShowAbout(false)} />
      <NotificationSettingsModal visible={showNotifications} onClose={() => setShowNotifications(false)} />
    </SafeAreaView>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function Row({
  tokens,
  icon,
  label,
  trailing,
  onPress,
}: {
  tokens: (typeof PagePay)['light'] | (typeof PagePay)['dark'];
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  trailing?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={18} color={tokens.inkMuted} />
        <Text style={[styles.rowLabel, { color: tokens.ink }]}>{label}</Text>
      </View>
      <View style={styles.rowRight}>
        {trailing}
        <Ionicons name="chevron-forward" size={18} color={tokens.inkMuted} />
      </View>
    </Pressable>
  );
}

function Divider({
  tokens,
}: {
  tokens: (typeof PagePay)['light'] | (typeof PagePay)['dark'];
}) {
  return <View style={[styles.divider, { backgroundColor: tokens.border }]} />;
}

function ReferralSection({ tokens }: { tokens: (typeof PagePay)['light'] | (typeof PagePay)['dark'] }) {
  const statsQ = useReferralStats();
  const generateMutation = useGenerateReferral();
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Socket.IO real-time updates
  useEffect(() => {
    const queryData = queryClient.getQueryData(['me']) as { data: { id: number } } | undefined;
    const user = queryData?.data;
    if (!user?.id) return;

    // Import socket functions dynamically
    import('@/src/lib/socket').then(({ connectSocket, onReferralUpdate, offReferralUpdate }) => {
      connectSocket(user.id);

      const handleUpdate = (stats: any) => {
        // Update cache with new stats
        queryClient.setQueryData(['referral', 'stats'], stats);
      };

      onReferralUpdate(handleUpdate);

      return () => {
        offReferralUpdate(handleUpdate);
      };
    });
  }, [queryClient]);

  const stats = statsQ.data as { code: string; signups: number; pending_rewards: number; claimed_rewards: number } | undefined;
  const code = stats?.code ?? '';
  const link = code ? `https://pagepay.app/ref/${code}` : '';

  const handleGenerate = async () => {
    try {
      await generateMutation.mutateAsync();
    } catch {
      // silent
    }
  };

  const handleShare = async () => {
    if (!link) return;
    
    try {
      const message = t('profile.referral.share_message', { code, link });
      
      const result = await Share.share({
        message,
        url: link, // iOS uses this
        title: t('profile.referral.share_title'),
      });

      if (result.action === Share.sharedAction) {
        // User shared successfully
        if (Platform.OS === 'ios') {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (error) {
      // Fallback to Alert if share fails
      Alert.alert(t('profile.referral.share_title'), link);
    }
  };

  const handleCopy = async () => {
    if (!link) return;
    
    try {
      await Clipboard.setStringAsync(link);
      setCopied(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // Silent fail - user can still manually copy from display
      setCopied(false);
    }
  };

  return (
    <View style={[styles.referralCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <View style={styles.referralHeader}>
        <Ionicons name="gift-outline" size={20} color={tokens.mint} />
        <Text style={[styles.referralTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
          {t('profile.referral.title')}
        </Text>
      </View>
      <Text style={[styles.referralSubtitle, { color: tokens.inkMuted }]}>
        {t('profile.referral.subtitle')}
      </Text>

      {code ? (
        <View style={[styles.codeBox, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
          <Text style={[styles.codeText, { color: tokens.mint, fontFamily: 'SpaceGrotesk_700Bold' }]}>
            {code}
          </Text>
        </View>
      ) : (
        <TouchableOpacity
          onPress={handleGenerate}
          disabled={generateMutation.isPending}
          style={[styles.generateBtn, { backgroundColor: tokens.mint }]}
          activeOpacity={0.7}
        >
          <Text style={[styles.generateText, { color: tokens.mintText }]}>
            {generateMutation.isPending ? t('profile.referral.generating') : t('profile.referral.generate')}
          </Text>
        </TouchableOpacity>
      )}

      {code && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TouchableOpacity
            onPress={handleCopy}
            style={[styles.actionBtn, { borderColor: tokens.border }]}
            activeOpacity={0.7}
          >
            <Ionicons name={copied ? 'checkmark-outline' : 'copy-outline'} size={16} color={tokens.mint} />
            <Text style={[styles.actionText, { color: tokens.mint }]}>
              {copied ? t('profile.referral.copied') : t('profile.referral.copy')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShare}
            style={[styles.actionBtn, { borderColor: tokens.border }]}
            activeOpacity={0.7}
          >
            <Ionicons name="share-social-outline" size={16} color={tokens.mint} />
            <Text style={[styles.actionText, { color: tokens.mint }]}>{t('profile.referral.share')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {stats && (
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: tokens.ink }]}>{stats.signups}</Text>
            <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('profile.referral.stats_signups')}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: tokens.ink }]}>{stats.pending_rewards}</Text>
            <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('profile.referral.stats_pending')}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: tokens.mint }]}>{stats.claimed_rewards}</Text>
            <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('profile.referral.stats_claimed')}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 48,
    gap: 14,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 12,
    gap: 16,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 24,
    letterSpacing: 0.5,
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  displayName: {
    fontSize: 22,
    letterSpacing: -0.3,
  },
  identifier: {
    fontSize: 13,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  tier: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 10,
  },
  premiumLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // Section header
  section: {
    fontSize: 11,
    letterSpacing: 1.0,
    fontWeight: '600',
    marginTop: 6,
    marginLeft: 4,
  },
  // Role cards
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  roleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleInfo: {
    flex: 1,
    gap: 2,
  },
  roleTitle: {
    fontSize: 15,
  },
  roleSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  // Payout card
  payoutCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  payoutInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  payoutIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payoutInfo: {
    flex: 1,
    gap: 4,
  },
  payoutBank: {
    fontSize: 15,
  },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifyText: {
    fontSize: 12,
    fontWeight: '600',
  },
  accountName: {
    fontSize: 12,
  },
  payoutHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  change: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Generic card + row
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 52,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowTrailing: {
    fontSize: 13,
    fontWeight: '500',
  },
  trailingHint: {
    fontSize: 13,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 46,
  },
  // Theme segmented
  segmented: {
    flexDirection: 'row',
    margin: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLabel: {
    fontSize: 12,
  },
  // Language grid
  langGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
  },
  langPill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  langLabel: {
    fontSize: 13,
  },
  // Sign out
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 18,
  },
  signOutText: {
    fontSize: 15,
  },
  // Footer
  footer: {
    alignItems: 'center',
    paddingTop: 18,
    gap: 6,
  },
  footerText: {
    fontSize: 12,
    letterSpacing: 0.2,
  },
  // Referral
  referralCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  referralHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  referralTitle: {
    fontSize: 16,
  },
  referralSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  codeBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    alignItems: 'center',
  },
  codeText: {
    fontSize: 20,
    letterSpacing: 2,
  },
  generateBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  generateText: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
    marginTop: 4,
  },
  stat: {
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
  },
});
