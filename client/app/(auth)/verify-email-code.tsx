import { useCallback, useEffect, useState } from 'react';
import {
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { OtpInput } from '@/components/OtpInput';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';

const OTP_LENGTH = 6;

export default function VerifyEmailCodeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email;
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const handleSubmit = useCallback(
    async (fullCode: string) => {
      if (!email || fullCode.length !== OTP_LENGTH) return;
      setVerifying(true);
      setError(null);
      setMessage(null);
      try {
        const res = await apiFetch('/api/v1/auth/verify-email-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code: fullCode }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const detail =
            typeof data?.detail === 'string'
              ? data.detail
              : t('verify_email.error_generic');
          setError(detail);
        } else {
          setMessage(t('verify_email.success'));
          setTimeout(() => router.replace('/(tabs)'), 1200);
        }
      } catch {
        setError(t('verify_email.error_connection'));
      } finally {
        setVerifying(false);
      }
    },
    [email, router, t]
  );

  const handleResend = useCallback(async () => {
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch('/api/v1/auth/resend-verification', {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data?.detail === 'string'
            ? data.detail
            : t('verify_email.resend_error')
        );
      } else {
        setMessage(t('verify_email.resend_success'));
      }
    } catch {
      setError(t('verify_email.error_connection'));
    } finally {
      setSending(false);
    }
  }, [t]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tokens.paper }]}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.title, { color: tokens.ink }]}>
            {t('verify_email.title')}
          </Text>
          <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
            {t('verify_email.subtitle', { email })}
          </Text>

          <OtpInput
            length={OTP_LENGTH}
            onChange={setCode}
            onSubmit={handleSubmit}
            error={error}
            verifying={verifying}
            tokens={tokens}
          />

          {error ? (
            <Text style={[styles.error, { color: '#ef4444' }]}>{error}</Text>
          ) : null}
          {message ? (
            <Text style={[styles.success, { color: tokens.mint }]}>
              {message}
            </Text>
          ) : null}

          <PrimaryButton
            title={
              verifying
                ? t('verify_email.verifying')
                : t('verify_email.submit')
            }
            onPress={() => handleSubmit(code)}
            disabled={verifying || code.length !== OTP_LENGTH}
            style={{ marginTop: 24 }}
          />

          <Pressable onPress={handleResend} disabled={sending} style={styles.resend}>
            <Text style={[styles.resendText, { color: tokens.mint }]}>
              {sending ? t('verify_email.resending') : t('verify_email.resend')}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 22,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'SpaceGrotesk_500Medium',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
  },
  error: {
    fontFamily: 'SpaceGrotesk_500Medium',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  success: {
    fontFamily: 'SpaceGrotesk_500Medium',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  resend: { marginTop: 24 },
  resendText: {
    fontFamily: 'SpaceGrotesk_500Medium',
    fontSize: 14,
  },
});
