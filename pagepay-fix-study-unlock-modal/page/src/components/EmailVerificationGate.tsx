import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiFetch } from '@/src/shared/api/client';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';

export function EmailVerificationGate() {
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) throw new Error('Failed to load user');
      return res.json();
    },
  });

  const userEmail = data?.email;
  const emailVerified = data?.email_verified;

  const handleResend = async () => {
    try {
      const res = await apiFetch('/api/v1/auth/resend-verification', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to send' }));
        Alert.alert('Error', err.detail || 'Could not send verification code');
        return;
      }
      Alert.alert('Sent', 'Verification code sent. Check your inbox.');
    } catch {
      Alert.alert('Error', 'Network error. Try again.');
    }
  };

  const handleVerifyNow = () => {
    if (!userEmail) return;
    router.replace({ pathname: '/(auth)/verify-email-code', params: { email: userEmail } });
  };

  if (isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: tokens.paper }]}>
        <Text style={[styles.title, { color: tokens.ink }]}>Loading...</Text>
      </View>
    );
  }

  if (emailVerified) {
    return null;
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <View style={styles.root}>
        <View style={[styles.iconWrap, { backgroundColor: tokens.mintSoft }]}>
          <Ionicons name="mail-outline" size={48} color={tokens.mint} />
        </View>

        <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
          Verify your email
        </Text>
        <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
          We sent a 6-digit verification code to{'\n'}
          <Text style={{ fontWeight: '600', color: tokens.ink }}>{userEmail || 'your email'}</Text>
        </Text>

        <View style={{ gap: 12, marginTop: 32, width: '100%' }}>
          <PrimaryButton title="Enter Code" onPress={handleVerifyNow} />
          <TouchableOpacity onPress={handleResend}>
            <Text style={[styles.resend, { color: tokens.mint }]}>
              Resend code
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  resend: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 12,
  },
});
