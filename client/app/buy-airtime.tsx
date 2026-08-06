import { useState, useEffect, useMemo, useRef } from 'react';
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
import NetworkIcon from '@/src/components/NetworkIcon';

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

type PurchaseState = 'idle' | 'processing' | 'success' | 'failed';

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
  const [purchaseState, setPurchaseState] = useState<PurchaseState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [successData, setSuccessData] = useState<AirtimeResult | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

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
      // Silently ignore detection failures
    } finally {
      setIsDetecting(false);
    }
  };

  const selectedNetwork = networkList.find(n => String(n.id) === selectedNetworkId);
  const finalAmount = selectedAmount ?? (parseInt(customAmount, 10) || 0);
  const canSubmit = phone.length === 11 && selectedNetworkId !== null && finalAmount >= 50;
  const estPoints = finalAmount ? Math.floor(finalAmount * 0.018 * 0.67 * 10) : 0;

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedNetworkId) throw new Error(t('bills.airtime.select_network'));
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
        throw new Error(err.detail || t('bills.airtime.errors.purchase_failed'));
      }
      return (await res.json()) as AirtimeResult;
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
    onSettled: () => {
      // Reset processing state
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
    router.back();
  };

  const renderContent = () => {
    switch (purchaseState) {
      case 'success':
        if (!successData) return null;
        return (
          <View style={{ flex: 1, paddingTop: insets.top, padding: 20, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <View style={[styles.successIcon, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
              <Ionicons name="checkmark" size={48} color={tokens.mint} />
            </View>
            <Text style={[styles.successTitle, { color: tokens.ink }]}>Purchase Successful!</Text>
            <View style={[styles.successCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Network</Text>
                <Text style={[styles.successValue, { color: tokens.ink }]}>{selectedNetwork?.name || successData.network}</Text>
              </View>
              <View style={[styles.successDivider, { backgroundColor: tokens.border }]} />
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Amount</Text>
                <Text style={[styles.successValue, { color: tokens.mint }]}>₦{successData.amount_naira.toLocaleString()}</Text>
              </View>
              <View style={[styles.successDivider, { backgroundColor: tokens.border }]} />
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Phone</Text>
                <Text style={[styles.successValue, { color: tokens.ink }]}>{successData.phone}</Text>
              </View>
              <View style={[styles.successDivider, { backgroundColor: tokens.border }]} />
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Points Earned</Text>
                <Text style={[styles.successValue, { color: tokens.mint }]}>+{successData.points_earned} pts</Text>
              </View>
              <View style={[styles.successDivider, { backgroundColor: tokens.border }]} />
              <View style={styles.successRow}>
                <Text style={[styles.successLabel, { color: tokens.inkMuted }]}>Reference</Text>
                <Text style={[styles.successValue, { color: tokens.ink, fontFamily: 'monospace' }]}>
                  {successData.reference.slice(0, 12)}...
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={handleSuccessDone}
              style={[styles.doneBtn, { backgroundColor: tokens.mint }]}
            >
              <Text style={[styles.doneBtnText, { color: tokens.mintText }]}>Done</Text>
            </TouchableOpacity>
          </View>
        );

      case 'failed':
        return (
          <View style={{ flex: 1, paddingTop: insets.top, padding: 20, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <View style={[styles.errorIcon, { backgroundColor: tokens.signalSoft, borderColor: tokens.signal }]}>
              <Ionicons name="close" size={48} color={tokens.signal} />
            </View>
            <Text style={[styles.errorTitle, { color: tokens.ink }]}>Purchase Failed</Text>
            <Text style={[styles.errorMessage, { color: tokens.inkMuted }]}>{errorMessage}</Text>
            <View style={[styles.errorCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.errorNote, { color: tokens.inkMuted }]}>
                No points were deducted from your wallet. Please try again.
              </Text>
            </View>
            <TouchableOpacity onPress={handleRetry} style={[styles.retryBtn, { backgroundColor: tokens.mint }]}>
              <Text style={[styles.retryBtnText, { color: tokens.mintText }]}>Try Again</Text>
            </TouchableOpacity>
          </View>
        );

      case 'processing':
        return (
          <View style={{ flex: 1, paddingTop: insets.top, padding: 20, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <ActivityIndicator size="large" color={tokens.mint} />
            <Text style={[styles.processingTitle, { color: tokens.ink }]}>Processing Purchase...</Text>
            <Text style={[styles.processingSub, { color: tokens.inkMuted }]}>
              Please wait while we process your airtime purchase
            </Text>
          </View>
        );
    }

    // 'idle' state - show the form
    return (
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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.networkCarousel}
            >
              {networkList.map(n => {
                const key = String(n.id);
                const isActive = selectedNetworkId === key;
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setSelectedNetworkId(key)}
                    style={[
                      styles.networkCard,
                      {
                        backgroundColor: isActive ? tokens.mintSoft : tokens.paper,
                        borderColor: isActive ? tokens.mint : tokens.border,
                      },
                    ]}
                  >
                    <NetworkIcon name={n.name} size={32} />
                    <Text style={[styles.networkName, { color: isActive ? tokens.mint : tokens.ink }]}>
                      {n.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Amount */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.airtime.amount_label')}</Text>
          <View style={[styles.amountGrid, { marginTop: 12 }]}>
            {AMOUNTS.map((a) => {
              const estPts = Math.floor(a * 0.018 * 0.67 * 10);
              const isActive = selectedAmount === a;
              return (
                <TouchableOpacity
                  key={a}
                  onPress={() => { setSelectedAmount(a); setCustomAmount(''); }}
                  style={[
                    styles.amountCard,
                    {
                      backgroundColor: isActive ? tokens.mintSoft : tokens.paper,
                      borderColor: isActive ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <Text style={[styles.amountValue, { color: tokens.ink }]}>₦{a.toLocaleString()}</Text>
                  <Text style={[styles.amountPoints, { color: tokens.mint }]}>+{estPts} pts</Text>
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

        {/* Summary Card */}
        {canSubmit && (
          <View style={[styles.summaryCard, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
            <View style={styles.summaryHeader}>
              <Ionicons name="receipt-outline" size={20} color={tokens.mint} />
              <Text style={[styles.summaryTitle, { color: tokens.mint }]}>Purchase Summary</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: tokens.mint }]} />
            <View style={styles.summaryBody}>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>Network</Text>
                <Text style={[styles.summaryValue, { color: tokens.ink }]}>{selectedNetwork?.name}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>Amount</Text>
                <Text style={[styles.summaryValue, { color: tokens.mint }]}>₦{finalAmount.toLocaleString()}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>Phone</Text>
                <Text style={[styles.summaryValue, { color: tokens.ink }]}>{phone}</Text>
              </View>
              <View style={[styles.summaryRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: tokens.border }]}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>You'll earn</Text>
                <Text style={[styles.summaryValue, { color: tokens.mint, fontWeight: '700' }]}>+{estPoints} pts</Text>
              </View>
            </View>
          </View>
        )}

        {/* Pay button */}
        <TouchableOpacity
          onPress={handleBuyPress}
          disabled={!canSubmit}
          style={[
            styles.payBtn,
            {
              backgroundColor: canSubmit ? tokens.mint : tokens.border,
            },
          ]}
        >
          <>
            <Ionicons name="cart-outline" size={20} color={tokens.mintText} />
            <Text style={[styles.payText, { color: tokens.mintText }]}>
              {selectedAmount || finalAmount >= 50
                ? t('bills.airtime.buy_button')
                : t('bills.airtime.amount_required')}
            </Text>
          </>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper }}>
      {renderContent()}

      {/* Confirmation Modal */}
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
                <Text style={[styles.modalValue, { color: tokens.ink }]}>{selectedNetwork?.name}</Text>
              </View>
              <View style={styles.modalRow}>
                <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Amount</Text>
                <Text style={[styles.modalValue, { color: tokens.mint, fontWeight: '700' }]}>₦{finalAmount.toLocaleString()}</Text>
              </View>
              <View style={styles.modalRow}>
                <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Phone</Text>
                <Text style={[styles.modalValue, { color: tokens.ink }]}>{phone}</Text>
              </View>
              <View style={styles.modalRow}>
                <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Points</Text>
                <Text style={[styles.modalValue, { color: tokens.mint }]}>+{estPoints} pts</Text>
              </View>
            </View>
            <View style={[styles.modalNote, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
              <Ionicons name="information-circle-outline" size={18} color={tokens.mint} />
              <Text style={[styles.modalNoteText, { color: tokens.ink }]}>
                Points will be deducted from your wallet now and credited back if the purchase fails.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <TouchableOpacity
                onPress={() => setShowConfirmModal(false)}
                style={[styles.modalBtn, styles.modalBtnCancel, { borderColor: tokens.border }]}
              >
                <Text style={[styles.modalBtnText, { color: tokens.inkMuted }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmPurchase}
                style={[styles.modalBtn, styles.modalBtnConfirm, { backgroundColor: tokens.mint }]}
              >
                <Text style={[styles.modalBtnText, { color: tokens.mintText }]}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  networkCarousel: {
    flexDirection: 'row', gap: 10, paddingVertical: 4,
  },
  networkCard: {
    width: 100, padding: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center', gap: 6,
  },
  networkName: { fontSize: 12, fontWeight: '600' },
  amountGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
  },
  amountCard: {
    width: '30%', minWidth: 100, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center', gap: 6,
  },
  amountValue: { fontSize: 14, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  amountPoints: { fontSize: 11, fontWeight: '600' },
  summaryCard: {
    borderRadius: 16, padding: 16, borderWidth: 1, gap: 12,
  },
  summaryHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  summaryTitle: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  summaryDivider: { height: 1 },
  summaryBody: { gap: 10 },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  summaryKey: { fontSize: 13, fontWeight: '500' },
  summaryValue: { fontSize: 14, fontWeight: '600' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 16, marginTop: 8,
  },
  payText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  successIcon: {
    width: 96, height: 96, borderRadius: 48, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  successTitle: { fontSize: 22, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  successCard: {
    borderRadius: 16, padding: 20, borderWidth: 1, width: '100%', gap: 16,
  },
  successRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  successLabel: { fontSize: 13, fontWeight: '500' },
  successValue: { fontSize: 14, fontWeight: '600' },
  successDivider: { height: 1 },
  doneBtn: {
    paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12, marginTop: 8,
  },
  doneBtnText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  errorIcon: {
    width: 96, height: 96, borderRadius: 48, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  errorTitle: { fontSize: 22, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  errorMessage: { fontSize: 14, textAlign: 'center', paddingHorizontal: 20 },
  errorCard: {
    borderRadius: 12, padding: 16, borderWidth: 1, width: '100%',
  },
  errorNote: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12, marginTop: 8,
  },
  retryBtnText: { fontSize: 16, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  processingTitle: { fontSize: 20, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  processingSub: { fontSize: 14, textAlign: 'center' },
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
  modalNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 12, padding: 12, borderWidth: 1,
  },
  modalNoteText: { flex: 1, fontSize: 12, lineHeight: 16 },
  modalBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  modalBtnCancel: { backgroundColor: 'transparent', borderWidth: 1 },
  modalBtnConfirm: { },
  modalBtnText: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
});
