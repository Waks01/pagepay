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
import {
  SectionCard,
  SegmentedControl,
  ConfirmModal,
  EarnBadge,
  ErrorBanner,
} from '@/src/components/bills';

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

type ValidateResult = {
  customer_name: string | null;
  address: string | null;
  validated: boolean;
  message?: string;
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
  const [planId, setPlanId] = useState<string | null>(null);
  const [meterType, setMeterType] = useState<'prepaid' | 'postpaid'>('prepaid');
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [validatedName, setValidatedName] = useState<string | null>(null);
  const [validatedAddress, setValidatedAddress] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const discosQ = useQuery({
    queryKey: ['electricity-plans'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/electricity/plans');
      if (!res.ok) throw new Error(t('bills.electricity.load_error'));
      return (await res.json()) as Disco[];
    },
  });

  useEffect(() => {
    if (!planId && discosQ.data && discosQ.data.length > 0) {
      const first = discosQ.data[0];
      setPlanId(first.code || first.plan_code || '');
    }
  }, [discosQ.data, planId]);

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!planId || !meterNumber) throw new Error(t('bills.electricity.meter_required'));
      const res = await apiFetch('/api/v1/bills/validate-meter', {
        method: 'POST',
        body: JSON.stringify({ meter_number: meterNumber, plan_id: planId, meter_type: meterType }),
      });
      if (!res.ok) throw new Error(t('bills.electricity.errors.validation_failed'));
      return (await res.json()) as ValidateResult;
    },
    onSuccess: (data) => {
      if (data.validated && data.customer_name) {
        setValidatedName(data.customer_name);
        setValidatedAddress(data.address);
      } else {
        setValidatedName(null);
        setValidatedAddress(null);
      }
    },
    onError: () => {
      setValidatedName(null);
      setValidatedAddress(null);
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
      setShowConfirmModal(false);
      const finalAmount = amount ?? (parseInt(customAmount) || 0);
      Alert.alert(
        t('bills.electricity.success_title'),
        data.token
          ? `Token: ${data.token}${data.units ? `\n${data.units}` : ''}\n\nYou earned ${data.points_earned} points.`
          : t('bills.electricity.success_message', { amount: finalAmount, meter: meterNumber, points: data.points_earned }),
        [{ text: t('bills.electricity.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      setShowConfirmModal(false);
      setPurchaseError(error.message);
    },
  });

  const finalAmount = amount ?? (parseInt(customAmount) || 0);
  const canSubmit = meterNumber.length >= 10 && phone.length === 11 && finalAmount >= 1000;
  const estPoints = finalAmount ? Math.floor(finalAmount * 0.012 * 0.67 * 10) : 0;

  const handleBuyPress = () => {
    if (!canSubmit) return;
    setPurchaseError(null);
    setShowConfirmModal(true);
  };

  const meterTypeOptions = [
    { value: 'prepaid' as const, label: t('bills.electricity.prepaid'), icon: 'keypad-outline' as const },
    { value: 'postpaid' as const, label: t('bills.electricity.postpaid'), icon: 'receipt-outline' as const },
  ];

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

        {/* SECTION 1: DISCO + Meter Type */}
        <SectionCard label={t('bills.electricity.disco')}>
          {discosQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : discosQ.data && discosQ.data.length > 0 ? (
            <View style={styles.discoGrid}>
              {(discosQ.data ?? []).map((d) => {
                const id = d.plan_code ?? d.code ?? '';
                const name = d.plan_name ?? d.name ?? '';
                const isActive = planId === id;
                return (
                  <TouchableOpacity
                    key={id}
                    onPress={() => { setPlanId(id); setValidatedName(null); setValidatedAddress(null); }}
                    style={[
                      styles.discoChip,
                      {
                        backgroundColor: isActive ? tokens.mintSoft : tokens.paper,
                        borderColor: isActive ? tokens.mint : tokens.border,
                      },
                    ]}
                  >
                    <Text style={[
                      styles.discoChipText,
                      { color: isActive ? tokens.mint : tokens.ink },
                    ]}>
                      {name.split('(')[0].trim()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t('bills.electricity.no_discos')}
            </Text>
          )}

          <View style={{ marginTop: 12 }}>
            <Text style={[styles.subLabel, { color: tokens.inkMuted }]}>
              {t('bills.electricity.meter_type')}
            </Text>
            <SegmentedControl
              options={meterTypeOptions}
              value={meterType}
              onChange={(v) => {
                setMeterType(v);
                setValidatedName(null);
                setValidatedAddress(null);
              }}
            />
          </View>
        </SectionCard>

        {/* SECTION 2: Meter Number + Validate */}
        <SectionCard label={t('bills.electricity.meter_number')}>
          <View style={{ position: 'relative' }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: tokens.paper,
                  color: tokens.ink,
                  borderColor: meterNumber.length >= 10 ? tokens.mint : tokens.border,
                },
              ]}
              placeholder={t('bills.electricity.meter_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={meterNumber}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, '');
                setMeterNumber(cleaned);
                setValidatedName(null);
                setValidatedAddress(null);
              }}
              keyboardType="number-pad"
              maxLength={20}
            />
            {validatedName && (
              <View style={styles.inputIconValid}>
                <Ionicons name="checkmark-circle" size={20} color={tokens.mint} />
              </View>
            )}
          </View>
          {meterNumber.length > 0 && meterNumber.length < 10 && (
            <Text style={{ color: tokens.error, fontSize: 12, marginTop: 4 }}>
              {t('bills.electricity.meter_error')}
            </Text>
          )}

          <TouchableOpacity
            onPress={() => validateMutation.mutate()}
            disabled={meterNumber.length < 10 || !planId || validateMutation.isPending}
            style={[
              styles.validateBtn,
              {
                backgroundColor: tokens.mintSoft,
                borderColor: tokens.mint,
                opacity: (meterNumber.length < 10 || !planId || validateMutation.isPending) ? 0.5 : 1,
              },
            ]}
          >
            {validateMutation.isPending ? (
              <ActivityIndicator size="small" color={tokens.mint} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={16} color={tokens.mint} />
                <Text style={[styles.validateText, { color: tokens.mint }]}>
                  {t('bills.electricity.validate_button')}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {validatedName && (
            <View style={{ marginTop: 8, gap: 2 }}>
              <Text style={{ color: tokens.mint, fontSize: 13, fontWeight: '600' }}>
                ✓ {validatedName}
              </Text>
              {validatedAddress && (
                <Text style={{ color: tokens.inkMuted, fontSize: 11 }}>
                  {validatedAddress}
                </Text>
              )}
              <Text style={{ color: tokens.inkMuted, fontSize: 10, fontStyle: 'italic' }}>
                {t('bills.electricity.verified_via')}
              </Text>
            </View>
          )}
        </SectionCard>

        {/* SECTION 3: Phone */}
        <SectionCard label={t('bills.electricity.phone')}>
          <View style={{ position: 'relative' }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: tokens.paper,
                  color: tokens.ink,
                  borderColor: phone.length === 11 ? tokens.mint : tokens.border,
                },
              ]}
              placeholder={t('bills.electricity.phone_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={phone}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, '');
                setPhone(cleaned);
              }}
              keyboardType="phone-pad"
              maxLength={11}
            />
            {phone.length === 11 && (
              <View style={styles.inputIconValid}>
                <Ionicons name="checkmark-circle" size={20} color={tokens.mint} />
              </View>
            )}
          </View>
          {phone.length > 0 && phone.length < 11 && (
            <Text style={{ color: tokens.error, fontSize: 12, marginTop: 4 }}>
              {t('bills.electricity.phone_error')}
            </Text>
          )}
        </SectionCard>

        {/* SECTION 4: Amount + custom */}
        <SectionCard
          label={t('bills.electricity.amount')}
          accessory={finalAmount >= 1000 ? <EarnBadge points={estPoints} /> : undefined}
        >
          <View style={styles.amountGrid}>
            {AMOUNTS.map((a) => {
              const isActive = amount === a;
              return (
                <TouchableOpacity
                  key={a}
                  onPress={() => { setAmount(a); setCustomAmount(''); }}
                  style={[
                    styles.amountCard,
                    {
                      backgroundColor: isActive ? tokens.mintSoft : tokens.paper,
                      borderColor: isActive ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  {isActive && (
                    <View style={styles.planCheck}>
                      <Ionicons name="checkmark" size={10} color="#fff" />
                    </View>
                  )}
                  <Text style={[styles.amountValue, { color: tokens.ink }]}>₦{a.toLocaleString()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: tokens.paper,
                color: tokens.ink,
                borderColor: customAmount ? tokens.mint : tokens.border,
                marginTop: 12,
              },
            ]}
            placeholder={t('bills.electricity.custom_placeholder')}
            placeholderTextColor={tokens.inkMuted}
            value={customAmount}
            onChangeText={(text) => {
              const cleaned = text.replace(/[^0-9]/g, '');
              setCustomAmount(cleaned);
              setAmount(null);
            }}
            keyboardType="number-pad"
            maxLength={7}
          />
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
          <Ionicons name="cart-outline" size={20} color={tokens.mintText} />
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {finalAmount >= 1000
              ? t('bills.electricity.pay_button', { amount: finalAmount })
              : t('bills.electricity.min_amount_prompt')}
          </Text>
        </TouchableOpacity>

        <ErrorBanner message={purchaseError ?? ''} onDismiss={() => setPurchaseError(null)} />

        <ConfirmModal
          visible={showConfirmModal}
          title="Confirm Purchase"
          confirming={purchaseMutation.isPending}
          rows={[
            { key: 'meter', label: 'Meter', value: meterNumber, valueStyle: { fontFamily: 'monospace' } },
            ...(validatedName ? [{ key: 'cust', label: 'Customer', value: validatedName }] : []),
            { key: 'type', label: 'Type', value: t(`bills.electricity.${meterType}`) },
            { key: 'phone', label: 'Phone', value: phone },
            { key: 'amt', label: 'Amount', value: `₦${finalAmount.toLocaleString()}`, valueColor: 'mint' as const },
            { key: 'earn', label: "You'll earn", value: `+${estPoints} pts`, valueColor: 'mint' as const },
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
  subLabel: { fontSize: 13, fontWeight: '500', marginBottom: 8 },
  input: {
    borderRadius: 12, padding: 14, fontSize: 18, fontWeight: '600',
    borderWidth: 1,
  },
  inputIconValid: {
    position: 'absolute', right: 12, top: 14,
  },
  discoGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  discoChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  discoChipText: { fontSize: 12, fontWeight: '600' },
  validateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4,
  },
  validateText: { fontSize: 14, fontWeight: '600' },
  amountGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12,
  },
  amountCard: {
    width: '30%', minWidth: 100, padding: 12, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', position: 'relative',
  },
  amountValue: { fontSize: 14, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  planCheck: {
    position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#0E7C66', alignItems: 'center', justifyContent: 'center',
  },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});
