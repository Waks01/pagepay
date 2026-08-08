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

type ExamProduct = {
  exam_type: string;
  name: string;
  amount: number;
  validity: string;
  description: string;
  code: string;
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

export default function BuyEducationScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [selectedExam, setSelectedExam] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const examsQ = useQuery({
    queryKey: ['education-prices'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/bills/education/prices');
      if (!res.ok) throw new Error(t('bills.education.load_error'));
      return (await res.json()) as ExamProduct[];
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedExam) throw new Error(t('bills.education.select_exam_prompt'));
      const res = await apiFetch('/api/v1/bills/education', {
        method: 'POST',
        body: JSON.stringify({
          exam_code: selectedExam,
          quantity: quantity,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t('bills.education.purchase_failed'));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      setShowConfirmModal(false);
      const exam = examsQ.data?.find(e => e.code === selectedExam);
      Alert.alert(
        t('bills.education.success_title'),
        t('bills.education.success_message', { exam: exam?.name, pins: data.pins?.join(', ') }),
        [{ text: t('bills.education.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      setShowConfirmModal(false);
      setPurchaseError(error.message);
    },
  });

  const selectedExamData = examsQ.data?.find(e => e.code === selectedExam);
  const totalPrice = selectedExamData ? selectedExamData.amount * quantity : 0;
  const canSubmit = !!selectedExam && quantity > 0;

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
          <Text style={[styles.title, { color: tokens.ink }]}>{t('bills.education.title')}</Text>
        </View>

        {/* SECTION 1: Select Exam (2-col grid) */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.education.select_exam')}</Text>
          {examsQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : (examsQ.data ?? []).length === 0 ? (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t('bills.education.no_exams')}
            </Text>
          ) : (
            <View style={styles.examGrid}>
              {(examsQ.data ?? []).map((exam) => {
                const isActive = selectedExam === exam.code;
                return (
                  <TouchableOpacity
                    key={exam.code}
                    onPress={() => setSelectedExam(exam.code)}
                    style={[
                      styles.examCard,
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
                    <Text style={[styles.examCode, { color: isActive ? tokens.mint : tokens.inkMuted }]}>
                      {exam.exam_type}
                    </Text>
                    <Text style={[styles.examName, { color: tokens.ink }]} numberOfLines={2}>
                      {exam.name}
                    </Text>
                    <Text style={[styles.examValidity, { color: tokens.inkMuted }]} numberOfLines={1}>
                      {exam.validity}
                    </Text>
                    <Text style={[styles.examPrice, { color: tokens.mint }]}>
                      ₦{exam.amount.toLocaleString()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* SECTION 2: Quantity (segmented control) */}
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.education.quantity')}</Text>
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

        {/* SECTION 3: Summary */}
        {selectedExamData && (
          <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.education.exam_label')}</Text>
              <Text style={[styles.summaryValue, { color: tokens.ink }]}>
                {selectedExamData.exam_type} × {quantity}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: tokens.border }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.education.total')}</Text>
              <Text style={[styles.summaryValue, { color: tokens.mint, fontWeight: '700' }]}>
                ₦{totalPrice.toLocaleString()}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: tokens.border }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>{t('bills.education.earn_label')}</Text>
              <Text style={[styles.summaryValue, { color: tokens.mint, fontWeight: '700' }]}>
                +{Math.floor(totalPrice * 0.018 * 0.67 * 10)} pts
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
          <Ionicons name="school-outline" size={20} color={tokens.mintText} />
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {totalPrice > 0
              ? t('bills.education.buy_button_with_amount', { amount: totalPrice })
              : t('bills.education.select_exam_prompt')}
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
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Exam</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>
                    {selectedExamData?.name}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Type</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>
                    {selectedExamData?.exam_type}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Quantity</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>× {quantity}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={[styles.modalKey, { color: tokens.inkMuted }]}>Unit Price</Text>
                  <Text style={[styles.modalValue, { color: tokens.ink }]}>
                    ₦{(selectedExamData?.amount || 0).toLocaleString()}
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
  examGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4,
  },
  examCard: {
    width: '47%', padding: 12, borderRadius: 12, borderWidth: 1,
    gap: 4, position: 'relative',
  },
  examCode: {
    fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5,
  },
  examName: { fontSize: 13, fontWeight: '600', lineHeight: 1.3 },
  examValidity: { fontSize: 10, fontWeight: '500' },
  examPrice: { fontSize: 14, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold', marginTop: 2 },
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