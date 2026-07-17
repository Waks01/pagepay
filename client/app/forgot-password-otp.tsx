import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

export default function ForgotPasswordOtpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ identifier?: string }>();
  const identifier = params.identifier || '';
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const handleSubmit = useCallback(
    async (fullCode: string) => {
      if (!identifier || fullCode.length !== OTP_LENGTH) return;
      setVerifying(true);
      setError(null);
      setMessage(null);
      try {
        const isEmail = identifier.includes('@');
        const body: Record<string, string> = { otp: fullCode };
        if (isEmail) body.email = identifier;
        else body.phone = identifier;

        const res = await apiFetch('/api/v1/auth/forgot-password/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const detail =
            typeof data?.detail === 'string'
              ? data.detail
              : t('forgot_password_otp.error_generic', {
                  defaultValue: 'Invalid code.',
                });
          setError(detail);
        } else {
          const data = await res.json().catch(() => ({ reset_token: '' }));
          setMessage(
            t('forgot_password_otp.success', { defaultValue: 'Code verified.' })
          );
          setTimeout(
            () =>
              router.replace({
                pathname: '/reset-password',
                params: { token: data.reset_token || '' },
              }),
            800
          );
        }
      } catch {
        setError(
          t('forgot_password_otp.error_connection', {
            defaultValue: 'Network error. Try again.',
          })
        );
      } finally {
        setVerifying(false);
      }
    },
    [identifier, router, t]
  );

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleResend = useCallback(async () => {
    setError(null);
    setMessage(null);
    setResending(true);
    try {
      const isEmail = identifier.includes('@');
      const body: Record<string, string> = isEmail
        ? { email: identifier }
        : { phone: identifier };
      const res = await apiFetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data?.detail === 'string'
            ? data.detail
            : t('forgot_password_otp.resend_error', {
                defaultValue: 'Could not resend code.',
              })
        );
      } else {
        setMessage(
          t('forgot_password_otp.resend_success', {
            defaultValue: 'New code sent.',
          })
        );
      }
    } catch {
      setError(
        t('forgot_password_otp.error_connection', {
          defaultValue: 'Network error. Try again.',
        })
      );
    } finally {
      setResending(false);
    }
  }, [identifier, t]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tokens.paper }]}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.title, { color: tokens.ink }]}>
            {t('forgot_password_otp.title', { defaultValue: 'Enter reset code' })}
          </Text>
          <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
            {t('forgot_password_otp.subtitle', {
              defaultValue: 'We sent a 6-digit code to',
            })}
            {'\n'}
            <Text style={{ fontWeight: '600', color: tokens.ink }}>
              {identifier || ''}
            </Text>
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
                ? t('forgot_password_otp.verifying', { defaultValue: 'Verifying...' })
                : t('forgot_password_otp.submit', { defaultValue: 'Verify code' })
            }
            onPress={() => handleSubmit(code)}
            disabled={verifying || code.length !== OTP_LENGTH}
            style={{ marginTop: 24 }}
          />

          <View style={styles.tertiaryRow}>
            <Pressable
              onPress={handleBack}
              hitSlop={6}
              disabled={verifying || resending}
              style={({ pressed }) => [
                styles.tertiaryLinkPressable,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text
                style={[
                  styles.tertiaryLink,
                  { color: tokens.mint },
                  (verifying || resending) && styles.tertiaryLinkDisabled,
                ]}
              >
                {t('forgot_password_otp.back', { defaultValue: '← Back' })}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleResend}
              disabled={verifying || resending}
              style={({ pressed }) => [
                styles.resendPressable,
                { backgroundColor: pressed ? tokens.mintSoft : 'transparent' },
                pressed && styles.resendPressed,
                (verifying || resending) && styles.resendDisabled,
              ]}
            >
              {resending ? (
                <ActivityIndicator size="small" color={tokens.mint} />
              ) : (
                <Text style={[styles.resendText, { color: tokens.mint }]}>
                  {t('forgot_password_otp.resend', { defaultValue: 'Resend code' })}
                </Text>
              )}
            </Pressable>
          </View>
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
  tertiaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    marginTop: 24,
  },
  tertiaryLinkPressable: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tertiaryLink: { fontSize: 14, fontWeight: '600' },
  tertiaryLinkDisabled: { opacity: 0.4 },
  resendPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
    minHeight: 40,
    gap: 8,
  },
  resendPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }],
  },
  resendDisabled: {
    opacity: 0.5,
  },
  resendText: { fontSize: 14, fontWeight: '600' },
});
