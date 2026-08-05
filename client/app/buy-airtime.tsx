import { useState, useEffect, useMemo } from 'react';
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

type NetworkOption = {
  id: number;
  name: string;
};

const AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

export default function BuyAirtimeScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [phone, setPhone] = useState('');
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null);
  const [detectedNetwork, setDetectedNetwork] = useState<string | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [isDetecting, setIsDetecting] = useState(false);

  const networksQ = useQuery({
    queryKey: ['airtime-networks'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/airtime/networks');
      if (!res.ok) throw new Error(t('bills.airtime.load_error'));
      return (await res.json()) as NetworkOption[];
    },
  });

  const networkList = networksQ.data ?? [];

  useEffect(() => {
    if (!selectedNetworkId && networkList.length > 0) {
      setSelectedNetworkId(String(networkList[0].id));
    }
  }, [networkList, selectedNetworkId]);

  const detectNetwork = async (phoneNumber: string) => {
    if (phoneNumber.length !== 11) {
      setDetectedNetwork(null);
      return;
    }
    setIsDetecting(true);
    try {
      const res = await apiFetch('/api/v1/bills/detect-network', {
        method: 'POST',
        body: JSON.stringify({ phone: phoneNumber }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.validated && data.network) {
          const matched = networkList.find(n => String(n.id) === String(data.network));
          if (matched) {
            setSelectedNetworkId(String(matched.id));
            setDetectedNetwork(data.network_name || matched.name);
          }
        }
      }
    } catch (error) {
      // Silently ignore detection failures; user can still choose manually
    } finally {
      setIsDetecting(false);
    }
  };

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedNetworkId) throw new Error(t('bills.airtime.select_network'));
      const finalAmount = selectedAmount ?? (parseInt(customAmount, 10) || 0);
      const res = await apiFetch('/api/v1/bills/airtime', {
        method: 'POST',
        body: JSON.stringify({
          phone,
          network: selectedNetworkId,
          amount_naira: finalAmount,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t('bills.airtime.purchase_failed'));
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

  const canSubmit = useMemo(() => {
    const finalAmount = selectedAmount ?? (parseInt(customAmount, 10) || 0);
    return phone.length === 11 && selectedNetworkId !== null && finalAmount >= 50;
  }, [phone.length, selectedNetworkId, selectedAmount, customAmount]);

  const activeAmount = selectedAmount ?? (parseInt(customAmount, 10) || 0);

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
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.airtime.phone_label')}</Text>
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
              placeholder={t('bills.airtime.phone_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={phone}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, '');
                setPhone(cleaned);
                if (cleaned.length === 11) {
                  detectNetwork(cleaned);
                } else {
                  setDetectedNetwork(null);
                }
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
              {t('bills.airtime.errors.phone_invalid')}
            </Text>
          )}
          {detectedNetwork && (
            <Text style={{ color: tokens.mint, fontSize: 12, marginTop: 4, fontWeight: '600' }}>
              ✓ {t('bills.airtime.detected', { network: detectedNetwork })}
            </Text>
          )}
          {isDetecting && (
            <Text style={{ color: tokens.inkMuted, fontSize: 12, marginTop: 4 }}>
              Detecting network...
            </Text>
          )}
        </View>

        {/* Network */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.airtime.network_label')}</Text>
          {networksQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {networkList.map((n) => {
                const key = String(n.id);
                const isActive = selectedNetworkId === key;
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setSelectedNetworkId(key)}
                    style={[
                      styles.segmentBtn,
                      {
                        backgroundColor: isActive ? tokens.mint : tokens.paper,
                        borderColor: isActive ? tokens.mint : tokens.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        { color: isActive ? tokens.mintText : tokens.ink },
                      ]}
                    >
                      {n.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Amount */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.airtime.amount_label')}</Text>
            <View style={[styles.earnBadge, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
              <Ionicons name="gift-outline" size={14} color={tokens.mint} />
              <Text style={[styles.earnBadgeText, { color: tokens.mint }]}>
                +{Math.floor((activeAmount || 0) * 0.018 * 0.67 * 10)} pts
              </Text>
            </View>
          </View>
          <View style={[styles.planGrid, { marginTop: 12 }]}>
            {AMOUNTS.map((a) => {
              const estPts = Math.floor(a * 0.018 * 0.67 * 10);
              const isActive = selectedAmount === a;
              return (
                <TouchableOpacity
                  key={a}
                  onPress={() => { setSelectedAmount(a); setCustomAmount(''); }}
                  style={[
                    styles.planCard,
                    {
                      backgroundColor: isActive ? tokens.mintSoft : tokens.paper,
                      borderColor: isActive ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <Text style={[styles.planName, { color: tokens.ink }]}>₦{a.toLocaleString()}</Text>
                  <Text style={[styles.planPoints, { color: tokens.mint }]}>+{estPts}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Custom Amount */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.airtime.custom_amount')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: tokens.paper, color: tokens.ink, borderColor: tokens.border }]}
            placeholder={t('bills.airtime.custom_amount')}
            placeholderTextColor={tokens.inkMuted}
            value={customAmount}
            onChangeText={(text) => {
              const cleaned = text.replace(/[^0-9]/g, '');
              setCustomAmount(cleaned);
              setSelectedAmount(null);
            }}
            keyboardType="number-pad"
            maxLength={6}
          />
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
                {selectedAmount || activeAmount >= 50
                  ? t('bills.airtime.buy_button')
                  : t('bills.airtime.amount_required')}
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
  segmentBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: '600' },
  planGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
  },
  planCard: {
    width: '30%', minWidth: 100, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center', gap: 4,
  },
  planName: { fontSize: 14, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
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
});
