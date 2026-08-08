import { useState, useEffect } from 'react';
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

        {/* SECTION 1: ISP Provider (segmented control) */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.isp.provider')}</Text>
          <View style={styles.segmentedControl}>
            {(['smile', 'spectranet'] as IspType[]).map((type) => {
              const isActive = ispType === type;
              return (
                <TouchableOpacity
                  key={type}
                  onPress={() => {
                    setIspType(type);
                    setSelectedPlan(null);
                  }}
                  style={[
                    styles.segmentBtn,
                    {
                      backgroundColor: isActive ? tokens.card : 'transparent',
                      borderColor: isActive ? tokens.mint : 'transparent',
                      shadowColor: isActive ? '#000' : 'transparent',
                      shadowOpacity: isActive ? 0.08 : 0,
                      shadowRadius: isActive ? 4 : 0,
                    },
                  ]}
                >
                  <Ionicons
                    name="wifi-outline"
                    size={16}
                    color={isActive ? tokens.mint : tokens.inkMuted}
                  />
                  <Text style={[
                    styles.segmentText,
                    { color: isActive ? tokens.ink : tokens.inkMuted, textTransform: 'capitalize' },
                  ]}>{type}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* SECTION 2: Account Number */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.isp.account')}</Text>
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
        </View>

        {/* SECTION 3: Plans (2-col grid) */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.isp.plans')}</Text>
            {price > 0 && (
              <View style={[styles.earnBadge, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
                <Ionicons name="gift-outline" size={14} color={tokens.mint} />
                <Text style={[styles.earnBadgeText, { color: tokens.mint }]}>
                  +{Math.floor(price * 0.018 * 0.67 * 10)} pts
                </Text>
              </View>
            )}
          </View>
          {plansLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : plans.length === 0 ? (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t('bills.isp.no_plans')}
            </Text>
          ) : (
            <View style={styles.planGrid}>
              {plans.map((p) => {
                const id = String(p.id);
                const isActive = selectedPlan === id;
                const pPrice = parseInt(p.plan_price || '0');
                return (
                  <TouchableOpacity
                    key={id}
                    onPress={() => setSelectedPlan(id)}
                    style={[
                      styles.planCard,
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
                    <Text style={[styles.planName, { color: tokens.ink }]} numberOfLines={2}>
                      {p.name || `${p.size}GB`}
                    </Text>
                    {!!p.validity && (
                      <Text style={[styles.planValidity, { color: tokens.inkMuted }]} numberOfLines={1}>
                        {p.validity}
                      </Text>
                    )}
                    <Text style={[styles.planPrice, { color: tokens.mint }]}>
                      ₦{pPrice.toLocaleString()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

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
              <Text style={[styles.modalTitle, { color: tokens.ink }]}>Confirm Top-Up</Text>
              <View style={[styles.modalDivider, { backgroundColor: tokens.border }]} />
              <View style={{ gap: 12, marginVertical: 16 }}>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Provider</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink, textTransform: 'capitalize' }]}>
                    {ispType}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Plan</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>
                    {selectedPkg?.name || `${selectedPkg?.size}GB`}
                  </Text>
                </View>
                {selectedPkg?.validity && (
                  <View style={styles.modalRow}>
                    <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Validity</Text>
                    <Text style={[styles.modalValue, { color: tokens.ink }]}>
                      {selectedPkg.validity}
                    </Text>
                  </View>
                )}
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Account</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink, fontFamily: 'monospace' }]}>
                    {accountNumber}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Amount</Text>
                  <Text style={[styles.modalValue, { color: tokens.mint, fontWeight: '700' }]}>
                    ₦{price.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>You'll earn</Text>
                  <Text style={[styles.modalValue, { color: tokens.mint }]}>
                    +{Math.floor(price * 0.018 * 0.67 * 10)} pts
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
    borderRadius: 12, padding: 14, fontSize: 18, fontWeight: '600',
    borderWidth: 1,
  },
  inputIconValid: {
    position: 'absolute', right: 12, top: 14,
  },
  segmentedControl: {
    flexDirection: 'row', borderRadius: 10,
    padding: 3, gap: 2,
  },
  segmentBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  segmentText: { fontSize: 13, fontWeight: '600' },
  planGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12,
  },
  planCard: {
    width: '47%', padding: 12, borderRadius: 12, borderWidth: 1,
    gap: 4, position: 'relative',
  },
  planName: { fontSize: 13, fontWeight: '600', lineHeight: 1.3 },
  planValidity: { fontSize: 10, fontWeight: '500' },
  planPrice: { fontSize: 14, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold', marginTop: 2 },
  planCheck: {
    position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#0E7C66', alignItems: 'center', justifyContent: 'center',
  },
  earnBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  earnBadgeText: { fontSize: 12, fontWeight: '600' },
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