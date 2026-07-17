import { useCallback, useMemo, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { saveToken, saveRefreshToken } from '@/src/shared/lib/storage';
import { getDeviceFingerprint } from '@/src/shared/lib/device-fingerprint';
import { PageMark } from '@/components/PageMark';
import { AnimatedInput } from '@/components/AnimatedInput';
import { Field, PasswordToggle } from '@/components/Field';
import { PrimaryButton } from '@/components/PrimaryButton';
import { AuthScreenEntrance, AnimatedSubmitButton, ErrorShake, SuccessRedirect, PasswordStrengthBar } from '@/components/animations';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type FieldErrors = Partial<Record<'email' | 'password' | 'confirm' | 'referralCode', string>>;

/**
 * Returns 0..4 — strength of a password. Used to fill the 4-segment bar.
 * 0: empty/short; 1: 8+ chars; 2: 10+ chars OR mixed case; 3: mixed case + digits;
 * 4: mixed case + digits + symbols, 12+ chars.
 */
function passwordStrength(p: string): number {
  if (!p) return 0;
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 10) score++;
  const hasLower = /[a-z]/.test(p);
  const hasUpper = /[A-Z]/.test(p);
  const hasDigit = /\d/.test(p);
  const hasSym = /[^A-Za-z0-9]/.test(p);
  if (hasLower && hasUpper) score++;
  if (hasLower && hasUpper && hasDigit) score++;
  if (hasLower && hasUpper && hasDigit && hasSym && p.length >= 12) score++;
  return Math.min(4, score);
}

type Props = {
  onSwitchToLogin?: () => void;
};

