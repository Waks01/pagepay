import { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
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
import {
  SectionCard,
  SegmentedControl,
  ConfirmModal,
  ErrorBanner,
} from '@/src/components/bills';

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
  const estPoints = totalPrice ? Math.floor(totalPrice * 0.018 * 0.67 * 10) : 0;

  const handleBuyPress = () => {
    if (!canSubmit) return;
    setPurchaseError(null);
    setShowConfirmModal(true);
  };

  const quantityOptions = QUANTITY_OPTIONS.map(q => ({
    value: q,
    label: String(q),
  }));

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
        <SectionCard label={t('bills.education.select_exam')}>
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
        </SectionCard>

        {/* SECTION 2: Quantity (segmented control) */}
        <SectionCard label={t('bills.education.quantity')}>
          <SegmentedControl
            options={quantityOptions}
            value={quantity}
            onChange={setQuantity}
          />
        </SectionCard>

        {/* SECTION 3: Summary */}
        {selectedExamData && (
          <SectionCard>
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
                +{estPoints} pts
              </Text>
            </View>
          </SectionCard>
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

        <ErrorBanner message={purchaseError ?? ''} onDismiss={() => setPurchaseError(null)} />

        <ConfirmModal
          visible={showConfirmModal}
          title={t('bills.education.confirm_title')}
          confirming={purchaseMutation.isPending}
          rows={[
            { key: 'exam', label: t('bills.education.confirm_exam'), value: selectedExamData?.name ?? '' },
            { key: 'type', label: t('bills.education.confirm_type'), value: selectedExamData?.exam_type ?? '' },
            { key: 'qty', label: t('bills.education.confirm_quantity'), value: `× ${quantity}` },
            { key: 'unit', label: t('bills.education.confirm_unit_price'), value: `₦${(selectedExamData?.amount || 0).toLocaleString()}` },
            { key: 'amt', label: t('bills.education.confirm_total'), value: `₦${totalPrice.toLocaleString()}`, valueColor: 'mint' as const },
            { key: 'earn', label: t('bills.education.confirm_earn_label'), value: `+${estPoints} pts`, valueColor: 'mint' as const },
          ]}
          onCancel={() => setShowConfirmModal(false)}
          onConfirm={() => purchaseMutation.mutate()}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
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
});
