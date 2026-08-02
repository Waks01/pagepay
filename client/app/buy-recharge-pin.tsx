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

export default function BuyRechargePinScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [network, setNetwork] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');

  const networksQ = useQuery({
    queryKey: ['airtime-networks'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/airtime/networks');
      if (!res.ok) throw new Error('Failed to load networks');
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
      if (!res.ok) throw new Error('Failed to load plans');
      return (await res.json()) as PinPlan[];
    },
    enabled: !!network,
  });

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSize) throw new Error(t('bills.recharge_pin.select_size'));
      const qty = parseInt(quantity) || 1;
      const res = await apiFetch('/api/v1/bills/recharge-pin', {
        method: 'POST',
        body: JSON.stringify({
          network,
          size: selectedSize,
          quantity: qty,
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
      Alert.alert(
        t('bills.recharge_pin.success_title'),
        t('bills.recharge_pin.success_message', { pins: data.pins?.join(', ') }),
        [{ text: t('bills.recharge_pin.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      Alert.alert(t('bills.recharge_pin.error_title'), error.message);
    },
  });

  const selectedPlan = plansQ.data?.find(p => p.size === selectedSize);
  const totalPrice = selectedPlan ? selectedPlan.regular_price * (parseInt(quantity) || 1) : 0;
  const canSubmit = !!network && !!selectedSize && parseInt(quantity) > 0;

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

        {/* Network */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.recharge_pin.network')}</Text>
        {networksQ.isLoading ? (
          <ActivityIndicator color={tokens.mint} />
        ) : (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(networksQ.data ?? []).map((n) => {
              const key = String(n.id);
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => { setNetwork(key); setSelectedSize(null); }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: network === key ? tokens.mint : tokens.card,
                      borderColor: network === key ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <Text style={[
                    styles.chipText,
                    { color: network === key ? tokens.mintText : tokens.ink },
                  ]}>{n.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Pin Size */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.recharge_pin.size')}</Text>
        {plansQ.isLoading ? (
          <ActivityIndicator color={tokens.mint} />
        ) : (
          <View style={{ gap: 8 }}>
            {(plansQ.data ?? []).map((p) => (
              <TouchableOpacity
                key={p.size}
                onPress={() => setSelectedSize(p.size)}
                style={[
                  styles.optionCard,
                  {
                    backgroundColor: selectedSize === p.size ? tokens.mintSoft : tokens.card,
                    borderColor: selectedSize === p.size ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionTitle, { color: tokens.ink }]}>
                    {p.network_name} ₦{p.size} PIN
                  </Text>
                  {!!p.info && (
                    <Text style={[styles.optionMeta, { color: tokens.inkMuted }]} numberOfLines={2}>
                      {p.info}
                    </Text>
                  )}
                </View>
                <Text style={[styles.optionPrice, { color: tokens.mint }]}>
                  ₦{p.regular_price.toLocaleString()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Quantity */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.recharge_pin.quantity')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          value={quantity}
          onChangeText={(text) => {
            const cleaned = text.replace(/[^0-9]/g, '');
            setQuantity(cleaned);
          }}
          keyboardType="number-pad"
          maxLength={3}
        />

        {/* Total */}
        {totalPrice > 0 && (
          <View style={[styles.totalCard, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
            <Text style={[styles.totalLabel, { color: tokens.inkMuted }]}>Total</Text>
            <Text style={[styles.totalValue, { color: tokens.mint }]}>
              ₦{totalPrice.toLocaleString()}
            </Text>
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
              <Ionicons name="card-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.payText, { color: tokens.mintText }]}>
                {totalPrice > 0 ? t('bills.recharge_pin.buy_button', { amount: totalPrice }) : t('bills.recharge_pin.select_prompt')}
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
  optionCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, padding: 14, borderWidth: 1, gap: 12,
  },
  optionTitle: { fontSize: 14, fontWeight: '600' },
  optionMeta: { fontSize: 11, marginTop: 2 },
  optionPrice: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  totalCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 12, padding: 14, borderWidth: 1,
  },
  totalLabel: { fontSize: 14, fontWeight: '500' },
  totalValue: { fontSize: 18, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});