export default function RegisterScreen({ onSwitchToLogin }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorTrigger, setErrorTrigger] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);
  const strengthLabel = ['', t('auth.register.password_strength.too_weak'), t('auth.register.password_strength.weak'), t('auth.register.password_strength.good'), t('auth.register.password_strength.strong')][strength];
  const strengthColor =
    strength <= 1
      ? tokens.signal
      : strength === 2
        ? tokens.inkMuted
        : tokens.mint;

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
  const onChangeConfirm = useCallback((v: string) => {
    setConfirm(v);
    setErrors((p) => (p.confirm ? { ...p, confirm: undefined } : p));
  }, []);
  const onChangeReferralCode = useCallback((v: string) => {
    setReferralCode(v.toUpperCase());
    setErrors((p) => (p.referralCode ? { ...p, referralCode: undefined } : p));
  }, []);

  const validate = useCallback((): FieldErrors => {
    const e: FieldErrors = {};
    if (!email.trim()) e.email = t('auth.register.errors.enter_email');
    if (!password) e.password = t('auth.register.errors.enter_password');
    else if (password.length < 8) e.password = t('auth.register.errors.password_too_short');
    if (!confirm) e.confirm = t('auth.register.errors.enter_confirm');
    else if (confirm !== password) e.confirm = t('auth.register.errors.passwords_mismatch');
    if (referralCode && referralCode.length !== 6) {
      e.referralCode = t('auth.register.errors.referral_length');
    }
    return e;
  }, [email, password, confirm, referralCode, t]);

  const isEmail = useCallback((v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), []);

  const handleRegister = useCallback(async () => {
    setFormError(null);
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) {
      setErrorTrigger(true);
      setTimeout(() => setErrorTrigger(false), 600);
      return;
    }
    if (!agreed) {
      setFormError(t('auth.register.errors.agree_to_terms'));
      setErrorTrigger(true);
      setTimeout(() => setErrorTrigger(false), 600);
      return;
    }

    setLoading(true);
    try {
      const fingerprint = await getDeviceFingerprint();
      const payload: Record<string, string | undefined> = {
        password,
        referral_code: referralCode || undefined,
      };
      if (isEmail(email)) {
        payload.email = email.trim();
      } else if (email.trim().length >= 10) {
        payload.phone = email.trim();
      } else {
        setFormError(t('auth.register.errors.invalid_email_phone'));
        setErrorTrigger(true);
        setTimeout(() => setErrorTrigger(false), 600);
        setLoading(false);
        return;
      }

      const res = await apiFetch('/api/v1/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Fingerprint': fingerprint,
        },
        body: JSON.stringify(payload),
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
        if (status === 409) {
          setFormError(t('auth.register.errors.account_exists'));
        } else if (status === 400 && detail.includes('referral')) {
          setErrors({ referralCode: t('auth.register.errors.invalid_referral') });
        } else {
          setFormError(detail || t('auth.register.errors.create_failed'));
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
      setSuccess(true);
      setTimeout(() => router.replace({ pathname: '/(auth)/verify-email-code', params: { email: email.trim() } }), 1000);
    } catch {
      setFormError(t('auth.register.errors.connection_error'));
      setErrorTrigger(true);
      setTimeout(() => setErrorTrigger(false), 600);
    } finally {
      setLoading(false);
    }
  }, [agreed, email, password, router, validate, t]);

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
                  title={t('auth.register.title')}
                  subtitle={t('auth.register.subtitle')}
                />

                {formError ? (
                  <View style={[styles.banner, { backgroundColor: tokens.signalSoft, borderColor: tokens.signal }]}>
                    <Text style={[styles.bannerText, { color: tokens.signal }]}>{formError}</Text>
                  </View>
                ) : null}

                <View style={{ gap: 14 }}>
                  <Field
                    label={t('auth.register.email_label')}
                    value={email}
                    onChangeText={onChangeEmail}
                    placeholder={t('auth.register.email_placeholder')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="username"
                    returnKeyType="next"
                    error={errors.email}
                  />

                  <View style={{ gap: 8 }}>
                    <Field
                      label={t('auth.register.password_label')}
                      value={password}
                      onChangeText={onChangePassword}
                      placeholder={t('auth.register.password_placeholder')}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="newPassword"
                      returnKeyType="next"
                      error={errors.password}
                      rightIcon={
                        <PasswordToggle
                          visible={showPassword}
                          onToggle={() => setShowPassword((s) => !s)}
                        />
                      }
                    />
                    {password.length > 0 ? (
                      <PasswordStrengthBar
                        strength={strength}
                        label={strengthLabel}
                        color={strengthColor}
                        mutedColor={tokens.border}
                        inkMuted={tokens.inkMuted}
                      />
                    ) : (
                      <Text style={[styles.helper, { color: tokens.inkMuted }]}>
                        {t('auth.register.password_helper')}
                      </Text>
                    )}
                  </View>

                  <Field
                    label={t('auth.register.confirm_label')}
                    value={confirm}
                    onChangeText={onChangeConfirm}
                    placeholder={t('auth.register.confirm_placeholder')}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    returnKeyType="next"
                    error={errors.confirm}
                  />

                  <Field
                    label={t('auth.register.referral_label')}
                    value={referralCode}
                    onChangeText={onChangeReferralCode}
                    placeholder={t('auth.register.referral_placeholder')}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={6}
                    returnKeyType="go"
                    onSubmitEditing={handleRegister}
                    error={errors.referralCode}
                  />
                  <Text style={[styles.helper, { color: tokens.inkMuted, marginTop: -8 }]}>
                    {t('auth.register.referral_helper')}
                  </Text>
                </View>

                  <Pressable
                    onPress={() => setAgreed((a) => !a)}
                    hitSlop={6}
                    style={styles.termsRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: agreed }}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: agreed ? tokens.mint : tokens.border,
                          backgroundColor: agreed ? tokens.mint : 'transparent',
                        },
                      ]}
                    >
                      {agreed ? (
                        <Ionicons name="checkmark" size={14} color={tokens.mintText} />
                      ) : null}
                    </View>
                    <Text style={[styles.termsText, { color: tokens.inkMuted }]}>
                      {t('auth.register.terms_agree')}{' '}
                      <Pressable onPress={() => router.push({ pathname: '/legal', params: { slug: 'terms' } })}>
                        <Text style={{ color: tokens.mint, fontWeight: '600' }}>{t('auth.register.terms')}</Text>
                      </Pressable>
                      {' '}{t('auth.register.and')}{' '}
                      <Pressable onPress={() => router.push({ pathname: '/legal', params: { slug: 'privacy' } })}>
                        <Text style={{ color: tokens.mint, fontWeight: '600' }}>{t('auth.register.privacy')}</Text>
                      </Pressable>
                      .
                    </Text>
                  </Pressable>

                <AnimatedSubmitButton
                  title={t('auth.register.create_account')}
                  isLoading={loading}
                  isSuccess={success}
                  disabled={!agreed}
                  onPress={handleRegister}
                />

                <View style={styles.tertiaryRow}>
                  <Text style={[styles.tertiaryMuted, { color: tokens.inkMuted }]}>
                    {t('auth.register.already_have_account')}
                  </Text>
                  <Pressable onPress={onSwitchToLogin} hitSlop={6}>
                    <Text style={[styles.tertiaryLink, { color: tokens.mint }]}>
                      {t('auth.register.sign_in_link')}
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
  helper: {
    fontSize: 12,
    lineHeight: 16,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
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