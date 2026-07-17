import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
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
import { setPendingWithdrawAfterPin } from '@/src/shared/lib/pin-verify-flag';
import { getLastRoute } from '@/src/shared/lib/screen-memory';
import { OtpInput } from '@/components/OtpInput';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';

type Mode = 'verify' | 'setup' | 'change';

export default function VerifyPinScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; redirect?: string }>();
  const mode = (params.mode as Mode) || 'verify';
  const redirect = params.redirect || '/(tabs)';
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  const handleSubmit = useCallback(
    async (fullPin: string) => {
      if (fullPin.length !== 4) return;
      setVerifying(true);
      setError(null);
      try {
        const endpoint =
          mode === 'setup'
            ? '/api/v1/pin/setup'
            : mode === 'change'
              ? '/api/v1/pin/change'
              : '/api/v1/pin/verify';
        const body: Record<string, string> = { pin: fullPin };

        if (mode === 'setup') {
          body.password = '';
        } else if (mode === 'change') {
          body.current_pin = fullPin;
          body.new_pin = fullPin;
        }

        const res = await apiFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const detail =
            typeof data?.detail === 'string'
              ? data.detail
              : t('pin.error_generic', { defaultValue: 'Something went wrong.' });
          setError(detail);
        } else {
          if (mode === 'verify') {
            if (redirect === '/(tabs)/wallet') {
              setPendingWithdrawAfterPin(true);
            }
            const lastRoute = await getLastRoute();
            router.replace((lastRoute || redirect || '/(tabs)') as any);
          } else {
            router.back();
          }
        }
      } catch {
        setError(
          t('pin.error_connection', { defaultValue: 'Network error. Try again.' })
        );
      } finally {
        setVerifying(false);
      }
    },
    [mode, redirect, router, t]
  );

  const title =
    mode === 'setup'
      ? t('pin.setup_title', { defaultValue: 'Set Transaction PIN' })
      : mode === 'change'
        ? t('pin.change_title', { defaultValue: 'Change PIN' })
        : t('pin.verify_title', { defaultValue: 'Enter Transaction PIN' });

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tokens.paper }]}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.title, { color: tokens.ink }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
            {t('pin.subtitle', {
              defaultValue:
                mode === 'setup'
                  ? 'Create a 4-digit PIN for withdrawals and fallback authentication.'
                  : 'Enter your PIN to continue.',
            })}
          </Text>

          <OtpInput
            length={4}
            onChange={setPin}
            onSubmit={handleSubmit}
            error={error}
            verifying={verifying}
            tokens={tokens}
          />

          {error ? (
            <Text style={[styles.error, { color: '#ef4444' }]}>{error}</Text>
          ) : null}

          <PrimaryButton
            title={
              verifying
                ? t('pin.verifying', { defaultValue: 'Verifying...' })
                : t('pin.submit', { defaultValue: 'Confirm' })
            }
            onPress={() => handleSubmit(pin)}
            disabled={verifying || pin.length !== 4}
            style={{ marginTop: 24 }}
          />
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
});
