import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/src/shared/api/client';
import { PageMark } from '@/components/PageMark';
import { AnimatedInput } from '@/components/AnimatedInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { AuthScreenEntrance, ErrorShake, SuccessRedirect } from '@/components/animations';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorTrigger, setErrorTrigger] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const validate = useCallback(() => {
    if (!identifier.trim()) return t('forgot_password.errors.identifier_required');
    return null;
  }, [identifier, t]);

  const handleSubmit = useCallback(async () => {
    setFormError(null);
    const err = validate();
    if (err) {
      setFormError(err);
      setErrorTrigger(true);
      setTimeout(() => setErrorTrigger(false), 600);
      return;
    }

    setLoading(true);
    try {
      const isEmail = identifier.includes('@');
      const body: Record<string, string> = isEmail
        ? { email: identifier.trim() }
        : { phone: identifier.trim() };

      const res = await apiFetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(typeof data?.detail === 'string' ? data.detail : t('forgot_password.errors.send_failed'));
        setErrorTrigger(true);
        setTimeout(() => setErrorTrigger(false), 600);
        return;
      }

      const data = await res.json();
      setSuccess(true);
      router.replace({ pathname: '/forgot-password-otp', params: { identifier: identifier.trim() } });
    } catch {
      setFormError(t('forgot_password.errors.connection_error'));
      setErrorTrigger(true);
      setTimeout(() => setErrorTrigger(false), 600);
    } finally {
      setLoading(false);
    }
  }, [identifier, router, validate, t]);

  return (
    <View style={[styles.root, { backgroundColor: tokens.paper }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <SuccessRedirect visible={success} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SafeAreaView edges={['top', 'bottom']}>
            <ErrorShake trigger={errorTrigger}>
              <View style={styles.cardWrap}>
                <View style={[styles.card, { backgroundColor: tokens.card }]}>
                  <AuthScreenEntrance
                    title={t('forgot_password.title')}
                    subtitle={t('forgot_password.subtitle')}
                  />

                  {formError ? (
                    <View
                      style={[
                        styles.banner,
                        { backgroundColor: tokens.signalSoft, borderColor: tokens.signal },
                      ]}
                    >
                      <Text style={[styles.bannerText, { color: tokens.signal }]}>
                        {formError}
                      </Text>
                    </View>
                  ) : null}

                  <View style={{ gap: 14 }}>
                    <AnimatedInput
                      label={t('forgot_password.identifier_label')}
                      value={identifier}
                      onChangeText={setIdentifier}
                      placeholder={t('forgot_password.identifier_placeholder')}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      textContentType="username"
                      returnKeyType="go"
                      onSubmitEditing={handleSubmit}
                    />
                  </View>

                  <PrimaryButton
                    title={loading ? t('forgot_password.sending') : t('forgot_password.send_button')}
                    onPress={handleSubmit}
                    disabled={loading}
                  />

                  <View style={styles.tertiaryRow}>
                    <Text style={[styles.tertiaryMuted, { color: tokens.inkMuted }]}>
                      {t('forgot_password.remember')}
                    </Text>
                    <Pressable onPress={() => router.back()} hitSlop={6}>
                      <Text style={[styles.tertiaryLink, { color: tokens.mint }]}>
                        {t('forgot_password.back_to_signin')}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </ErrorShake>
          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  cardWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    borderRadius: 20,
    padding: 24,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  banner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginTop: 4,
  },
  bannerText: {
    fontSize: 13,
    lineHeight: 18,
  },
  tertiaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  tertiaryMuted: {
    fontSize: 14,
  },
  tertiaryLink: {
    fontSize: 14,
    fontWeight: '600',
  },
});
