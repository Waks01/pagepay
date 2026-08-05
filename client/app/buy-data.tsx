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
      qc.invalidateQueries({ queryKey: ['me'] });
      Alert.alert(
        t('bills.data.success_title'),
        t('bills.data.success_message', { plan: selectedPkg?.label, phone, points: data.points_earned }),
        [{ text: t('bills.data.ok'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      Alert.alert(t('bills.data.errors.purchase_failed'), error.message);
    },
  });

  const canSubmit = phone.length === 11 && selectedPlan !== null && selectedNetworkId !== null;

  const estPoints = selectedPkg
    ? Math.floor((selectedPkg.amount || 0) * 0.018 * 0.67 * 10)
    : 0;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
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
            <View style={{ flexDirection: 'row', gap: 8 }}>
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
                        backgroundColor: isActive ? tokens.mint : tokens.paper,
                        borderColor: isActive ? tokens.mint : tokens.border,
                      },
                    ]}
                  >
                    <Text style={[styles.segmentText, { color: isActive ? tokens.mintText : tokens.ink }]}>
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
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
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
            <View style={[styles.planGrid, { marginTop: 12 }]}>
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
                    <Text style={[styles.planType, { color: tokens.inkMuted }]}>{p.plantype}</Text>
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
                {selectedPkg ? t('bills.data.buy_button') : t('bills.data.select_plan')}
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
  plantypeTab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
  },
  plantypeTabText: { fontSize: 11, fontWeight: '600' },
  planGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
  },
  planCard: {
    width: '48%', padding: 12, borderRadius: 12, borderWidth: 1, gap: 4,
  },
  planType: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
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
});
