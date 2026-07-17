import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, StyleSheet, Linking,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

type DepositResponse = {
  payment_url: string;
  reference: string;
  amount_kobo: number;
};

const AMOUNTS = [500, 1000, 2000, 5000, 10000, 20000];

export default function FundWalletScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');

  const depositMutation = useMutation({
    mutationFn: async () => {
      const finalAmount = amount ?? (parseInt(customAmount) || 0);
      if (finalAmount < 500) throw new Error(t('fund_wallet.errors.amount_min'));

      // Calculate processing fee (1.5% of deposit amount, capped at ₦2,000)
      const processingFee = Math.min(Math.ceil(finalAmount * 0.015), 2000);
      const totalPayment = finalAmount + processingFee;

      const res = await apiFetch('/api/v1/wallet/deposit', {
        method: 'POST',
        body: JSON.stringify({
          amount_kobo: totalPayment * 100, // User pays total (deposit + fee)
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t('fund_wallet.errors.deposit_failed'));
      }

      return (await res.json()) as DepositResponse;
    },
    onSuccess: async (data) => {
      // Open Paystack checkout URL
      const canOpen = await Linking.canOpenURL(data.payment_url);
      if (canOpen) {
        await Linking.openURL(data.payment_url);
        
        // Calculate actual deposit amount (total - fee)
        const actualDeposit = data.amount_kobo / 100;
        const processingFee = Math.min(Math.ceil(actualDeposit * 0.015), 2000);
        const depositAmount = actualDeposit - processingFee;
        
        // Show success message
        Alert.alert(
          'Payment Initiated',
          `Complete payment of ₦${actualDeposit.toLocaleString()}. You'll receive ₦${depositAmount.toLocaleString()} in your wallet.`,
          [
            { 
              text: 'Done', 
              onPress: () => {
                qc.invalidateQueries({ queryKey: ['me'] });
                router.back();
              }
            }
          ],
        );
      } else {
        throw new Error('Could not open payment link');
      }
    },
    onError: (error: Error) => {
      Alert.alert(t('fund_wallet.errors.deposit_failed'), error.message);
    },
  });

  const finalAmount = amount ?? (parseInt(customAmount) || 0);
  const processingFee = finalAmount >= 500 ? Math.min(Math.ceil(finalAmount * 0.015), 2000) : 0;
  const totalPayment = finalAmount + processingFee;
  const canSubmit = finalAmount >= 500;
  const pointsToReceive = finalAmount * 10; // Points based on deposit amount (not including fee)

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('fund_wallet.title')}</Text>
        </View>

        {/* Info */}
        <View style={[styles.infoCard, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
          <Ionicons name="information-circle-outline" size={20} color={tokens.mint} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.infoText, { color: tokens.ink }]}>
              {t('fund_wallet.payment_note')}
            </Text>
          </View>
        </View>

        {/* Quick amounts */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('fund_wallet.amount_label')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {AMOUNTS.map((a) => (
            <TouchableOpacity
              key={a}
              onPress={() => { setAmount(a); setCustomAmount(''); }}
              style={[
                styles.amtBtn,
                {
                  backgroundColor: amount === a ? tokens.mint : tokens.card,
                  borderColor: amount === a ? tokens.mint : tokens.border,
                },
              ]}
            >
              <Text style={[
                styles.amtText,
                { color: amount === a ? tokens.mintText : tokens.ink },
              ]}>₦{a.toLocaleString()}</Text>
              <Text style={[
                styles.ptsText,
                { color: amount === a ? tokens.mintText : tokens.mint },
              ]}>{(a * 10).toLocaleString()} pts</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom amount */}
        <Text style={[styles.label, { color: tokens.inkMuted, marginTop: 8 }]}>{t('fund_wallet.custom_amount')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('fund_wallet.minimum')}
          placeholderTextColor={tokens.inkMuted}
          value={customAmount}
          onChangeText={(text) => {
            setCustomAmount(text);
            setAmount(null);
          }}
          keyboardType="number-pad"
          maxLength={7}
        />

        {/* Summary */}
        {canSubmit && (
          <View style={[styles.summaryCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: tokens.inkMuted }]}>{t('fund_wallet.amount_label')}</Text>
              <Text style={[styles.summaryValue, { color: tokens.ink }]}>₦{finalAmount.toLocaleString()}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: tokens.inkMuted }]}>{t('fund_wallet.processing_fee', { fee: processingFee })}</Text>
              <Text style={[styles.summaryValue, { color: tokens.inkMuted }]}>₦{processingFee.toLocaleString()}</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: tokens.border }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: tokens.ink, fontWeight: '600' }]}>{t('fund_wallet.total_payment', { total: totalPayment })}</Text>
              <Text style={[styles.summaryValue, { color: tokens.ink, fontWeight: '700', fontSize: 18 }]}>
                ₦{totalPayment.toLocaleString()}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: tokens.mint }]}>You'll receive</Text>
              <Text style={[styles.summaryValue, { color: tokens.mint, fontWeight: '700' }]}>
                {pointsToReceive.toLocaleString()} pts
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: tokens.border }]} />
            <Text style={[styles.noteText, { color: tokens.inkMuted }]}>
              💳 Pay securely via Paystack. Wallet credited instantly after payment.
            </Text>
          </View>
        )}

        {/* Pay button */}
        <TouchableOpacity
          onPress={() => depositMutation.mutate()}
          disabled={!canSubmit || depositMutation.isPending}
          style={[
            styles.payBtn,
            {
              backgroundColor: canSubmit ? tokens.mint : tokens.border,
              opacity: depositMutation.isPending ? 0.7 : 1,
            },
          ]}
        >
          {depositMutation.isPending ? (
            <ActivityIndicator color={tokens.mintText} />
          ) : (
            <>
              <Ionicons name="card-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.payText, { color: tokens.mintText }]}>
                {canSubmit ? t('fund_wallet.fund_button') : t('fund_wallet.minimum')}
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
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  infoText: { fontSize: 13, lineHeight: 18 },
  input: {
    borderRadius: 12,
    padding: 14,
    fontSize: 18,
    fontWeight: '600',
    borderWidth: 1,
  },
  amtBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    minWidth: 110,
  },
  amtText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  ptsText: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    marginTop: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryLabel: { fontSize: 14 },
  summaryValue: { fontSize: 16, fontWeight: '600' },
  divider: { height: 1, marginVertical: 12 },
  noteText: { fontSize: 12, lineHeight: 16 },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});
