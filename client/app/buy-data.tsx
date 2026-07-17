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

type DataNetwork = {
  identifier: string;
  name: string;
};

type DataPlan = {
  plan_code: string;
  amount: number;
  label: string;
};

type ValidityPeriod = 'daily' | 'weekly' | 'monthly';

// Helper to categorize plans by validity period from label
function categorizePlan(label: string): ValidityPeriod {
  const lower = label.toLowerCase();
  
  // Weekly plans explicitly say "WEEKLY"
  if (lower.includes('week')) {
    return 'weekly';
  }
  
  // Daily plans: 1DAY, 2DAYS, 3DAYS, etc (small numbers)
  if (lower.match(/\(?\d*\s*days?\)?/) && !lower.includes('week') && !lower.includes('month')) {
    // Extract the number of days if present
    const daysMatch = lower.match(/(\d+)\s*days?/);
    if (daysMatch) {
      const numDays = parseInt(daysMatch[1]);
      // 1-3 days are daily plans
      if (numDays <= 3) return 'daily';
      // 4-13 days could be considered weekly-ish but Peyflex doesn't have this
      // 7 days+ are usually treated as weekly bundles
      if (numDays >= 4 && numDays <= 13) return 'weekly';
    }
    // If "1DAY" or "2DAY" without number extraction
    if (lower.includes('1day') || lower.includes('2day') || lower.includes('3day')) {
      return 'daily';
    }
  }
  
  // Monthly/yearly plans
  if (lower.includes('month') || lower.includes('year')) {
    return 'monthly';
  }
  
  // Default to monthly
  return 'monthly';
}

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
  const [network, setNetwork] = useState('mtn_data_share');
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ValidityPeriod>('monthly');
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false);

  const networksQ = useQuery({
    queryKey: ['data-networks'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/data/networks');
      if (!res.ok) throw new Error('Failed to load networks');
      return (await res.json()) as DataNetwork[];
    },
  });

  const plansQ = useQuery({
    queryKey: ['data-plans', network],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/bills/data/plans?network=${encodeURIComponent(network)}`);
      if (!res.ok) throw new Error('Failed to load plans');
      return (await res.json()) as DataPlan[];
    },
    enabled: !!network,
  });

  const selectedPkg = plansQ.data?.find((p) => p.plan_code === selectedPlan);

  // Categorize plans by validity
  const categorizedPlans = (plansQ.data ?? []).reduce((acc, plan) => {
    const period = categorizePlan(plan.label);
    if (!acc[period]) acc[period] = [];
    acc[period].push(plan);
    return acc;
  }, {} as Record<ValidityPeriod, DataPlan[]>);

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPlan || !selectedPkg) throw new Error(t('bills.data.errors.plan_required'));
      const res = await apiFetch('/api/v1/bills/data', {
        method: 'POST',
        body: JSON.stringify({
          phone,
          network,
          plan_code: selectedPlan,
        }),
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

  const canSubmit = phone.length === 11 && selectedPlan !== null;
  
  // Points will come from backend response after purchase
  // For display, show "Earn cashback" without hardcoded calculation

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
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.data.phone_label')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.data.phone_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={phone}
          onChangeText={(text) => {
            // Only allow numbers
            const cleaned = text.replace(/[^0-9]/g, '');
            setPhone(cleaned);
          }}
          keyboardType="phone-pad"
          maxLength={11}
        />
        {phone.length > 0 && phone.length < 11 && (
          <Text style={{ color: tokens.error, fontSize: 12, marginTop: -10 }}>
            {t('bills.data.errors.phone_invalid')}
          </Text>
        )}

        {/* Network with better organization */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.data.network_label')}</Text>
        <TouchableOpacity
          onPress={() => setShowNetworkDropdown(!showNetworkDropdown)}
          style={[
            styles.dropdown,
            {
              backgroundColor: tokens.card,
              borderColor: tokens.border,
            },
          ]}
        >
          <Text style={[styles.dropdownText, { color: tokens.ink }]}>
            {networksQ.data?.find(n => n.identifier === network)?.name || t('bills.data.select_plan')}
          </Text>
          <Ionicons name={showNetworkDropdown ? "chevron-up" : "chevron-down"} size={20} color={tokens.inkMuted} />
        </TouchableOpacity>
        
        {showNetworkDropdown && (
          <View style={[styles.dropdownMenu, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            {networksQ.isLoading ? (
              <ActivityIndicator color={tokens.mint} />
            ) : (
              (networksQ.data ?? []).map((n) => (
                <TouchableOpacity
                  key={n.identifier}
                  onPress={() => {
                    setNetwork(n.identifier);
                    setSelectedPlan(null);
                    setShowNetworkDropdown(false);
                  }}
                  style={[
                    styles.dropdownItem,
                    network === n.identifier && { backgroundColor: tokens.mintSoft },
                  ]}
                >
                  <Text style={[
                    styles.dropdownItemText,
                    { color: network === n.identifier ? tokens.mint : tokens.ink },
                  ]}>
                    {n.name}
                  </Text>
                  {network === n.identifier && (
                    <Ionicons name="checkmark" size={20} color={tokens.mint} />
                  )}
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Plans with tabs */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.data.plan_label')}</Text>
        
        {/* Validity Tabs */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          {(['daily', 'weekly', 'monthly'] as ValidityPeriod[]).map((period) => {
            const count = categorizedPlans[period]?.length || 0;
            if (count === 0) return null;
            return (
              <TouchableOpacity
                key={period}
                onPress={() => setActiveTab(period)}
                style={[
                  styles.tab,
                  {
                    backgroundColor: activeTab === period ? tokens.mint : tokens.card,
                    borderColor: activeTab === period ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <Text style={[
                  styles.tabText,
                  { color: activeTab === period ? tokens.mintText : tokens.ink },
                ]}>
                  {period.charAt(0).toUpperCase() + period.slice(1)} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        
        {plansQ.isLoading ? (
          <ActivityIndicator color={tokens.mint} />
        ) : (
          <View style={{ gap: 8 }}>
            {(categorizedPlans[activeTab] ?? []).map((p) => {
              return (
                <TouchableOpacity
                  key={p.plan_code}
                  onPress={() => setSelectedPlan(p.plan_code)}
                  style={[
                    styles.bundleCard,
                    {
                      backgroundColor: selectedPlan === p.plan_code ? tokens.mintSoft : tokens.card,
                      borderColor: selectedPlan === p.plan_code ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.bundleName, { color: tokens.ink }]}>
                      {p.label}
                    </Text>
                    <Text style={[styles.bundlePoints, { color: tokens.mint }]}>
                      💰 Earn cashback points
                    </Text>
                  </View>
                  <Text style={[styles.bundlePrice, { color: tokens.mint }]}>
                    ₦{p.amount.toLocaleString()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Earn notice */}
        {selectedPkg && (
          <View style={[styles.earnCard, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
            <Ionicons name="gift-outline" size={20} color={tokens.mint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.earnLabel, { color: tokens.mint }]}>You'll earn cashback points!</Text>
              <Text style={[styles.earnSub, { color: tokens.ink }]}>
                Real commission from Peyflex will be credited after purchase (varies by network).
              </Text>
            </View>
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
  label: { fontSize: 13, fontWeight: '500' },
  input: {
    borderRadius: 12, padding: 14, fontSize: 18, fontWeight: '600',
    borderWidth: 1,
  },
  chip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  dropdownText: { fontSize: 15, fontWeight: '600' },
  dropdownMenu: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: -8,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e5e5',
  },
  dropdownItemText: { fontSize: 14, fontWeight: '500' },
  tab: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, flex: 1, alignItems: 'center',
  },
  tabText: { fontSize: 12, fontWeight: '600' },
  bundleCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, padding: 14, borderWidth: 1,
  },
  bundleName: { fontSize: 13, fontWeight: '500' },
  bundlePoints: { fontSize: 11, fontWeight: '600', marginTop: 3 },
  bundlePrice: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  earnCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, padding: 14, borderWidth: 1, marginTop: 4,
  },
  earnLabel: { fontSize: 14, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  earnSub: { fontSize: 12, marginTop: 2 },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});
