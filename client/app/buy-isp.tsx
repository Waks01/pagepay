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
import {
  SectionCard,
  SegmentedControl,
  PlanGrid,
  ConfirmModal,
  EarnBadge,
  ErrorBanner,
} from '@/src/components/bills';

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
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const smilePlansQ = useQuery({
    queryKey: ['smile-plans'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/isp/smile/plans');
      if (!res.ok) throw new Error(t('bills.isp.load_smile_error'));
      return (await res.json()) as IspPlan[];
    },
  });

  const spectranetPlansQ = useQuery({
    queryKey: ['spectranet-plans'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/isp/spectranet/plans');
      if (!res.ok) throw new Error(t('bills.isp.load_spectranet_error'));
      return (await res.json()) as IspPlan[];
    },
  });

  const plans = ispType === 'smile' ? (smilePlansQ.data ?? []) : (spectranetPlansQ.data ?? []);
  const plansLoading = ispType === 'smile' ? smilePlansQ.isLoading : spectranetPlansQ.isLoading;

  const selectedPkg = plans.find(p => String(p.id) === selectedPlan);
  const price = selectedPkg ? parseInt(selectedPkg.plan_price || '0') : 0;
  const canSubmit = accountNumber.length >= 3 && !!selectedPlan;

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!accountNumber) throw new Error(t('bills.isp.enter_account'));
      if (!selectedPlan) throw new Error(t('bills.isp.select_plan'));
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
        throw new Error(err.detail || t('bills.isp.topup_failed'));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      setShowConfirmModal(false);
      Alert.alert(
        t('bills.isp.success_title'),
        t('bills.isp.success_message', { isp: ispType, points: data.points_earned }),
        [{ text: t('bills.isp.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      setShowConfirmModal(false);
      setPurchaseError(error.message);
    },
  });

  const handleBuyPress = () => {
    if (!canSubmit) return;
    setPurchaseError(null);
    setShowConfirmModal(true);
  };

  const ispOptions: { value: IspType; label: string; icon: 'wifi-outline' }[] = [
    { value: 'smile', label: 'smile', icon: 'wifi-outline' },
    { value: 'spectranet', label: 'spectranet', icon: 'wifi-outline' },
  ];

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

        {/* SECTION 1: ISP Provider */}
        <SectionCard label={t('bills.isp.provider')}>
          <SegmentedControl
            options={ispOptions}
            value={ispType}
            onChange={(v) => {
              setIspType(v);
              setSelectedPlan(null);
            }}
          />
        </SectionCard>

        {/* SECTION 2: Account Number */}
        <SectionCard label={t('bills.isp.account')}>
          <View style={{ position: 'relative' }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: tokens.paper,
                  color: tokens.ink,
                  borderColor: accountNumber.length >= 3 ? tokens.mint : tokens.border,
                },
              ]}
              placeholder={t('bills.isp.account_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={accountNumber}
              onChangeText={setAccountNumber}
              keyboardType="number-pad"
              maxLength={20}
            />
            {accountNumber.length >= 3 && (
              <View style={styles.inputIconValid}>
                <Ionicons name="checkmark-circle" size={20} color={tokens.mint} />
              </View>
            )}
          </View>
        </SectionCard>

        {/* SECTION 3: Plans (2-col grid) */}
        <SectionCard
          label={t('bills.isp.plans')}
          accessory={price > 0 ? <EarnBadge points={Math.floor(price * 0.018 * 0.67 * 10)} /> : undefined}
        >
          {plansLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : (
            <PlanGrid
              items={plans}
              isActive={(p) => String(p.id) === selectedPlan}
              onSelect={(p) => setSelectedPlan(String(p.id))}
              primary={(p) => p.name || `${p.size}GB`}
              secondary={(p) => p.validity ?? undefined}
              tertiary={(p) => `₦${parseInt(p.plan_price || '0').toLocaleString()}`}
              emptyLabel={t('bills.isp.no_plans')}
            />
          )}
        </SectionCard>

        {/* Pay button */}
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
          <Ionicons name="wifi-outline" size={20} color={tokens.mintText} />
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {price > 0
              ? t('bills.isp.topup_button_with_amount', { amount: price })
              : t('bills.isp.select_plan_prompt')}
          </Text>
        </TouchableOpacity>

        <ErrorBanner message={purchaseError ?? ''} onDismiss={() => setPurchaseError(null)} />

        <ConfirmModal
          visible={showConfirmModal}
          title="Confirm Top-Up"
          confirming={purchaseMutation.isPending}
          rows={[
            { key: 'prov', label: 'Provider', value: ispType, valueStyle: { textTransform: 'capitalize' } },
            { key: 'plan', label: 'Plan', value: selectedPkg?.name || `${selectedPkg?.size}GB` || '' },
            ...(selectedPkg?.validity ? [{ key: 'val', label: 'Validity', value: selectedPkg.validity }] : []),
            { key: 'acct', label: 'Account', value: accountNumber, valueStyle: { fontFamily: 'monospace' } },
            { key: 'amt', label: 'Amount', value: `₦${price.toLocaleString()}`, valueColor: 'mint' as const },
            { key: 'earn', label: "You'll earn", value: `+${Math.floor(price * 0.018 * 0.67 * 10)} pts`, valueColor: 'mint' as const },
          ]}
          onCancel={() => setShowConfirmModal(false)}
          onConfirm={() => purchaseMutation.mutate()}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  input: {
    borderRadius: 12, padding: 14, fontSize: 18, fontWeight: '600',
    borderWidth: 1,
  },
  inputIconValid: {
    position: 'absolute', right: 12, top: 14,
  },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});
