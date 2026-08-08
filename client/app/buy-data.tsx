import { useState, useEffect, useMemo } from 'react';
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

type DataNetwork = {
  identifier: string;
  name: string;
};

type DataPlan = {
  plan_code: string;
  amount: number;
  label: string;
  plantype: string;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
  phone: string;
  customer_name: string | null;
};

type PurchaseState = 'idle' | 'processing' | 'success' | 'failed';

export default function BuyDataScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [phone, setPhone] = useState('');
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [activePlantype, setActivePlantype] = useState<string | null>(null);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>('idle');
  const [successData, setSuccessData] = useState<PurchaseResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const networksQ = useQuery({
    queryKey: ['data-networks'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/data/networks');
      if (!res.ok) throw new Error(t('bills.data.load_error'));
      return (await res.json()) as DataNetwork[];
    },
  });

  const networkList = networksQ.data ?? [];

  useEffect(() => {
    if (!selectedNetworkId && networkList.length > 0) {
      setSelectedNetworkId(networkList[0].identifier);
    }
  }, [networkList, selectedNetworkId]);

  const plansQ = useQuery({
    queryKey: ['data-plans', selectedNetworkId],
    queryFn: async () => {
      if (!selectedNetworkId) return [];
      const res = await apiFetch(`/api/v1/bills/data/plans?network=${encodeURIComponent(selectedNetworkId)}`);
      if (!res.ok) throw new Error(t('bills.data.load_error'));
      const data = (await res.json()) as DataPlan[];
      const types = Array.from(new Set(data.map(p => p.plantype).filter(Boolean)));
      if (types.length > 0 && !activePlantype) {
        setActivePlantype(types[0]);
      }
      return data;
    },
    enabled: !!selectedNetworkId,
  });

  const selectedPkg = useMemo(
    () => plansQ.data?.find(p => p.plan_code === selectedPlan),
    [plansQ.data, selectedPlan],
  );

  const filteredPlans = useMemo(() => {
    const all = plansQ.data ?? [];
    if (!activePlantype) return all;
    return all.filter(p => p.plantype === activePlantype);
  }, [plansQ.data, activePlantype]);

  const plantypeTabs = useMemo(() => {
    const all = plansQ.data ?? [];
    const types = Array.from(new Set(all.map(p => p.plantype).filter(Boolean)));
    return types;
  }, [plansQ.data]);

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPlan || !selectedPkg) throw new Error(t('bills.data.errors.plan_required'));
      if (!selectedNetworkId) throw new Error(t('bills.data.errors.network_required'));
      const res = await apiFetch('/api/v1/bills/data', {
        method: 'POST',
        body: JSON.stringify({ phone, network: selectedNetworkId, plan_code: selectedPlan }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t('bills.data.errors.purchase_failed'));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      setSuccessData(data);
      setPurchaseState('success');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
      setPurchaseState('failed');
    },
    onSettled: () => {
      // Reset processing state
    },
  });

  const handleBuyPress = () => {
    if (!canSubmit) return;
    setShowConfirmModal(true);
  };

  const handleConfirmPurchase = () => {
    setShowConfirmModal(false);
    setPurchaseState('processing');
    purchaseMutation.mutate();
  };

  const handleRetry = () => {
    setPurchaseState('idle');
    setErrorMessage('');
  };

  const handleSuccessDone = () => {
    setPurchaseState('idle');
    setSuccessData(null);
    setPhone('');
    setSelectedPlan(null);
    setActivePlantype(null);
  };

  const canSubmit = phone.length === 11 && selectedPlan !== null && selectedNetworkId !== null;

  const estPoints = selectedPkg
    ? Math.floor((selectedPkg.amount || 0) * 0.018 * 0.67 * 10)
    : 0;

  const renderContent = () => {
    switch (purchaseState) {
      case 'success':
        if (!successData) return null;
        return (
          <View style={{ flex: 1, paddingTop: insets.top, padding: 20, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <View style={[styles.successIcon, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
              <Ionicons name="checkmark" size={48} color={tokens.mint} />
            </View>
            <Text style={[styles.successTitle, { color: tokens.ink }]}>Purchase Successful!</Text>
            <View style={[styles.successCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Network</Text>
                <Text style={[styles.successValue, { color: tokens.ink }]}>
                  {networkList.find(n => n.identifier === selectedNetworkId)?.name || selectedNetworkId}
                </Text>
              </View>
              <View style={[styles.successDivider, { backgroundColor: tokens.border }]} />
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Plan</Text>
                <Text style={[styles.successValue, { color: tokens.ink }]}>{selectedPkg?.label || selectedPlan}</Text>
              </View>
              <View style={[styles.successDivider, { backgroundColor: tokens.border }]} />
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Amount</Text>
                <Text style={[styles.successValue, { color: tokens.mint }]}>₦{selectedPkg?.amount.toLocaleString()}</Text>
              </View>
              <View style={[styles.successDivider, { backgroundColor: tokens.border }]} />
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Phone</Text>
                <Text style={[styles.successValue, { color: tokens.ink }]}>{successData.phone}</Text>
              </View>
              <View style={[styles.successDivider, { backgroundColor: tokens.border }]} />
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Points Earned</Text>
                <Text style={[styles.successValue, { color: tokens.mint }]}>+{successData.points_earned} pts</Text>
              </View>
              <View style={[styles.successDivider, { backgroundColor: tokens.border }]} />
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Reference</Text>
                <Text style={[styles.successValue, { color: tokens.ink, fontFamily: 'monospace' }]}>
                  {successData.reference.slice(0, 12)}...
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={handleSuccessDone}
              style={[styles.doneBtn, { backgroundColor: tokens.mint }]}
            >
              <Text style={[styles.doneBtnText, { color: tokens.mintText }]}>Done</Text>
            </TouchableOpacity>
          </View>
        );

      case 'failed':
        return (
          <View style={{ flex: 1, paddingTop: insets.top, padding: 20, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <View style={[styles.errorIcon, { backgroundColor: tokens.signalSoft, borderColor: tokens.signal }]}>
              <Ionicons name="close" size={48} color={tokens.signal} />
            </View>
            <Text style={[styles.errorTitle, { color: tokens.ink }]}>Purchase Failed</Text>
            <Text style={[styles.errorMessage, { color: tokens.inkMuted }]}>{errorMessage}</Text>
            <View style={[styles.errorCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.errorNote, { color: tokens.inkMuted }]}>
                No points were deducted from your wallet. Please try again.
              </Text>
            </View>
            <TouchableOpacity onPress={handleRetry} style={[styles.retryBtn, { backgroundColor: tokens.mint }]}>
              <Text style={[styles.retryBtnText, { color: tokens.mintText }]}>Try Again</Text>
            </TouchableOpacity>
          </View>
        );

      case 'processing':
        return (
          <View style={{ flex: 1, paddingTop: insets.top, padding: 20, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <ActivityIndicator size="large" color={tokens.mint} />
            <Text style={[styles.processingTitle, { color: tokens.ink }]}>Processing Purchase...</Text>
            <Text style={[styles.processingSub, { color: tokens.inkMuted }]}>
              Please wait while we process your data purchase
            </Text>
          </View>
        );
    }

    // 'idle' state - show the form
    return (
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.data.title')}</Text>
        </View>

        {/* Phone */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.data.phone_label')}</Text>
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
              placeholder={t('bills.data.phone_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={phone}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, '').slice(0, 11);
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
              {t('bills.data.errors.phone_invalid')}
            </Text>
          )}
        </View>

        {/* Network */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.data.network_label')}</Text>
          {networksQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : (
            <View style={styles.segmentedControl}>
              {networkList.map(n => {
                const key = String(n.identifier);
                const isActive = selectedNetworkId === key;
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => { setSelectedNetworkId(key); setSelectedPlan(null); }}
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
                    <Text style={[styles.segmentText, { color: isActive ? tokens.ink : tokens.inkMuted }]}>
                      {n.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Plans */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.data.plan_label')}</Text>
            {selectedPkg && (
              <View style={[styles.earnBadge, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
                <Ionicons name="gift-outline" size={14} color={tokens.mint} />
                <Text style={[styles.earnBadgeText, { color: tokens.mint }]}>
                  +{estPoints} pts
                </Text>
              </View>
            )}
          </View>

          {/* Plantype tabs */}
          {plantypeTabs.length > 1 && (
            <View style={styles.plantypeTabsRow}>
              {plantypeTabs.map(type => (
                <TouchableOpacity
                  key={type}
                  onPress={() => setActivePlantype(type)}
                  style={[
                    styles.plantypeTab,
                    {
                      backgroundColor: activePlantype === type ? tokens.mint : tokens.paper,
                      borderColor: activePlantype === type ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <Text style={[styles.plantypeTabText, { color: activePlantype === type ? tokens.mintText : tokens.ink }]}>
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Plan grid */}
          {plansQ.isLoading ? (
            <View style={{ paddingVertical: 32 }}>
              <ActivityIndicator color={tokens.mint} />
            </View>
          ) : plansQ.isError ? (
            <View style={[styles.errorBox, { backgroundColor: tokens.signalSoft, borderColor: tokens.signal }]}>
              <Ionicons name="alert-circle-outline" size={20} color={tokens.signal} />
              <Text style={[styles.errorText, { color: tokens.signal }]}>
                {t('bills.data.load_error')}
              </Text>
              <TouchableOpacity onPress={() => plansQ.refetch()} style={styles.retryBtn}>
                <Text style={[styles.retryText, { color: tokens.mint }]}>
                  {t('common.retry')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : filteredPlans.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
                {t('bills.data.no_plans')}
              </Text>
            </View>
          ) : (
            <View style={styles.planGrid}>
              {filteredPlans.map(p => {
                const isActive = selectedPlan === p.plan_code;
                return (
                  <TouchableOpacity
                    key={p.plan_code}
                    onPress={() => setSelectedPlan(p.plan_code)}
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
                    <Text style={[styles.planValidity, { color: tokens.inkMuted }]}>{p.plantype}</Text>
                    <Text style={[styles.planName, { color: tokens.ink }]} numberOfLines={2}>
                      {p.label}
                    </Text>
                    <Text style={[styles.planPrice, { color: tokens.mint }]}>
                      ₦{p.amount.toLocaleString()}
                    </Text>
                    <Text style={[styles.planPoints, { color: tokens.mint }]}>
                      +{Math.floor(p.amount * 0.018 * 0.67 * 10)} pts
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
          {purchaseMutation.isPending ? (
            <ActivityIndicator color={tokens.mintText} />
          ) : (
            <>
              <Ionicons name="cart-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.payText, { color: tokens.mintText }]}>
                {selectedPkg ? t('bills.data.buy_button') : t('bills.data.select_plan')}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Confirm Modal */}
        <Modal
          visible={showConfirmModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowConfirmModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.modalTitle, { color: tokens.ink }]}>Confirm Purchase</Text>
              <View style={[styles.modalBody, { borderTopColor: tokens.border }]}>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Plan</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>{selectedPkg?.label}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Phone</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>{phone}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Amount</Text>
                  <Text style={[styles.modalValue, { color: tokens.mint }]}>₦{selectedPkg?.amount.toLocaleString()}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Points</Text>
                  <Text style={[styles.modalValue, { color: tokens.mint }]}>+{estPoints} pts</Text>
                </View>
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  onPress={() => setShowConfirmModal(false)}
                  style={[styles.modalBtn, styles.modalCancelBtn, { borderColor: tokens.border }]}
                >
                  <Text style={[styles.modalBtnText, { color: tokens.ink }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleConfirmPurchase}
                  style={[styles.modalBtn, { backgroundColor: tokens.mint }]}
                >
                  <Text style={[styles.modalBtnText, { color: tokens.mintText }]}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
      {renderContent()}
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
    flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3, gap: 2, borderWidth: 1, borderColor: '#E5E2DA',
  },
  segmentBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: '600' },
  plantypeTabsRow: {
    flexDirection: 'row', gap: 8, marginTop: 12,
  },
  plantypeTab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
  },
  plantypeTabText: { fontSize: 11, fontWeight: '600' },
  planGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12,
  },
  planCard: {
    width: '48%', padding: 12, borderRadius: 12, borderWidth: 1, gap: 4,
  },
  planCheck: {
    position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#0E7C66', alignItems: 'center', justifyContent: 'center',
  },
  planValidity: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  planName: { fontSize: 13, fontWeight: '600' },
  planPrice: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  planPoints: { fontSize: 11, fontWeight: '600' },
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
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, padding: 14, borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 13, fontWeight: '500' },
  retryBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  retryText: { fontSize: 13, fontWeight: '700' },
  // Success state
  successIcon: {
    width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 2,
  },
  successTitle: { fontSize: 22, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  successCard: {
    width: '100%', borderRadius: 16, borderWidth: 1, padding: 20, gap: 12,
  },
  successRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  successLabel: { fontSize: 13, fontWeight: '500' },
  successValue: { fontSize: 14, fontWeight: '600' },
  successDivider: { height: 1 },
  doneBtn: {
    width: '100%', padding: 16, borderRadius: 14, alignItems: 'center',
  },
  doneBtnText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  // Failed state
  errorIcon: {
    width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 2,
  },
  errorTitle: { fontSize: 22, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  errorMessage: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  errorCard: {
    width: '100%', borderRadius: 16, borderWidth: 1, padding: 16,
  },
  errorNote: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  retryBtnLarge: {
    width: '100%', padding: 16, borderRadius: 14, alignItems: 'center',
  },
  retryBtnText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  processingTitle: { fontSize: 18, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  processingSub: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', borderRadius: 20, borderWidth: 1, padding: 24, gap: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold', textAlign: 'center' },
  modalBody: { borderTopWidth: 1, paddingTop: 16, gap: 12 },
  modalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  modalKey: { fontSize: 13, fontWeight: '500' },
  modalValue: { fontSize: 14, fontWeight: '600' },
  modalActions: {
    flexDirection: 'row', gap: 12, marginTop: 8,
  },
  modalBtn: {
    flex: 1, padding: 14, borderRadius: 12, alignItems: 'center',
  },
  modalCancelBtn: {
    backgroundColor: 'transparent', borderWidth: 1,
  },
  modalBtnText: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});
