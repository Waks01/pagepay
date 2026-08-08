import { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, StyleSheet, Modal,
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

const MAX_CHARS = 1000;

export default function BuySmsScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [senderName, setSenderName] = useState('');
  const [recipients, setRecipients] = useState('');
  const [message, setMessage] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

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
      setShowConfirmModal(false);
      Alert.alert(
        t('bills.sms.success_title'),
        t('bills.sms.success_message', { pages: data.total_pages, recipients: recipientList.length, job: data.job_id }),
        [{ text: t('bills.sms.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      setShowConfirmModal(false);
      setPurchaseError(error.message);
    },
  });

  const canSubmit =
    senderName.trim().length > 0 && recipientList.length > 0 && message.trim().length > 0;

  const handleBuyPress = () => {
    if (!canSubmit) return;
    setPurchaseError(null);
    setShowConfirmModal(true);
  };

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

        {/* SECTION 1: Sender Name */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.sms.sender')}</Text>
          <View style={{ position: 'relative' }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: tokens.paper,
                  color: tokens.ink,
                  borderColor: senderName.trim().length > 0 ? tokens.mint : tokens.border,
                },
              ]}
              placeholder={t('bills.sms.sender_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={senderName}
              onChangeText={setSenderName}
              maxLength={20}
            />
            {senderName.trim().length > 0 && (
              <View style={styles.inputIconValid}>
                <Ionicons name="checkmark-circle" size={20} color={tokens.mint} />
              </View>
            )}
          </View>
        </View>

        {/* SECTION 2: Recipients */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.sms.recipients')}</Text>
            {recipientList.length > 0 && (
              <Text style={{ color: tokens.inkMuted, fontSize: 11 }}>
                {recipientList.length} {recipientList.length === 1 ? 'recipient' : 'recipients'}
              </Text>
            )}
          </View>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: tokens.paper,
                color: tokens.ink,
                borderColor: recipientList.length > 0 ? tokens.mint : tokens.border,
              },
            ]}
            placeholder={t('bills.sms.recipients_placeholder')}
            placeholderTextColor={tokens.inkMuted}
            value={recipients}
            onChangeText={setRecipients}
            keyboardType="numbers-and-punctuation"
            multiline
          />
        </View>

        {/* SECTION 3: Message */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.sms.message')}</Text>
            <Text style={{ color: tokens.inkMuted, fontSize: 11 }}>
              {message.length} / {MAX_CHARS}
            </Text>
          </View>
          <TextInput
            style={[
              styles.textarea,
              {
                backgroundColor: tokens.paper,
                color: tokens.ink,
                borderColor: message.trim().length > 0 ? tokens.mint : tokens.border,
              },
            ]}
            placeholder={t('bills.sms.message_placeholder')}
            placeholderTextColor={tokens.inkMuted}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={6}
            maxLength={MAX_CHARS}
          />
        </View>

        {/* SECTION 4: Estimate Summary */}
        {estimate.cost > 0 && (
          <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.sms.pages_label')}</Text>
              <Text style={[styles.summaryValue, { color: tokens.ink }]}>{estimate.pages}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: tokens.border }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.sms.recipients_label')}</Text>
              <Text style={[styles.summaryValue, { color: tokens.ink }]}>{recipientList.length}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: tokens.border }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.sms.estimated_cost')}</Text>
              <Text style={[styles.summaryValue, { color: tokens.mint, fontWeight: '700' }]}>
                ₦{estimate.cost.toLocaleString()}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: tokens.border }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.sms.earn_label')}</Text>
              <Text style={[styles.summaryValue, { color: tokens.mint, fontWeight: '700' }]}>
                +{Math.floor(estimate.cost * 0.018 * 0.67 * 10)} pts
              </Text>
            </View>
          </View>
        )}

        {/* Send button */}
        <TouchableOpacity
          onPress={handleBuyPress}
          disabled={!canSubmit || purchaseMutation.isPending}
          style={[
            styles.payBtn,
            {
              backgroundColor: canSubmit ? tokens.mint : tokens.border,
              opacity: purchaseMutation.isPending ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="send-outline" size={20} color={tokens.mintText} />
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {estimate.cost > 0
              ? t('bills.sms.send_button_with_cost', { cost: estimate.cost })
              : t('bills.sms.fill_details')}
          </Text>
        </TouchableOpacity>

        {/* Inline error banner */}
        {purchaseError && (
          <View style={[styles.errorBanner, { backgroundColor: tokens.signalSoft, borderColor: tokens.signal }]}>
            <Ionicons name="alert-circle-outline" size={18} color={tokens.signal} />
            <Text style={{ flex: 1, color: tokens.signal, fontSize: 13 }}>
              {purchaseError}
            </Text>
            <TouchableOpacity onPress={() => setPurchaseError(null)}>
              <Ionicons name="close" size={18} color={tokens.signal} />
            </TouchableOpacity>
          </View>
        )}

        {/* Confirm Modal */}
        <Modal
          visible={showConfirmModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowConfirmModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.modalTitle, { color: tokens.ink }]}>Confirm Send</Text>
              <View style={[styles.modalDivider, { backgroundColor: tokens.border }]} />
              <View style={{ gap: 12, marginVertical: 16 }}>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Sender</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>{senderName.trim()}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Recipients</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>{recipientList.length}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Pages</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>× {estimate.pages}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Message</Text>
                  <Text style={[styles.modalValue, { color: tokens.inkMuted, maxWidth: 180 }]} numberOfLines={2}>
                    {message.trim()}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Cost</Text>
                  <Text style={[styles.modalValue, { color: tokens.mint, fontWeight: '700' }]}>
                    ₦{estimate.cost.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>You'll earn</Text>
                  <Text style={[styles.modalValue, { color: tokens.mint }]}>
                    +{Math.floor(estimate.cost * 0.018 * 0.67 * 10)} pts
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
                <TouchableOpacity
                  onPress={() => setShowConfirmModal(false)}
                  disabled={purchaseMutation.isPending}
                  style={[styles.modalBtn, styles.modalBtnCancel, { borderColor: tokens.border }]}
                >
                  <Text style={[styles.modalBtnText, { color: tokens.inkMuted }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => purchaseMutation.mutate()}
                  disabled={purchaseMutation.isPending}
                  style={[styles.modalBtn, styles.modalBtnConfirm, { backgroundColor: tokens.mint }]}
                >
                  {purchaseMutation.isPending ? (
                    <ActivityIndicator color={tokens.mintText} />
                  ) : (
                    <Text style={[styles.modalBtnText, { color: tokens.mintText }]}>Confirm</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  card: {
    borderRadius: 16, padding: 16, borderWidth: 1, gap: 12,
  },
  label: { fontSize: 13, fontWeight: '500' },
  input: {
    borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '600',
    borderWidth: 1,
  },
  inputIconValid: {
    position: 'absolute', right: 12, top: 14,
  },
  textarea: {
    borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '500',
    borderWidth: 1, minHeight: 120, textAlignVertical: 'top',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 4,
  },
  summaryKey: { fontSize: 14, fontWeight: '500' },
  summaryValue: { fontSize: 14, fontWeight: '600' },
  summaryDivider: { height: 1 },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  modalContent: {
    borderRadius: 20, padding: 24, width: '100%', maxWidth: 380, borderWidth: 1,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  modalDivider: { height: 1, marginTop: 12 },
  modalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  modalKey: { fontSize: 14, fontWeight: '500' },
  modalValue: { fontSize: 14, fontWeight: '600' },
  modalBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    minHeight: 48, justifyContent: 'center',
  },
  modalBtnCancel: { backgroundColor: 'transparent', borderWidth: 1 },
  modalBtnConfirm: { },
  modalBtnText: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});