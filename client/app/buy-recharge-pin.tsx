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
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.recharge_pin.title')}</Text>
        </View>

        {/* SECTION 1: Network (segmented control, scrollable) */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.recharge_pin.network')}</Text>
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
        </View>

        {/* SECTION 2: Denomination (2-col grid) */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.recharge_pin.size')}</Text>
            {selectedPlan && (
              <View style={[styles.earnBadge, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
                <Ionicons name="gift-outline" size={14} color={tokens.mint} />
                <Text style={[styles.earnBadgeText, { color: tokens.mint }]}>
                  +{Math.floor(totalPrice * 0.018 * 0.67 * 10)} pts
                </Text>
              </View>
            )}
          </View>
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
        </View>

        {/* SECTION 3: Quantity (segmented control) */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.recharge_pin.quantity')}</Text>
          <View style={styles.segmentedControl}>
            {QUANTITY_OPTIONS.map((q) => {
              const isActive = quantity === q;
              return (
                <TouchableOpacity
                  key={q}
                  onPress={() => setQuantity(q)}
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
                    {q}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* SECTION 4: Summary */}
        {selectedPlan && (
          <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
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
          </View>
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
              <Text style={[styles.modalTitle, { color: tokens.ink }]}>Confirm Purchase</Text>
              <View style={[styles.modalDivider, { backgroundColor: tokens.border }]} />
              <View style={{ gap: 12, marginVertical: 16 }}>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Network</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>
                    {selectedPlan?.network_name}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Denomination</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>₦{selectedPlan?.size}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Quantity</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>× {quantity}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Unit Price</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>
                    ₦{(selectedPlan?.regular_price || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Total</Text>
                  <Text style={[styles.modalValue, { color: tokens.mint, fontWeight: '700' }]}>
                    ₦{totalPrice.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>You'll earn</Text>
                  <Text style={[styles.modalValue, { color: tokens.mint }]}>
                    +{Math.floor(totalPrice * 0.018 * 0.67 * 10)} pts
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
  segmentedControl: {
    flexDirection: 'row', borderRadius: 10,
    padding: 3, gap: 2, maxWidth: 360,
  },
  segmentBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: '600' },
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
  earnBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  earnBadgeText: { fontSize: 12, fontWeight: '600' },
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