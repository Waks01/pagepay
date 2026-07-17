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

type Bouquet = {
  id?: string;
  plan_id?: string;
  plan_code?: string;
  provider?: string;
  name?: string;
  price_naira?: number;
  amount?: number;
  channels?: string | null;
  commission_rate?: number;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
  customer_name: string | null;
};

const PROVIDERS = [
  { key: 'dstv', label: 'DStv' },
  { key: 'gotv', label: 'GOtv' },
  { key: 'startimes', label: 'Startimes' },
];

export default function BuyTvScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [smartcard, setSmartcard] = useState('');
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState('dstv');
  const [selectedBouquet, setSelectedBouquet] = useState<string | null>(null);

  const bouquetsQ = useQuery({
    queryKey: ['tv-plans', provider],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/bills/tv/plans?provider=${provider}`);
      if (!res.ok) throw new Error(t('bills.tv.load_error'));
      return (await res.json()) as Bouquet[];
    },
  });

  const selectedPkg = bouquetsQ.data?.find((b) => (b.plan_code || b.id) === selectedBouquet);

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPkg) throw new Error(t('bills.tv.select_bouquet'));
      if (!phone) throw new Error(t('bills.tv.phone_required'));
      const res = await apiFetch('/api/v1/bills/tv', {
        method: 'POST',
        body: JSON.stringify({
          smartcard_number: smartcard,
          provider,
          plan_code: selectedPkg.plan_code || selectedBouquet,
          phone: phone,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t('bills.tv.purchase_failed'));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      Alert.alert(
        t('bills.tv.success_title'),
        t('bills.tv.success_message', { name: selectedPkg?.name, smartcard, points: data.points_earned }),
        [{ text: t('bills.tv.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      Alert.alert(t('bills.tv.error_title'), error.message);
    },
  });

  const canSubmit = smartcard.length >= 10 && phone.length === 11 && selectedBouquet !== null;
  const estPoints = selectedPkg
    ? Math.floor((selectedPkg.price_naira || selectedPkg.amount || 0) * 0.018 * 0.67 * 10)
    : 0;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.tv.title')}</Text>
        </View>

        {/* Provider */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.tv.provider')}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {PROVIDERS.map((p) => (
            <TouchableOpacity
              key={p.key}
              onPress={() => { setProvider(p.key); setSelectedBouquet(null); }}
              style={[
                styles.providerCard,
                {
                  backgroundColor: provider === p.key ? tokens.mintSoft : tokens.card,
                  borderColor: provider === p.key ? tokens.mint : tokens.border,
                },
              ]}
            >
              <Ionicons name="tv-outline" size={24} color={tokens.mint} />
              <Text style={[
                styles.chipText,
                { color: provider === p.key ? tokens.mint : tokens.ink },
              ]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Bouquets */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.tv.select_bouquet')}</Text>
        {bouquetsQ.isLoading ? (
          <ActivityIndicator color={tokens.mint} />
        ) : (
          <View style={{ gap: 8 }}>
            {(bouquetsQ.data ?? []).map((b) => {
              // Bouquet objects come from the bill-providers API and
              // their shape isn't fully typed — fall back to '' so the
              // rest of the closure sees `string`, not `string | undefined`.
              const id = b.plan_code ?? b.id ?? '';
              return (
              <TouchableOpacity
                key={id}
                onPress={() => setSelectedBouquet(id)}
                style={[
                  styles.bundleCard,
                  {
                    backgroundColor: selectedBouquet === id ? tokens.mintSoft : tokens.card,
                    borderColor: selectedBouquet === id ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.bundleName, { color: tokens.ink }]}>{b.name}</Text>
                  {b.channels && (
                    <Text style={[styles.bundleMeta, { color: tokens.inkMuted }]}>{b.channels}</Text>
                  )}
                </View>
                <Text style={[styles.bundlePrice, { color: tokens.mint }]}>
                  ₦{((b.price_naira || b.amount || 0).toLocaleString())}
                </Text>
              </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Smartcard */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.tv.smartcard')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.tv.smartcard_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={smartcard}
          onChangeText={(text) => {
            // Only allow numbers
            const cleaned = text.replace(/[^0-9]/g, '');
            setSmartcard(cleaned);
          }}
          keyboardType="number-pad"
          maxLength={15}
        />
        {smartcard.length > 0 && smartcard.length < 10 && (
          <Text style={{ color: tokens.error, fontSize: 12, marginTop: -10 }}>
            {t('bills.tv.smartcard_error')}
          </Text>
        )}

        {/* Phone Number */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.tv.phone')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.tv.phone_placeholder')}
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
            {t('bills.tv.phone_error')}
          </Text>
        )}

        {/* Earn notice */}
        {selectedPkg && (
          <View style={[styles.earnCard, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
            <Ionicons name="gift-outline" size={20} color={tokens.mint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.earnLabel, { color: tokens.mint }]}>{t('bills.tv.earn_points', { points: estPoints })}</Text>
              <Text style={[styles.earnSub, { color: tokens.ink }]}>
                {t('bills.tv.earn_description')}
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
                {selectedPkg ? t('bills.tv.pay_button', { amount: (selectedPkg.price_naira || selectedPkg.amount || 0) }) : t('bills.tv.select_bouquet_prompt')}
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
  chipText: { fontSize: 14, fontWeight: '600' },
  providerCard: {
    flex: 1, padding: 14, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', gap: 6,
  },
  bundleCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, padding: 14, borderWidth: 1,
  },
  bundleName: { fontSize: 14, fontWeight: '600' },
  bundleMeta: { fontSize: 11, marginTop: 1 },
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
