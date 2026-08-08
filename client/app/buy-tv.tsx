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

type ValidateResult = {
  customer_name: string | null;
  account_status: string | null;
  validated: boolean;
  message?: string;
};

type TvProvider = {
  cable_name: string;
  product_name?: string;
};

export default function BuyTvScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [smartcard, setSmartcard] = useState('');
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [selectedBouquet, setSelectedBouquet] = useState<string | null>(null);
  const [validatedName, setValidatedName] = useState<string | null>(null);
  const [validatedStatus, setValidatedStatus] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const providersQ = useQuery({
    queryKey: ['tv-providers'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/tv/providers');
      if (!res.ok) throw new Error(t('bills.tv.load_error'));
      const data = await res.json();
      const providers: TvProvider[] = [];
      const seen = new Set<string>();
      for (const item of data) {
        const name = String(item.cable_name || item.name || '').toLowerCase();
        if (name && !seen.has(name)) {
          seen.add(name);
          providers.push({ cable_name: name, product_name: item.product_name || item.name });
        }
      }
      return providers;
    },
  });

  useEffect(() => {
    if (!provider && providersQ.data && providersQ.data.length > 0) {
      setProvider(providersQ.data[0].cable_name);
    }
  }, [providersQ.data, provider]);

  const bouquetsQ = useQuery({
    queryKey: ['tv-plans', provider],
    queryFn: async () => {
      if (!provider) return [];
      const res = await apiFetch(`/api/v1/bills/tv/plans?provider=${provider}`);
      if (!res.ok) throw new Error(t('bills.tv.load_error'));
      return (await res.json()) as Bouquet[];
    },
    enabled: !!provider,
  });

  const selectedPkg = bouquetsQ.data?.find((b) => (b.plan_code || b.id) === selectedBouquet);

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!provider || !smartcard) throw new Error(t('bills.tv.errors.smartcard_required'));
      const res = await apiFetch('/api/v1/bills/validate-smartcard', {
        method: 'POST',
        body: JSON.stringify({ smartcard_number: smartcard, provider }),
      });
      if (!res.ok) throw new Error(t('bills.tv.errors.validation_failed'));
      return (await res.json()) as ValidateResult;
    },
    onSuccess: (data) => {
      if (data.validated && data.customer_name) {
        setValidatedName(data.customer_name);
        setValidatedStatus(data.account_status);
      } else {
        setValidatedName(null);
        setValidatedStatus(null);
      }
    },
    onError: () => {
      setValidatedName(null);
      setValidatedStatus(null);
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPkg) throw new Error(t('bills.tv.select_bouquet'));
      if (!phone) throw new Error(t('bills.tv.phone_required'));
      if (!provider) throw new Error(t('bills.tv.errors.provider_required'));
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
      setShowConfirmModal(false);
      Alert.alert(
        t('bills.tv.success_title'),
        t('bills.tv.success_message', { name: selectedPkg?.name, smartcard, points: data.points_earned }),
        [{ text: t('bills.tv.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      setShowConfirmModal(false);
      setPurchaseError(error.message);
    },
  });

  const canSubmit = smartcard.length >= 10 && phone.length === 11 && selectedBouquet !== null && provider !== null;
  const estPoints = selectedPkg
    ? Math.floor((selectedPkg.price_naira || selectedPkg.amount || 0) * 0.018 * 0.67 * 10)
    : 0;

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
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.tv.title')}</Text>
        </View>

        {/* SECTION 1: Provider (segmented control) */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.tv.provider_label')}</Text>
          {providersQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : (providersQ.data ?? []).length === 0 ? (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t('bills.tv.no_providers')}
            </Text>
          ) : (
            <View style={styles.segmentedControl}>
              {(providersQ.data ?? []).map((p) => {
                const isActive = provider === p.cable_name;
                return (
                  <TouchableOpacity
                    key={p.cable_name}
                    onPress={() => {
                      setProvider(p.cable_name);
                      setSelectedBouquet(null);
                      setValidatedName(null);
                      setValidatedStatus(null);
                    }}
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
                      {p.cable_name.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* SECTION 2: Bouquets (2-col grid) */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.tv.package_label')}</Text>
            {selectedPkg && (
              <View style={[styles.earnBadge, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
                <Ionicons name="gift-outline" size={14} color={tokens.mint} />
                <Text style={[styles.earnBadgeText, { color: tokens.mint }]}>
                  +{estPoints} pts
                </Text>
              </View>
            )}
          </View>
          {bouquetsQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : (bouquetsQ.data ?? []).length === 0 ? (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t('bills.tv.no_bouquets')}
            </Text>
          ) : (
            <View style={styles.bouquetGrid}>
              {(bouquetsQ.data ?? []).map((b) => {
                const id = b.plan_code ?? b.id ?? '';
                const isActive = selectedBouquet === id;
                const price = b.price_naira || b.amount || 0;
                return (
                  <TouchableOpacity
                    key={id}
                    onPress={() => {
                      setSelectedBouquet(id);
                      setValidatedName(null);
                      setValidatedStatus(null);
                    }}
                    style={[
                      styles.bouquetCard,
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
                    <Text style={[styles.bouquetName, { color: tokens.ink }]} numberOfLines={2}>
                      {b.name}
                    </Text>
                    {b.channels && (
                      <Text style={[styles.bouquetMeta, { color: tokens.inkMuted }]} numberOfLines={1}>
                        {b.channels}
                      </Text>
                    )}
                    <Text style={[styles.bouquetPrice, { color: tokens.mint }]}>
                      ₦{price.toLocaleString()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* SECTION 3: Smartcard + Validate */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.tv.smartcard_label')}</Text>
          <View style={{ position: 'relative' }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: tokens.paper,
                  color: tokens.ink,
                  borderColor: smartcard.length >= 10 ? tokens.mint : tokens.border,
                },
              ]}
              placeholder={t('bills.tv.smartcard_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={smartcard}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, '');
                setSmartcard(cleaned);
                setValidatedName(null);
                setValidatedStatus(null);
              }}
              keyboardType="number-pad"
              maxLength={15}
            />
            {validatedName && (
              <View style={styles.inputIconValid}>
                <Ionicons name="checkmark-circle" size={20} color={tokens.mint} />
              </View>
            )}
          </View>
          {smartcard.length > 0 && smartcard.length < 10 && (
            <Text style={{ color: tokens.error, fontSize: 12, marginTop: 4 }}>
              {t('bills.tv.smartcard_error')}
            </Text>
          )}

          {/* Inline validate */}
          <TouchableOpacity
            onPress={() => validateMutation.mutate()}
            disabled={smartcard.length < 10 || !provider || validateMutation.isPending}
            style={[
              styles.validateBtn,
              {
                backgroundColor: tokens.mintSoft,
                borderColor: tokens.mint,
                opacity: (smartcard.length < 10 || !provider || validateMutation.isPending) ? 0.5 : 1,
              },
            ]}
          >
            {validateMutation.isPending ? (
              <ActivityIndicator size="small" color={tokens.mint} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={16} color={tokens.mint} />
                <Text style={[styles.validateText, { color: tokens.mint }]}>
                  {t('bills.tv.validate_button')}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Validated customer + status (per spec) */}
          {validatedName && (
            <View style={{ marginTop: 8, gap: 2 }}>
              <Text style={{ color: tokens.mint, fontSize: 13, fontWeight: '600' }}>
                ✓ {validatedName}
              </Text>
              {validatedStatus && (
                <Text style={{ color: tokens.inkMuted, fontSize: 11 }}>
                  {t('bills.tv.account_status', { status: validatedStatus })}
                </Text>
              )}
              <Text style={{ color: tokens.inkMuted, fontSize: 10, fontStyle: 'italic' }}>
                {t('bills.tv.verified_via')}
              </Text>
            </View>
          )}
        </View>

        {/* SECTION 4: Phone */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.tv.phone')}</Text>
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
              placeholder={t('bills.tv.phone_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={phone}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, '');
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
              {t('bills.tv.phone_error')}
            </Text>
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
          <Ionicons name="cart-outline" size={20} color={tokens.mintText} />
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {selectedPkg
              ? t('bills.tv.pay_button_with_amount', { amount: (selectedPkg.price_naira || selectedPkg.amount || 0) })
              : t('bills.tv.select_bouquet_prompt')}
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
              <Text style={[styles.modalTitle, { color: tokens.ink }]}>Confirm Subscription</Text>
              <View style={[styles.modalDivider, { backgroundColor: tokens.border }]} />
              <View style={{ gap: 12, marginVertical: 16 }}>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Provider</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>
                    {provider?.toUpperCase()}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Package</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>{selectedPkg?.name}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Smartcard</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink, fontFamily: 'monospace' }]}>
                    {smartcard}
                  </Text>
                </View>
                {validatedName && (
                  <View style={styles.modalRow}>
                    <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Customer</Text>
                    <Text style={[styles.modalValue, { color: tokens.ink }]}>{validatedName}</Text>
                  </View>
                )}
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Phone</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>{phone}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Amount</Text>
                  <Text style={[styles.modalValue, { color: tokens.mint, fontWeight: '700' }]}>
                    ₦{(selectedPkg?.price_naira || selectedPkg?.amount || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>You'll earn</Text>
                  <Text style={[styles.modalValue, { color: tokens.mint }]}>+{estPoints} pts</Text>
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
  input: {
    borderRadius: 12, padding: 14, fontSize: 18, fontWeight: '600',
    borderWidth: 1,
  },
  inputIconValid: {
    position: 'absolute', right: 12, top: 14,
  },
  segmentedControl: {
    flexDirection: 'row', borderRadius: 10,
    padding: 3, gap: 2,
  },
  segmentBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center',
  },
  segmentText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  bouquetGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12,
  },
  bouquetCard: {
    width: '47%', padding: 12, borderRadius: 12, borderWidth: 1,
    gap: 4, position: 'relative',
  },
  bouquetName: { fontSize: 13, fontWeight: '600', lineHeight: 1.3 },
  bouquetMeta: { fontSize: 10, fontWeight: '500' },
  bouquetPrice: { fontSize: 14, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold', marginTop: 2 },
  planCheck: {
    position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#0E7C66', alignItems: 'center', justifyContent: 'center',
  },
  earnBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  earnBadgeText: { fontSize: 12, fontWeight: '600' },
  validateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4,
  },
  validateText: { fontSize: 14, fontWeight: '600' },
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