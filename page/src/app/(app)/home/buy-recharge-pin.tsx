import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, StyleSheet, RefreshControl,
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
  EarnBadge,
  ConfirmModal,
  ErrorBanner,
  BuyScreenSkeleton,
} from '@/src/components/bills';

type NetworkOption = {
  id: number;
  name: string;
};

type PinPlan = {
  id: number;
  network: number;
  network_name: string;
  size: string;
  regular_price: number;
  corporate_price: number;
  info: string;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
  pins: string[];
};

const QUANTITY_OPTIONS = [1, 2, 3, 5, 10];

export default function BuyRechargePinScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [network, setNetwork] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const networksQ = useQuery({
    queryKey: ['airtime-networks'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/airtime/networks');
      if (!res.ok) throw new Error(t('bills.recharge_pin.load_networks_error'));
      return (await res.json()) as NetworkOption[];
    },
  });

  useEffect(() => {
    if (!network && networksQ.data && networksQ.data.length > 0) {
      setNetwork(String(networksQ.data[0].id));
    }
  }, [networksQ.data, network]);

  const plansQ = useQuery({
    queryKey: ['recharge-pin-plans', network],
    queryFn: async () => {
      if (!network) return [];
      const res = await apiFetch(`/api/v1/bills/recharge-pin/plans?network=${network}`);
      if (!res.ok) throw new Error(t('bills.recharge_pin.load_plans_error'));
      return (await res.json()) as PinPlan[];
    },
    enabled: !!network,
  });

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSize) throw new Error(t('bills.recharge_pin.select_size'));
      const res = await apiFetch('/api/v1/bills/recharge-pin', {
        method: 'POST',
        body: JSON.stringify({
          network,
          size: selectedSize,
          quantity: quantity,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t('bills.recharge_pin.purchase_failed'));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      setShowConfirmModal(false);
      Alert.alert(
        t('bills.recharge_pin.success_title'),
        t('bills.recharge_pin.success_message', { pins: data.pins?.join(', ') }),
        [{ text: t('bills.recharge_pin.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      setShowConfirmModal(false);
      setPurchaseError(error.message);
    },
  });

  const selectedPlan = plansQ.data?.find(p => p.size === selectedSize);
  const totalPrice = selectedPlan ? selectedPlan.regular_price * quantity : 0;
  const canSubmit = !!network && !!selectedSize && quantity > 0;
  const estPoints = totalPrice ? Math.floor(totalPrice * 0.018 * 0.67 * 10) : 0;

  const handleBuyPress = () => {
    if (!canSubmit) return;
    setPurchaseError(null);
    setShowConfirmModal(true);
  };

  const quantityOptions = QUANTITY_OPTIONS.map(q => ({
    value: q,
    label: String(q),
  }));

  // Initial-load gate: the form needs the network catalog before the
  // network picker is usable. plansQ only fetches once a network is
  // selected, so it isn't part of the first-paint gate.
  if (networksQ.isLoading) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <BuyScreenSkeleton sections={3} />
      </View>
    );
  }

  // Pull-to-refresh: refetch the networks catalog.
  const onRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['airtime-networks'] });
  }, [qc]);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={networksQ.isFetching}
            onRefresh={onRefresh}
            tintColor={tokens.mint}
          />
        }
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.recharge_pin.title')}</Text>
        </View>

        {/* SECTION 1: Network (segmented chips) */}
        <SectionCard label={t('bills.recharge_pin.network')}>
          {networksQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : (networksQ.data ?? []).length === 0 ? (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t('bills.recharge_pin.no_networks')}
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {(networksQ.data ?? []).map((n) => {
                const key = String(n.id);
                const isActive = network === key;
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => {
                      setNetwork(key);
                      setSelectedSize(null);
                    }}
                    style={[
                      styles.segmentChip,
                      {
                        backgroundColor: isActive ? tokens.mint : tokens.paper,
                        borderColor: isActive ? tokens.mint : tokens.border,
                      },
                    ]}
                  >
                    <Text style={[
                      styles.segmentChipText,
                      { color: isActive ? tokens.mintText : tokens.ink },
                    ]}>{n.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </SectionCard>

        {/* SECTION 2: Denomination (2-col grid) */}
        <SectionCard
          label={t('bills.recharge_pin.size')}
          accessory={selectedPlan ? <EarnBadge points={estPoints} /> : undefined}
        >
          {plansQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : (plansQ.data ?? []).length === 0 ? (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t('bills.recharge_pin.no_plans')}
            </Text>
          ) : (
            <View style={styles.denGrid}>
              {(plansQ.data ?? []).map((p) => {
                const isActive = selectedSize === p.size;
                return (
                  <TouchableOpacity
                    key={p.size}
                    onPress={() => setSelectedSize(p.size)}
                    style={[
                      styles.denCard,
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
                    <Text style={[styles.denSize, { color: tokens.ink }]}>₦{p.size}</Text>
                    <Text style={[styles.denMeta, { color: tokens.inkMuted }]} numberOfLines={1}>
                      {p.network_name}
                    </Text>
                    <Text style={[styles.denPrice, { color: tokens.mint }]}>
                      ₦{p.regular_price.toLocaleString()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </SectionCard>

        {/* SECTION 3: Quantity (segmented control) */}
        <SectionCard label={t('bills.recharge_pin.quantity')}>
          <SegmentedControl
            options={quantityOptions}
            value={quantity}
            onChange={setQuantity}
          />
        </SectionCard>

        {/* SECTION 4: Summary */}
        {selectedPlan && (
          <SectionCard>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.recharge_pin.denomination_label')}</Text>
              <Text style={[styles.summaryValue, { color: tokens.ink }]}>
                ₦{selectedPlan.size} × {quantity}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: tokens.border }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.recharge_pin.total')}</Text>
              <Text style={[styles.summaryValue, { color: tokens.mint, fontWeight: '700' }]}>
                ₦{totalPrice.toLocaleString()}
              </Text>
            </View>
          </SectionCard>
        )}

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
          <Ionicons name="card-outline" size={20} color={tokens.mintText} />
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {totalPrice > 0
              ? t('bills.recharge_pin.buy_button_with_amount', { amount: totalPrice })
              : t('bills.recharge_pin.select_prompt')}
          </Text>
        </TouchableOpacity>

        <ErrorBanner message={purchaseError ?? ''} onDismiss={() => setPurchaseError(null)} />

        <ConfirmModal
          visible={showConfirmModal}
          title={t('bills.recharge_pin.confirm_title')}
          confirming={purchaseMutation.isPending}
          rows={[
            { key: 'net', label: t('bills.recharge_pin.confirm_network'), value: selectedPlan?.network_name ?? '' },
            { key: 'den', label: t('bills.recharge_pin.confirm_denomination'), value: `₦${selectedPlan?.size ?? ''}` },
            { key: 'qty', label: t('bills.recharge_pin.confirm_quantity'), value: `× ${quantity}` },
            { key: 'unit', label: t('bills.recharge_pin.confirm_unit_price'), value: `₦${(selectedPlan?.regular_price || 0).toLocaleString()}` },
            { key: 'amt', label: t('bills.recharge_pin.confirm_total'), value: `₦${totalPrice.toLocaleString()}`, valueColor: 'mint' as const },
            { key: 'earn', label: t('bills.recharge_pin.confirm_earn_label'), value: `+${estPoints} pts`, valueColor: 'mint' as const },
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
  segmentChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1,
  },
  segmentChipText: { fontSize: 13, fontWeight: '600' },
  denGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4,
  },
  denCard: {
    width: '47%', padding: 12, borderRadius: 12, borderWidth: 1,
    gap: 4, position: 'relative',
  },
  denSize: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  denMeta: { fontSize: 10, fontWeight: '500' },
  denPrice: { fontSize: 13, fontWeight: '600' },
  planCheck: {
    position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#0E7C66', alignItems: 'center', justifyContent: 'center',
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
});
