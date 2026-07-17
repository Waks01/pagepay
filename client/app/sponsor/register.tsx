import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { registerSponsor } from '@/src/features/sponsor/api';
import { saveToken } from '@/src/shared/lib/storage';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

export default function SponsorRegisterScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const registerMutation = useMutation({
    mutationFn: registerSponsor,
    onSuccess: async (data) => {
      await saveToken(data.access_token);
      Alert.alert(
        t('sponsor_register.success_title'),
        t('sponsor_register.success_message'),
        [{ text: 'Continue', onPress: () => router.replace('/sponsor/kyc') }]
      );
    },
    onError: (error: any) => {
      Alert.alert(t('sponsor_register.errors.registration_failed'), error.message);
    },
  });

  const handleSubmit = () => {
    if (!email || !password || !displayName) {
      Alert.alert(t('sponsor_register.errors.missing_fields'));
      return;
    }

    if (password.length < 8) {
      Alert.alert(t('sponsor_register.errors.weak_password'));
      return;
    }

    registerMutation.mutate({ email, password, display_name: displayName, phone: phone || undefined });
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.paper }]} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { backgroundColor: tokens.card }]}>
          <Ionicons name="arrow-back" size={24} color={tokens.ink} />
        </TouchableOpacity>
      </View>

      <View style={styles.heroSection}>
        <Ionicons name="briefcase" size={64} color={tokens.mint} />
        <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
          {t('sponsor_register.title')}
        </Text>
        <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
          {t('sponsor_register.subtitle')}
        </Text>
      </View>

      <View style={[styles.form, { backgroundColor: tokens.card }]}>
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_register.display_name_required')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: tokens.paper, color: tokens.ink, borderColor: tokens.border }]}
            placeholder={t('sponsor_register.display_name_placeholder')}
            placeholderTextColor={tokens.inkMuted}
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_register.email_label')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: tokens.paper, color: tokens.ink, borderColor: tokens.border }]}
            placeholder={t('sponsor_register.email_placeholder')}
            placeholderTextColor={tokens.inkMuted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_register.phone_label')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: tokens.paper, color: tokens.ink, borderColor: tokens.border }]}
            placeholder={t('sponsor_register.phone_placeholder')}
            placeholderTextColor={tokens.inkMuted}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_register.password_label')}</Text>
          <View style={[styles.passwordContainer, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
            <TextInput
              style={[styles.passwordInput, { color: tokens.ink }]}
              placeholder={t('sponsor_register.password_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
              <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color={tokens.inkMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.infoBox, { backgroundColor: tokens.mintSoft }]}>
          <Ionicons name="information-circle" size={20} color={tokens.mint} />
          <Text style={[styles.infoText, { color: tokens.ink }]}>
            {t('sponsor_register.info_text')}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: tokens.mint }, registerMutation.isPending && { backgroundColor: tokens.border }]}
          onPress={handleSubmit}
          disabled={registerMutation.isPending}
        >
          {registerMutation.isPending ? (
            <ActivityIndicator color={tokens.mintText} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={24} color={tokens.mintText} />
              <Text style={[styles.submitButtonText, { color: tokens.mintText }]}>{t('sponsor_register.submit_button')}</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/(auth)/')} style={styles.loginLink}>
          <Text style={[styles.loginLinkText, { color: tokens.mint }]}>{t('sponsor_register.login_link')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
  form: {
    borderRadius: 12,
    padding: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
  },
  passwordInput: {
    flex: 1,
    padding: 12,
    fontSize: 16,
  },
  eyeIcon: {
    padding: 12,
  },
  infoBox: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  submitButton: {
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  loginLink: {
    padding: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  loginLinkText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
