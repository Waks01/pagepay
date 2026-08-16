import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet,
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
  NetworkPicker,
  ConfirmModal,
  EarnBadge,
  PlanGrid,
} from '@/src/components/bills';
import { PagePaySpinner } from '@/components/PagePaySpinner';
import { Skeleton } from '@/components/Skeleton';

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
    return Array.from(new Set(all.map(p => p.plantype).filter(Boolean)));
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
          <View style={[styles.fullscreen, { paddingTop: insets.top, backgroundColor: tokens.paper }]}>
            <View style={[styles.successIcon, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
              <Ionicons name="checkmark" size={48} color={tokens.mint} />
            </View>
            <Text style={[styles.bigTitle, { color: tokens.ink }]}>{t('bills.data.success_title_big')}</Text>
            <SectionCard>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.data.confirm_network')}</Text>
                <Text style={[styles.summaryValue, { color: tokens.ink }]}>
                  {networkList.find(n => n.identifier === selectedNetworkId)?.name || selectedNetworkId}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: tokens.border }]} />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.data.confirm_plan')}</Text>
                <Text style={[styles.summaryValue, { color: tokens.ink }]}>{selectedPkg?.label || selectedPlan}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: tokens.border }]} />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.data.confirm_amount')}</Text>
                <Text style={[styles.summaryValue, { color: tokens.mint }]}>₦{selectedPkg?.amount.toLocaleString()}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: tokens.border }]} />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.data.confirm_phone')}</Text>
                <Text style={[styles.summaryValue, { color: tokens.ink }]}>{successData.phone}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: tokens.border }]} />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.data.points_earned_label')}</Text>
                <Text style={[styles.summaryValue, { color: tokens.mint }]}>+{successData.points_earned} pts</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: tokens.border }]} />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.data.reference_label')}</Text>
                <Text style={[styles.summaryValue, { color: tokens.ink, fontFamily: 'monospace' }]}>
                  {successData.reference.slice(0, 12)}...
                </Text>
              </View>
            </SectionCard>
            <TouchableOpacity onPress={handleSuccessDone} style={[styles.payBtn, { backgroundColor: tokens.mint }]}>
              <Text style={[styles.payText, { color: tokens.mintText }]}>{t('common.done')}</Text>
            </TouchableOpacity>
          </View>
        );

      case 'failed':
        return (
          <View style={[styles.fullscreen, { paddingTop: insets.top, backgroundColor: tokens.paper }]}>
            <View style={[styles.errorIcon, { backgroundColor: tokens.signalSoft, borderColor: tokens.signal }]}>
              <Ionicons name="close" size={48} color={tokens.signal} />
            </View>
            <Text style={[styles.bigTitle, { color: tokens.ink }]}>{t('bills.data.error_title_big')}</Text>
            <Text style={[styles.errorMessage, { color: tokens.inkMuted }]}>{errorMessage}</Text>
            <SectionCard>
              <Text style={[styles.errorNote, { color: tokens.inkMuted }]}>
                {t('bills.data.error_note')}
              </Text>
            </SectionCard>
            <TouchableOpacity onPress={handleRetry} style={[styles.payBtn, { backgroundColor: tokens.mint }]}>
              <Text style={[styles.payText, { color: tokens.mintText }]}>{t('common.try_again')}</Text>
            </TouchableOpacity>
          </View>
        );

      case 'processing':
        return (
          <View style={[styles.fullscreen, { paddingTop: insets.top, backgroundColor: tokens.paper }]}>
            <PagePaySpinner size={56} />
            <Text style={[styles.processingTitle, { color: tokens.ink }]}>{t('bills.data.processing_title')}</Text>
            <Text style={[styles.processingSub, { color: tokens.inkMuted }]}>
              {t('bills.data.processing_sub')}
            </Text>
            <View style={styles.skeletonGroup}>
              <Skeleton width="80%" height={14} borderRadius={7} marginBottom={12} />
              <Skeleton width="60%" height={12} borderRadius={6} marginBottom={8} />
              <Skeleton width="70%" height={12} borderRadius={6} />
            </View>
          </View>
        );
    }

    // idle — the form
    const networkOptions = networkList.map(n => ({ id: n.identifier, name: n.name }));

    return (
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.data.title')}</Text>
        </View>

        {/* SECTION 1: Phone */}
        <SectionCard label={t('bills.data.phone_label')}>
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
        </SectionCard>

        {/* SECTION 2: Network */}
        <SectionCard label={t('bills.data.network_label')}>
          {networksQ.isLoading ? (
            <PagePaySpinner size={32} />
          ) : (
            <NetworkPicker
              options={networkOptions}
              value={selectedNetworkId}
              onChange={(v) => {
                setSelectedNetworkId(v);
                setSelectedPlan(null);
              }}
            />
          )}
        </SectionCard>

        {/* SECTION 3: Plans (with plantype tabs) */}
        <SectionCard
          label={t('bills.data.plan_label')}
          accessory={selectedPkg ? <EarnBadge points={estPoints} /> : undefined}
        >
          {plantypeTabs.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {plantypeTabs.map(type => {
                const isActive = activePlantype === type;
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setActivePlantype(type)}
                    style={[
                      styles.plantypeTab,
                      {
                        backgroundColor: isActive ? tokens.mint : tokens.paper,
                        borderColor: isActive ? tokens.mint : tokens.border,
                      },
                    ]}
                  >
                    <Text style={[styles.plantypeTabText, { color: isActive ? tokens.mintText : tokens.ink }]}>
                      {type}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {plansQ.isLoading ? (
            <View style={{ paddingVertical: 32 }}>
              <PagePaySpinner size={32} />
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
            <PlanGrid
              items={filteredPlans}
              isActive={(p) => selectedPlan === p.plan_code}
              onSelect={(p) => setSelectedPlan(p.plan_code)}
              primary={(p) => p.label}
              secondary={(p) => p.plantype}
              tertiary={(p) => `₦${p.amount.toLocaleString()}`}
              emptyLabel={t('bills.data.no_plans')}
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
          {purchaseMutation.isPending ? (
            <PagePaySpinner size={20} />
          ) : (
            <>
              <Ionicons name="cart-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.payText, { color: tokens.mintText }]}>
                {selectedPkg ? t('bills.data.buy_button') : t('bills.data.select_plan')}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <ConfirmModal
          visible={showConfirmModal}
          title={t('bills.data.confirm_title')}
          rows={[
            { key: 'plan', label: t('bills.data.confirm_plan'), value: selectedPkg?.label ?? '' },
            { key: 'phone', label: t('bills.data.confirm_phone'), value: phone },
            { key: 'amt', label: t('bills.data.confirm_amount'), value: `₦${(selectedPkg?.amount || 0).toLocaleString()}`, valueColor: 'mint' as const },
            { key: 'pts', label: t('bills.data.confirm_points'), value: `+${estPoints} pts`, valueColor: 'mint' as const },
          ]}
          onCancel={() => setShowConfirmModal(false)}
          onConfirm={handleConfirmPurchase}
        />
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
  input: {
    borderRadius: 12, padding: 14, fontSize: 18, fontWeight: '600',
    borderWidth: 1,
  },
  inputIconValid: {
    position: 'absolute', right: 12, top: 14,
  },
  plantypeTab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
  },
  plantypeTabText: { fontSize: 11, fontWeight: '600' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, padding: 14, borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 13, fontWeight: '500' },
  retryBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  retryText: { fontSize: 13, fontWeight: '700' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  fullscreen: {
    flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center', gap: 24,
  },
  successIcon: {
    width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 2,
  },
  errorIcon: {
    width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 2,
  },
  bigTitle: { fontSize: 22, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  summaryKey: { fontSize: 13, fontWeight: '500' },
  summaryValue: { fontSize: 14, fontWeight: '600' },
  divider: { height: 1 },
  errorMessage: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  errorNote: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  processingTitle: { fontSize: 18, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  processingSub: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  skeletonGroup: { marginTop: 24, alignItems: 'center' },
});