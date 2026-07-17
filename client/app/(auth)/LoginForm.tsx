import { useCallback, useState, useEffect } from 'react';
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
import { saveToken, saveRefreshToken, getRefreshToken } from '@/src/shared/lib/storage';
import { getDeviceFingerprint } from '@/src/shared/lib/device-fingerprint';
import {
  displayName,
  initials,
} from '@/src/shared/lib/display-name';
import {
  persistLanguage,
  persistTheme,
  usePreferences,
} from '@/src/shared/lib/preferences';
import { clearToken } from '@/src/shared/lib/storage';
import { registerFCMToken } from '@/src/lib/notifications';
import { PageMark } from '@/components/PageMark';
import { AnimatedInput } from '@/components/AnimatedInput';
import { PasswordToggle } from '@/components/Field';
import { PrimaryButton } from '@/components/PrimaryButton';
import { AuthScreenEntrance, AnimatedSubmitButton, ErrorShake, SuccessRedirect } from '@/components/animations';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

type Props = {
  onSwitchToRegister?: () => void;
};

export default function LoginScreen({ onSwitchToRegister }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
   const [errorTrigger, setErrorTrigger] = useState(false);

   // Stable change handlers. Each one only clears its own field error after
  // the first keystroke — never `formError` and never in `onFocus`. Clearing
  // state from `onFocus` was the cause of the focus-jumping loop on Android:
  // focus → setState → layout pass → focus stolen → next field grabs focus.
  const onChangeEmail = useCallback((v: string) => {
    setEmail(v);
    setErrors((p) => (p.email ? { ...p, email: undefined } : p));
  }, []);
  const onChangePassword = useCallback((v: string) => {
    setPassword(v);
    setErrors((p) => (p.password ? { ...p, password: undefined } : p));
  }, []);

  const validate = useCallback((): FieldErrors => {
    const e: FieldErrors = {};
    if (!email.trim()) e.email = t('auth.login.errors.enter_email');
    if (!password) e.password = t('auth.login.errors.enter_password');
    return e;
  }, [email, password, t]);

  const handleLogin = useCallback(async () => {
    setFormError(null);
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) {
      setErrorTrigger(true);
      setTimeout(() => setErrorTrigger(false), 600);
      return;
    }

    setLoading(true);
    try {
      const fingerprint = await getDeviceFingerprint();
      const res = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Device-Fingerprint': fingerprint,
        },
        body: `username=${encodeURIComponent(email.trim())}&password=${encodeURIComponent(password)}`,
      });

      if (!res.ok) {
        const status = res.status;
        let detail = '';
        try {
          const data = await res.json();
          detail = typeof data?.detail === 'string' ? data.detail : '';
        } catch {
          /* non-JSON response */
        }
        if (status === 401 && !detail) {
          setFormError(t('auth.login.errors.credentials_mismatch'));
        } else {
          setFormError(detail || `Connection error (HTTP ${status})`);
        }
        setErrorTrigger(true);
        setTimeout(() => setErrorTrigger(false), 600);
        return;
      }

      const data = await res.json();
      await saveToken(data.access_token);
      if (data.refresh_token) {
        await saveRefreshToken(data.refresh_token);
      }
      
      await registerFCMToken();
      router.replace('/(tabs)');
    } catch {
      setFormError(t('auth.login.errors.connection_error'));
      setErrorTrigger(true);
      setTimeout(() => setErrorTrigger(false), 600);
    } finally {
      setLoading(false);
    }
  }, [email, password, router, validate, t]);

  return (
    <View style={[styles.root, { backgroundColor: tokens.paper }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      
      {/* Success redirect overlay */}
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
                    title={t('auth.login.title')}
                    subtitle={t('auth.login.subtitle')}
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
                      label={t('auth.login.email_label')}
                      value={email}
                      onChangeText={onChangeEmail}
                      placeholder={t('auth.login.email_placeholder')}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      textContentType="username"
                      returnKeyType="next"
                      error={errors.email}
                    />
                    <AnimatedInput
                      label={t('auth.login.password_label')}
                      value={password}
                      onChangeText={onChangePassword}
                      placeholder={t('auth.login.password_placeholder')}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="password"
                      returnKeyType="go"
                      onSubmitEditing={handleLogin}
                      error={errors.password}
                      rightIcon={
                        <PasswordToggle
                          visible={showPassword}
                          onToggle={() => setShowPassword((p) => !p)}
                        />
                      }
                    />
                  </View>

                  <View style={styles.forgotRow}>
                    <Pressable
                      onPress={() => router.push('/forgot-password')}
                      hitSlop={8}
                    >
                      <Text style={[styles.forgot, { color: tokens.mint }]}>
                        {t('auth.login.forgot_password')}
                      </Text>
                    </Pressable>
                  </View>

                  <AnimatedSubmitButton
                    title={t('auth.login.sign_in')}
                    isLoading={loading}
                    isSuccess={success}
                    onPress={handleLogin}
                  />

                  <View style={styles.tertiaryRow}>
                    <Text style={[styles.tertiaryMuted, { color: tokens.inkMuted }]}>
                      {t('auth.login.new_to_pagepay')}
                    </Text>
                     <Pressable onPress={onSwitchToRegister} hitSlop={6}>
                      <Text style={[styles.tertiaryLink, { color: tokens.mint }]}>
                        {t('auth.login.create_account')}
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
    paddingHorizontal: 8,
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
  brand: {
    fontSize: 18,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  headline: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
    marginTop: 4,
  },
  subline: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
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
  forgotRow: {
    alignItems: 'flex-end',
    marginTop: 4,
    marginBottom: 4,
  },
  forgot: {
    fontSize: 13,
    fontWeight: '500',
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