import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type PaymentResult = 'success' | 'cancelled' | 'error';

export default function SubscriptionSuccessScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const router = useRouter();
  const params = useLocalSearchParams<{
    status?: string;
    trxref?: string;
    reference?: string;
  }>();

  const result: PaymentResult = params.status === 'success' ? 'success' : params.status === 'cancelled' ? 'cancelled' : 'error';

  if (result === 'cancelled') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.paper }]}>
        <Ionicons name="close-circle-outline" size={64} color={tokens.signal} />
        <Text style={[styles.title, { color: tokens.ink }]}>
          {t('premium.payment_cancelled_title')}
        </Text>
        <Text style={[styles.message, { color: tokens.inkMuted }]}>
          {t('premium.payment_cancelled_body')}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.button, { backgroundColor: tokens.mint }]}>
          <Text style={[styles.buttonText, { color: tokens.mintText }]}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (result === 'error') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.paper }]}>
        <Ionicons name="alert-circle-outline" size={64} color={tokens.signal} />
        <Text style={[styles.title, { color: tokens.ink }]}>
          {t('premium.payment_error_title')}
        </Text>
        <Text style={[styles.message, { color: tokens.inkMuted }]}>
          {t('premium.payment_error_body')}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.button, { backgroundColor: tokens.mint }]}>
          <Text style={[styles.buttonText, { color: tokens.mintText }]}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.paper }]}>
      <Ionicons name="checkmark-circle" size={64} color={tokens.mint} />
      <Text style={[styles.title, { color: tokens.ink }]}>
        {t('premium.premium_activated_title')}
      </Text>
      <Text style={[styles.message, { color: tokens.inkMuted }]}>
        {t('premium.premium_activated_body')}
      </Text>
      <TouchableOpacity onPress={() => router.replace('/premium')} style={[styles.button, { backgroundColor: tokens.mint }]}>
        <Text style={[styles.buttonText, { color: tokens.mintText }]}>{t('common.done')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
