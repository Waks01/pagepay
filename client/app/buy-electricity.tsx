import { useState } from 'react';
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

type Disco = {
  plan_id?: string;
  plan_code?: string;
  plan_name?: string;
  code?: string;
  name?: string;
  min_amount?: number;
  max_amount?: number;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
  token: string | null;
  units: string | null;
};

const AMOUNTS = [1000, 2000, 5000, 10000, 20000];

export default function BuyElectricityScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [meterNumber, setMeterNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [planId, setPlanId] = useState('ikeja-electric');
  const [meterType, setMeterType] = useState<'prepaid' | 'postpaid'>('prepaid');
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');

  const discosQ = useQuery({
    queryKey: ['electricity-plans'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/electricity/plans');
      if (!res.ok) throw new Error(t('bills.electricity.load_error'));
      return (await res.json()) as Disco[];
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      const finalAmount = amount ?? (parseInt(customAmount) || 0);
      if (finalAmount < 1000) throw new Error(t('bills.electricity.min_amount'));
      if (!phone) throw new Error(t('bills.electricity.phone_required'));
      const res = await apiFetch('/api/v1/bills/electricity', {
        method: 'POST',
        body: JSON.stringify({
          meter_number: meterNumber,
          plan_id: planId,
          meter_type: meterType,
          amount_naira: finalAmount,
          phone: phone,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t('bills.electricity.purchase_failed'));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      const finalAmount = amount ?? parseInt(customAmount);
      Alert.alert(
        t('bills.electricity.success_title'),
        t('bills.electricity.success_message', { amount: finalAmount, meter: meterNumber, points: data.points_earned }),
        [{ text: t('bills.electricity.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      Alert.alert(t('bills.electricity.error_title'), error.message);
    },
  });

  const finalAmount = amount ?? (parseInt(customAmount) || 0);
  const canSubmit = meterNumber.length >= 10 && phone.length === 11 && finalAmount >= 1000;
  const estPoints = finalAmount ? Math.floor(finalAmount * 0.012 * 0.67 * 10) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.electricity.title')}</Text>
        </View>

        {/* DISCO */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.electricity.disco')}</Text>
        {discosQ.isLoading ? (
          <ActivityIndicator color={tokens.mint} />
        ) : (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(discosQ.data ?? []).map((d) => {
              // Disco objects come from the bill-providers API and their
              // shape isn't fully typed — fall back to '' so the rest of
              // the closure sees a `string`, not `string | undefined`.
              const id = d.plan_code ?? d.code ?? '';
              const name = d.plan_name ?? d.name ?? '';
              return (
              <TouchableOpacity
                key={id}
                onPress={() => setPlanId(id)}
                style={[
                  styles.discoChip,
                  {
                    backgroundColor: planId === id ? tokens.mint : tokens.card,
                    borderColor: planId === id ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <Text style={[
                  styles.chipText,
                  {
                    color: planId === id ? tokens.mintText : tokens.ink,
                    fontSize: 11,
                  },
                ]}>{name.split('(')[0].trim()}</Text>
              </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Meter Type */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.electricity.meter_type')}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {(['prepaid', 'postpaid'] as const).map((type) => (
            <TouchableOpacity
              key={type}
              onPress={() => setMeterType(type)}
              style={[
                styles.meterOpt,
                {
                  backgroundColor: meterType === type ? tokens.mintSoft : tokens.card,
                  borderColor: meterType === type ? tokens.mint : tokens.border,
                },
              ]}
            >
              <Ionicons
                name={type === 'prepaid' ? 'keypad-outline' : 'receipt-outline'}
                size={22}
                color={tokens.mint}
              />
              <Text style={[styles.chipText, { color: meterType === type ? tokens.mint : tokens.ink }]}>
                {t(`bills.electricity.${type}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Meter Number */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.electricity.meter_number')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.electricity.meter_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={meterNumber}
          onChangeText={(text) => {
            // Only allow numbers
            const cleaned = text.replace(/[^0-9]/g, '');
            setMeterNumber(cleaned);
          }}
          keyboardType="number-pad"
          maxLength={20}
        />
        {meterNumber.length > 0 && meterNumber.length < 10 && (
          <Text style={{ color: tokens.error, fontSize: 12, marginTop: -10 }}>
            {t('bills.electricity.meter_error')}
          </Text>
        )}

        {/* Phone Number */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.electricity.phone')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.electricity.phone_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={phone}
          onChangeText={(text) => {
            // Only allow numbers
            const cleaned = text.replace(/[^0-9]/g, '');
            setPhone(cleaned);
          }}
          keyboardType="phone-pad"
          maxLength={11}
        />
        {phone.length > 0 && phone.length < 11 && (
          <Text style={{ color: tokens.error, fontSize: 12, marginTop: -10 }}>
            {t('bills.electricity.phone_error')}
          </Text>
        )}

        {/* Amount */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.electricity.amount')}</Text>
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
                styles.earnText,
                { color: amount === a ? tokens.mintText : tokens.mint },
              ]}>+{Math.floor(a * 0.012 * 0.67 * 100)} pts</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom Amount */}
        <Text style={[styles.label, { color: tokens.inkMuted, marginTop: 4 }]}>{t('bills.electricity.custom_amount')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.electricity.custom_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={customAmount}
          onChangeText={(text) => {
            // Only allow numbers
            const cleaned = text.replace(/[^0-9]/g, '');
            setCustomAmount(cleaned);
            setAmount(null);
          }}
          keyboardType="number-pad"
          maxLength={7}
        />

        {/* Earn notice */}
        {finalAmount >= 1000 && (
          <View style={[styles.earnCard, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
            <Ionicons name="gift-outline" size={20} color={tokens.mint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.earnLabel, { color: tokens.mint }]}>{t('bills.electricity.earn_points', { points: estPoints })}</Text>
              <Text style={[styles.earnSub, { color: tokens.ink }]}>
                {t('bills.electricity.earn_description')}
              </Text>
            </View>
          </View>
        )}

        {/* Pay button */}
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
              <Ionicons name="cart-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.payText, { color: tokens.mintText }]}>
                {finalAmount >= 1000 ? t('bills.electricity.pay_button', { amount: finalAmount }) : t('bills.electricity.min_amount_prompt')}
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
    borderRadius: 12, padding: 14, fontSize: 18, fontWeight: '600',
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  discoChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1,
  },
  meterOpt: {
    flex: 1, padding: 12, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', gap: 4,
  },
  amtBtn: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, alignItems: 'center',
  },
  amtText: { fontSize: 14, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  earnText: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  earnCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, padding: 14, borderWidth: 1, marginTop: 4,
  },
  earnLabel: { fontSize: 14, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  earnSub: { fontSize: 12, marginTop: 2 },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});
