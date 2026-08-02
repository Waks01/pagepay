import { useState, useEffect } from 'react';
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

type IspPlan = {
  id: number;
  name: string;
  plan_volume: string;
  plan_price: string;
  size: number;
  validity: string | null;
  variation_code: string;
  plan_corporate_price: string | null;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
};

type IspType = 'smile' | 'spectranet';

export default function BuyIspScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [ispType, setIspType] = useState<IspType>('smile');
  const [accountNumber, setAccountNumber] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const smilePlansQ = useQuery({
    queryKey: ['smile-plans'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/isp/smile/plans');
      if (!res.ok) throw new Error('Failed to load Smile plans');
      return (await res.json()) as IspPlan[];
    },
  });

  const spectranetPlansQ = useQuery({
    queryKey: ['spectranet-plans'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/isp/spectranet/plans');
      if (!res.ok) throw new Error('Failed to load Spectranet plans');
      return (await res.json()) as IspPlan[];
    },
  });

  const plans = ispType === 'smile' ? (smilePlansQ.data ?? []) : (spectranetPlansQ.data ?? []);
  const plansLoading = ispType === 'smile' ? smilePlansQ.isLoading : spectranetPlansQ.isLoading;

  const selectedPkg = plans.find(p => String(p.id) === selectedPlan);

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!accountNumber) throw new Error('Enter account number');
      if (!selectedPlan) throw new Error('Select a plan');
      const endpoint = ispType === 'smile' ? '/api/v1/bills/isp/smile/topup' : '/api/v1/bills/isp/spectranet/topup';
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          account_number: accountNumber,
          plan_id: parseInt(selectedPlan),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Top-up failed');
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      Alert.alert(
        t('bills.isp.success_title'),
        t('bills.isp.success_message', { isp: ispType, points: data.points_earned }),
        [{ text: t('bills.isp.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      Alert.alert(t('bills.isp.error_title'), error.message);
    },
  });

  const price = selectedPkg ? parseInt(selectedPkg.plan_price || '0') : 0;
  const canSubmit = accountNumber.length >= 3 && !!selectedPlan;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.isp.title')}</Text>
        </View>

        {/* ISP Type */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.isp.provider')}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {(['smile', 'spectranet'] as IspType[]).map((type) => (
            <TouchableOpacity
              key={type}
              onPress={() => { setIspType(type); setSelectedPlan(null); }}
              style={[
                styles.typeCard,
                {
                  backgroundColor: ispType === type ? tokens.mintSoft : tokens.card,
                  borderColor: ispType === type ? tokens.mint : tokens.border,
                },
              ]}
            >
              <Ionicons name="wifi-outline" size={22} color={tokens.mint} />
              <Text style={[
                styles.chipText,
                { color: ispType === type ? tokens.mint : tokens.ink, textTransform: 'capitalize' },
              ]}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Account Number */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.isp.account')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.isp.account_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={accountNumber}
          onChangeText={setAccountNumber}
          keyboardType="number-pad"
          maxLength={20}
        />

        {/* Plans */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.isp.plans')}</Text>
        {plansLoading ? (
          <ActivityIndicator color={tokens.mint} />
        ) : (
          <ScrollView nestedScrollEnabled contentContainerStyle={{ gap: 8, maxHeight: 400 }}>
            {plans.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setSelectedPlan(String(p.id))}
                style={[
                  styles.planCard,
                  {
                    backgroundColor: selectedPlan === String(p.id) ? tokens.mintSoft : tokens.card,
                    borderColor: selectedPlan === String(p.id) ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: tokens.ink }]}>
                    {p.name || `${p.size}GB`}
                  </Text>
                  {!!p.validity && (
                    <Text style={[styles.planMeta, { color: tokens.inkMuted }]}>
                      {p.validity}
                    </Text>
                  )}
                </View>
                <Text style={[styles.planPrice, { color: tokens.mint }]}>
                  ₦{p.plan_price ? Number(p.plan_price).toLocaleString() : '0'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
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
              <Ionicons name="wifi-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.payText, { color: tokens.mintText }]}>
                {price > 0 ? t('bills.isp.topup_button', { amount: price }) : t('bills.isp.select_plan')}
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
  typeCard: {
    flex: 1, padding: 14, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', gap: 6,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  planCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, padding: 14, borderWidth: 1, gap: 12,
  },
  planName: { fontSize: 14, fontWeight: '600' },
  planMeta: { fontSize: 11, marginTop: 2 },
  planPrice: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});