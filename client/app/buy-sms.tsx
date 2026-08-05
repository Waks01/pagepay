import { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

type SmsPricing = {
  cost_per_page: number;
  normal_chars_per_page: number;
  unicode_chars_per_page: number;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
  job_id: string;
  total_pages: number;
  total_cost: number;
};

export default function BuySmsScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [senderName, setSenderName] = useState('');
  const [recipients, setRecipients] = useState('');
  const [message, setMessage] = useState('');

  const pricingQ = useQuery({
    queryKey: ['sms-pricing'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/sms/pricing');
      if (!res.ok) throw new Error(t('bills.sms.load_error'));
      return (await res.json()) as SmsPricing;
    },
  });

  const recipientList = useMemo(() => {
    return recipients.split(',').map(r => r.trim()).filter(r => r.length > 0);
  }, [recipients]);

  const estimate = useMemo(() => {
    const pricing = pricingQ.data;
    if (!pricing || recipientList.length === 0 || !message) {
      return { pages: 0, cost: 0 };
    }
    const charsPerPage = pricing.normal_chars_per_page || 160;
    const pages = Math.max(1, Math.ceil(message.length / charsPerPage));
    const cost = pricing.cost_per_page * pages * recipientList.length;
    return { pages, cost };
  }, [pricingQ.data, recipientList, message]);

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!senderName.trim()) throw new Error(t('bills.sms.enter_sender'));
      if (recipientList.length === 0) throw new Error(t('bills.sms.enter_recipients'));
      if (!message.trim()) throw new Error(t('bills.sms.enter_message'));
      const res = await apiFetch('/api/v1/bills/sms/send', {
        method: 'POST',
        body: JSON.stringify({
          sender_name: senderName.trim(),
          recipients: recipientList,
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t('bills.sms.send_failed'));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      Alert.alert(
        t('bills.sms.success_title'),
        t('bills.sms.success_message', { job: data.job_id, pages: data.total_pages, cost: data.total_cost }),
        [{ text: t('bills.sms.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      Alert.alert(t('bills.sms.error_title'), error.message);
    },
  });

  const canSubmit = senderName.trim().length > 0 && recipientList.length > 0 && message.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.sms.title')}</Text>
        </View>

        {/* Sender Name */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.sms.sender')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.sms.sender_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={senderName}
          onChangeText={setSenderName}
          maxLength={20}
        />

        {/* Recipients */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.sms.recipients')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.sms.recipients_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={recipients}
          onChangeText={setRecipients}
          keyboardType="numbers-and-punctuation"
        />
        {recipientList.length > 0 && (
          <Text style={{ color: tokens.inkMuted, fontSize: 12 }}>
            {recipientList.length} recipient{recipientList.length !== 1 ? 's' : ''}
          </Text>
        )}

        {/* Message */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.sms.message')}</Text>
        <TextInput
          style={[styles.textarea, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.sms.message_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={6}
          maxLength={1000}
        />
        <Text style={{ color: tokens.inkMuted, fontSize: 12, textAlign: 'right' }}>
          {message.length} chars
        </Text>

        {/* Estimate */}
        {estimate.cost > 0 && (
          <View style={[styles.estimateCard, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[styles.estimateLabel, { color: tokens.inkMuted }]}>Pages</Text>
              <Text style={[styles.estimateValue, { color: tokens.ink }]}>{estimate.pages}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text style={[styles.estimateLabel, { color: tokens.inkMuted }]}>Recipients</Text>
              <Text style={[styles.estimateValue, { color: tokens.ink }]}>{recipientList.length}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, borderTopWidth: 1, borderTopColor: tokens.border, paddingTop: 8 }}>
              <Text style={[styles.estimateLabel, { color: tokens.inkMuted }]}>Estimated Cost</Text>
              <Text style={[styles.estimateTotal, { color: tokens.mint }]}>₦{estimate.cost.toLocaleString()}</Text>
            </View>
          </View>
        )}

        {/* Send button */}
        <TouchableOpacity
          onPress={() => purchaseMutation.mutate()}
          disabled={!canSubmit || purchaseMutation.isPending}
          style={[
            styles.payBtn,
            {
              backgroundColor: canSubmit ? tokens.mint : tokens.border,
              opacity: purchaseMutation.isPending ? 0.7 : 1,
            },
          ]}
        >
          {purchaseMutation.isPending ? (
            <ActivityIndicator color={tokens.mintText} />
          ) : (
            <>
              <Ionicons name="send-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.payText, { color: tokens.mintText }]}>
                {estimate.cost > 0 ? t('bills.sms.send_button', { cost: estimate.cost }) : t('bills.sms.fill_details')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  label: { fontSize: 13, fontWeight: '500' },
  input: {
    borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '600',
    borderWidth: 1,
  },
  textarea: {
    borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '600',
    borderWidth: 1, minHeight: 120, textAlignVertical: 'top',
  },
  estimateCard: {
    borderRadius: 12, padding: 14, borderWidth: 1, gap: 4,
  },
  estimateLabel: { fontSize: 13, fontWeight: '500' },
  estimateValue: { fontSize: 14, fontWeight: '600' },
  estimateTotal: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});