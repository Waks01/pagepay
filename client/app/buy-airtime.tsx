import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

type AirtimeResult = {
  reference: string;
  phone: string;
  amount_naira: number;
  network: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
};

const NETWORKS = [
  { key: 'mtn', label: 'MTN' },
  { key: 'airtel', label: 'Airtel' },
  { key: 'glo', label: 'GLO' },
  { key: '9mobile', label: '9mobile' },
];

const AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

export default function BuyAirtimeScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [phone, setPhone] = useState('');
  const [network, setNetwork] = useState('mtn');
  const [detectedNetwork, setDetectedNetwork] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');

  // Detect network when phone number is complete
  const detectNetwork = async (phoneNumber: string) => {
    if (phoneNumber.length === 11) {
      try {
        const res = await apiFetch('/api/v1/bills/detect-network', {
          method: 'POST',
          body: JSON.stringify({ phone: phoneNumber }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.validated && data.network) {
            setNetwork(data.network);
            setDetectedNetwork(data.network_name);
          }
        }
      } catch (error) {
        // Ignore detection errors
      }
    }
  };

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      const finalAmount = amount ?? (parseInt(customAmount) || 0);
      const res = await apiFetch('/api/v1/bills/airtime', {
        method: 'POST',
        body: JSON.stringify({
          phone,
          network,
          amount_naira: finalAmount,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Purchase failed');
      }
      return (await res.json()) as AirtimeResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      Alert.alert(
        t('bills.airtime.success_title'),
        t('bills.airtime.success_message', { amount: data.amount_naira, phone, points: data.points_earned }),
        [{ text: t('bills.airtime.ok'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      Alert.alert(t('bills.airtime.errors.purchase_failed'), error.message);
    },
  });

  const canSubmit = phone.length === 11 && (amount !== null || parseInt(customAmount) >= 50);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.airtime.title')}</Text>
        </View>

        {/* Phone */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.airtime.phone_label')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.airtime.phone_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={phone}
          onChangeText={(text) => {
            // Only allow numbers and format
            const cleaned = text.replace(/[^0-9]/g, '');
            setPhone(cleaned);
            detectNetwork(cleaned);
          }}
          keyboardType="phone-pad"
          maxLength={11}
        />
        {phone.length > 0 && phone.length < 11 && (
          <Text style={{ color: tokens.error, fontSize: 12, marginTop: -10 }}>
            {t('bills.airtime.errors.phone_invalid')}
          </Text>
        )}
        {detectedNetwork && (
          <Text style={{ color: tokens.mint, fontSize: 12, marginTop: -10 }}>
            ✓ {t('bills.airtime.detected', { network: detectedNetwork })}
          </Text>
        )}

        {/* Network */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.airtime.network_label')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {NETWORKS.map((n) => (
            <TouchableOpacity
              key={n.key}
              onPress={() => setNetwork(n.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: network === n.key ? tokens.mint : tokens.card,
                  borderColor: network === n.key ? tokens.mint : tokens.border,
                },
              ]}
            >
              <Text style={[
                styles.chipText,
                { color: network === n.key ? tokens.mintText : tokens.ink },
              ]}>{n.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Amount */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.airtime.amount_label')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {AMOUNTS.map((a) => {
            const rate = 0.03;
            const estPts = Math.floor(a * rate * 0.67 * 10);
            return (
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
                ]}>+{estPts} pts</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Custom Amount */}
        <Text style={[styles.label, { color: tokens.inkMuted, marginTop: 4 }]}>{t('bills.airtime.custom_amount')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.airtime.custom_amount')}
          placeholderTextColor={tokens.inkMuted}
          value={customAmount}
          onChangeText={(text) => {
            // Only allow numbers
            const cleaned = text.replace(/[^0-9]/g, '');
            setCustomAmount(cleaned);
            setAmount(null);
          }}
          keyboardType="number-pad"
          maxLength={6}
        />

        {/* Earn notice */}
        <View style={[styles.earnCard, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
          <Ionicons name="gift-outline" size={20} color={tokens.mint} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.earnLabel, { color: tokens.mint }]}>You'll earn points</Text>
            <Text style={[styles.earnSub, { color: tokens.ink }]}>
              Commission from the airtime purchase is split — you get points, we keep the platform running.
            </Text>
          </View>
        </View>

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
                {amount ? t('bills.airtime.buy_button') : t('bills.airtime.amount_required')}
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
  chip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  amtBtn: {
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, alignItems: 'center',
  },
  amtText: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  earnText: { fontSize: 11, fontWeight: '600', marginTop: 2 },
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
