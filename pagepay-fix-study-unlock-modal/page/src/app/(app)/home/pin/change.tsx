import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import { OtpInput } from '@/components/OtpInput';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';

const PIN_LENGTH = 4;

export default function ChangePinScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const submit = useCallback(async () => {
    if (newPin !== confirmPin) {
      Alert.alert(t('pin.error', { defaultValue: 'Error' }), t('pin.mismatch', { defaultValue: 'New PINs do not match.' }));
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/pin/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        Alert.alert(t('pin.error', { defaultValue: 'Error' }), typeof data?.detail === 'string' ? data.detail : t('pin.error_generic', { defaultValue: 'Failed to change PIN.' }));
      } else {
        router.back();
      }
    } catch {
      Alert.alert(t('pin.error', { defaultValue: 'Error' }), t('pin.error_connection', { defaultValue: 'Network error. Try again.' }));
    } finally {
      setVerifying(false);
    }
  }, [currentPin, newPin, confirmPin, router, t]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tokens.paper }]}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('pin.change_title', { defaultValue: 'Change Transaction PIN' })}</Text>

          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('pin.current_pin_label', { defaultValue: 'Current PIN' })}</Text>
          <OtpInput
            length={PIN_LENGTH}
            onChange={setCurrentPin}
            onSubmit={submit}
            error={error}
            verifying={verifying}
            tokens={tokens}
          />

          <Text style={[styles.label, { color: tokens.inkMuted, marginTop: 16 }]}>{t('pin.new_pin_label', { defaultValue: 'New PIN' })}</Text>
          <OtpInput
            length={PIN_LENGTH}
            onChange={setNewPin}
            onSubmit={submit}
            error={error}
            verifying={verifying}
            tokens={tokens}
          />

          <Text style={[styles.label, { color: tokens.inkMuted, marginTop: 16 }]}>{t('pin.confirm_label', { defaultValue: 'Confirm New PIN' })}</Text>
          <OtpInput
            length={PIN_LENGTH}
            onChange={setConfirmPin}
            onSubmit={submit}
            error={error}
            verifying={verifying}
            tokens={tokens}
          />

          <PrimaryButton
            title={verifying ? t('pin.changing', { defaultValue: 'Changing...' }) : t('pin.change_button', { defaultValue: 'Change PIN' })}
            onPress={submit}
            disabled={verifying || currentPin.length !== PIN_LENGTH || newPin.length !== PIN_LENGTH || confirmPin.length !== PIN_LENGTH}
            style={{ marginTop: 24 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', padding: 24 },
  title: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22, marginBottom: 20 },
  label: { fontFamily: 'SpaceGrotesk_500Medium', fontSize: 13, marginBottom: 8, alignSelf: 'flex-start' },
});
