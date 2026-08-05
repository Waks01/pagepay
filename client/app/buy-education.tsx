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

export default function BuyEducationScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [selectedExam, setSelectedExam] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');

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
      if (!selectedExam) throw new Error(t('bills.education.select_exam'));
      const qty = parseInt(quantity) || 1;
      const res = await apiFetch('/api/v1/bills/education', {
        method: 'POST',
        body: JSON.stringify({
          exam_code: selectedExam,
          quantity: qty,
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
      const exam = examsQ.data?.find(e => e.code === selectedExam);
      Alert.alert(
        t('bills.education.success_title'),
        t('bills.education.success_message', { exam: exam?.name, pins: data.pins?.join(', ') }),
        [{ text: t('bills.education.done'), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      Alert.alert(t('bills.education.error_title'), error.message);
    },
  });

  const selectedExamData = examsQ.data?.find(e => e.code === selectedExam);
  const totalPrice = selectedExamData ? selectedExamData.amount * (parseInt(quantity) || 1) : 0;
  const canSubmit = !!selectedExam && parseInt(quantity) > 0;

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

        {/* Exams */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.education.select_exam')}</Text>
        {examsQ.isLoading ? (
          <ActivityIndicator color={tokens.mint} />
        ) : (
          <View style={{ gap: 8 }}>
            {(examsQ.data ?? []).map((exam) => (
              <TouchableOpacity
                key={exam.code}
                onPress={() => setSelectedExam(exam.code)}
                style={[
                  styles.examCard,
                  {
                    backgroundColor: selectedExam === exam.code ? tokens.mintSoft : tokens.card,
                    borderColor: selectedExam === exam.code ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.examName, { color: tokens.ink }]}>
                    {exam.name}
                  </Text>
                  <Text style={[styles.examMeta, { color: tokens.inkMuted }]} numberOfLines={2}>
                    {exam.description}
                  </Text>
                  <Text style={[styles.examValidity, { color: tokens.inkMuted }]}>
                    {exam.validity}
                  </Text>
                </View>
                <Text style={[styles.examPrice, { color: tokens.mint }]}>
                  ₦{exam.amount.toLocaleString()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Quantity */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>{t('bills.education.quantity')}</Text>
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
            <Text style={[styles.totalLabel, { color: tokens.inkMuted }]}>{t('bills.education.total')}</Text>
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
              <Ionicons name="school-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.payText, { color: tokens.mintText }]}>
                {totalPrice > 0 ? t('bills.education.buy_button', { amount: totalPrice }) : t('bills.education.select_exam')}
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
  examCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, padding: 14, borderWidth: 1, gap: 12,
  },
  examName: { fontSize: 14, fontWeight: '600' },
  examMeta: { fontSize: 11, marginTop: 2 },
  examValidity: { fontSize: 11, marginTop: 2 },
  examPrice: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
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