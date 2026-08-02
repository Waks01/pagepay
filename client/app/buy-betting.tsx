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

type Biller = {
  code: string;
  name: string;
  min_amount: number;
  max_amount: number;
};

type Product = {
  id: number;
  name: string;
  amount: number;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
  transaction_id: string;
  status_detail: string;
};

export default function BuyBettingScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [biller, setBiller] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [validatedName, setValidatedName] = useState<string | null>(null);

  const billersQ = useQuery({
    queryKey: ['betting-billers'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/betting/billers');
      if (!res.ok) throw new Error('Failed to load billers');
      return (await res.json()) as Biller[];
    },
  });

  const productsQ = useQuery({
    queryKey: ['betting-products', biller],
    queryFn: async () => {
      if (!biller) return [];
      const res = await apiFetch(`/api/v1/bills/betting/products?biller_code=${biller}`);
      if (!res.ok) throw new Error('Failed to load products');
      return (await res.json()) as Product[];
    },
    enabled: !!biller,
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!biller || !accountNumber) throw new Error('Select biller and enter account number');
      const res = await apiFetch('/api/v1/bills/betting/validate', {
        method: 'POST',
        body: JSON.stringify({ biller_code: biller, account_number: accountNumber }),
      });
      if (!res.ok) throw new Error('Validation failed');
      return (await res.json()) as { customer_name?: string };
    },
    onSuccess: (data) => {
      if (data.customer_name) setValidatedName(data.customer_name);
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!biller) throw new Error('Select a betting platform');
      if (!accountNumber) throw new Error('Enter account number');
      if (!selectedProduct) throw new Error('Select an amount');
      const res = await apiFetch('/api/v1/bills/betting', {
        method: 'POST',
        body: JSON.stringify({
          biller_code: biller,
          account_number: accountNumber,
          amount_naira: selectedProduct,
          customer_name: customerName || validatedName || '',
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Purchase failed');
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      Alert.alert(
        t('bills.betting.success_title'),
        t('bills.betting.success_message', { platform: billersQ.data?.find(b => b.code === biller)?.name, tx: data.transaction_id }),
        [{ text: t('bills.betting.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      Alert.alert(t('bills.betting.error_title'), error.message);
    },
  });

  const selectedBiller = billersQ.data?.find(b => b.code === biller);
  const canSubmit = !!biller && accountNumber.length >= 3 && !!selectedProduct;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.betting.title')}</Text>
        </View>

        {/* Platform */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.betting.platform')}</Text>
        {billersQ.isLoading ? (
          <ActivityIndicator color={tokens.mint} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {(billersQ.data ?? []).map((b) => (
              <TouchableOpacity
                key={b.code}
                onPress={() => { setBiller(b.code); setSelectedProduct(null); setValidatedName(null); }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: biller === b.code ? tokens.mint : tokens.card,
                    borderColor: biller === b.code ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <Text style={[
                  styles.chipText,
                  { color: biller === b.code ? tokens.mintText : tokens.ink },
                ]}>{b.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Account Number */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.betting.account')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.betting.account_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={accountNumber}
          onChangeText={setAccountNumber}
          keyboardType="number-pad"
          maxLength={20}
        />
        <TouchableOpacity
          onPress={() => validateMutation.mutate()}
          disabled={!biller || accountNumber.length < 3 || validateMutation.isPending}
          style={[styles.validateBtn, { opacity: (!biller || accountNumber.length < 3 || validateMutation.isPending) ? 0.5 : 1 }]}
        >
          <Ionicons name="checkmark-circle-outline" size={18} color={tokens.mintText} />
          <Text style={[styles.validateText, { color: tokens.mintText }]}>
            {validateMutation.isPending ? 'Validating...' : 'Validate Account'}
          </Text>
        </TouchableOpacity>
        {validatedName && (
          <Text style={{ color: tokens.mint, fontSize: 12 }}>✓ {validatedName}</Text>
        )}

        {/* Amount */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.betting.amount')}</Text>
        {selectedBiller && (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {[100, 500, 1000, 5000, 10000, 50000].filter(a => a >= selectedBiller.min_amount && a <= selectedBiller.max_amount).map((a) => (
              <TouchableOpacity
                key={a}
                onPress={() => setSelectedProduct(String(a))}
                style={[
                  styles.amtBtn,
                  {
                    backgroundColor: selectedProduct === String(a) ? tokens.mint : tokens.card,
                    borderColor: selectedProduct === String(a) ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <Text style={[
                  styles.amtText,
                  { color: selectedProduct === String(a) ? tokens.mintText : tokens.ink },
                ]}>₦{a.toLocaleString()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Custom Amount */}
        <Text style={[styles.label, { color: tokens.inkMuted, marginTop: 4 }]}>{t('bills.betting.custom_amount')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('bills.betting.custom_amount')}
          placeholderTextColor={tokens.inkMuted}
          value={selectedProduct || ''}
          onChangeText={(text) => {
            const cleaned = text.replace(/[^0-9]/g, '');
            setSelectedProduct(cleaned);
          }}
          keyboardType="number-pad"
          maxLength={10}
        />

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
              <Ionicons name="logo-bitcoin" size={20} color={tokens.mintText} />
              <Text style={[styles.payText, { color: tokens.mintText }]}>
                {selectedProduct ? t('bills.betting.fund_button', { amount: selectedProduct }) : t('bills.betting.select_amount')}
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
  validateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10,
  },
  validateText: { fontSize: 14, fontWeight: '600' },
  amtBtn: {
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, alignItems: 'center',
  },
  amtText: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});