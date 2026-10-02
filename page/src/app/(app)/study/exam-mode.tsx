import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import { apiFetch } from "@/src/shared/api/client";
import { Fonts, PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PageHeader } from "@/components/PageHeader";
import { PagePaySpinner } from "@/components/PagePaySpinner";
import { startExam } from "@/src/features/study/api";

type ExamType = "jamb" | "waec" | "neco" | "nabteb" | "custom" | null;

type ExamMaterial = {
  id: number;
  title: string;
  asset_types: string[];
  created_at: string;
};

const EXAM_TYPES: { value: ExamType; label: string; duration: number; questions: number }[] = [
  { value: "jamb", label: "JAMB", duration: 60, questions: 20 },
  { value: "waec", label: "WAEC", duration: 90, questions: 20 },
  { value: "neco", label: "NECO", duration: 90, questions: 20 },
  { value: "nabteb", label: "NABTEB", duration: 90, questions: 20 },
  { value: "custom", label: "Custom", duration: 30, questions: 10 },
];

export default function ExamModeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();

  const [selectedExamType, setSelectedExamType] = useState<ExamType>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);

  const materialsQ = useQuery({
    queryKey: ["study", "materials", selectedExamType],
    queryFn: async () => {
      const url = selectedExamType
        ? `/api/v1/study/materials?exam_type=${selectedExamType}`
        : "/api/v1/study/materials";
      const res = await apiFetch(url);
      if (!res.ok) throw new Error("Failed to load materials");
      return res.json() as Promise<ExamMaterial[]>;
    },
  });

  const examConfig = EXAM_TYPES.find((e) => e.value === selectedExamType);

  const handleStartExam = async () => {
    if (!selectedExamType || !selectedMaterialId) return;

    setSubmitting(true);
    setError(null);
    setRetryAction(null);
    try {
      const data = await startExam(selectedMaterialId, selectedExamType);
      router.replace(`/study/exam/${data.session_id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start exam";
      setError(message);
      setRetryAction(() => () => handleStartExam());
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewHistory = () => {
    router.push("/study/exam-history");
  };

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <PageHeader
          title={t("study.exam_mode.title")}
          subtitle={t("study.exam_mode.subtitle")}
          showBack
          onBack={() => router.back()}
          backgroundColor={tokens.card}
          borderBottomColor={tokens.border}
          tokens={tokens}
          right={
            <Pressable
              onPress={handleViewHistory}
              accessibilityRole="button"
              accessibilityLabel="Exam history"
              style={({ pressed }) => [
                styles.iconBtn,
                { borderColor: tokens.border, backgroundColor: tokens.card, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="time-outline" size={18} color={tokens.ink} />
            </Pressable>
          }
        />

        {error && (
          <Animated.View
            entering={FadeIn.duration(180)}
            style={[styles.errorBanner, { backgroundColor: tokens.signalFaint, borderColor: tokens.signal }]}
            accessibilityRole="alert"
            accessibilityLabel={`Error: ${error}`}
          >
            <Ionicons name="alert-circle-outline" size={18} color={tokens.signal} accessibilityLabel="" />
            <Text style={[styles.errorText, { color: tokens.signal }]}>{error}</Text>
            {retryAction && (
              <TouchableOpacity
                onPress={() => {
                  setError(null);
                  retryAction();
                }}
                style={[styles.retryBtn, { backgroundColor: tokens.signal }]}
                accessibilityRole="button"
                accessibilityLabel={t("study.exam_mode.retry")}
              >
                <Text style={styles.retryText}>{t("study.exam_mode.retry")}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => { setError(null); setRetryAction(null); }}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t("study.exam_mode.dismiss")}
            >
              <Ionicons name="close" size={16} color={tokens.signal} accessibilityLabel="" />
            </TouchableOpacity>
          </Animated.View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionLabel, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}>
              {t("study.exam_mode.pick_exam_type")}
            </Text>
            <Text style={[styles.sectionMeta, { color: tokens.inkMuted }]}>{EXAM_TYPES.length} options</Text>
          </View>
          <View style={styles.examTypeGrid}>
            {EXAM_TYPES.map((et, idx) => (
              <Animated.View
                key={et.value}
                entering={FadeInDown.delay(idx * 40).duration(240).springify()}
                style={{ flex: 1, minWidth: "45%" }}
              >
                <Pressable
                  onPress={() => setSelectedExamType(et.value)}
                  style={({ pressed }) => [
                    styles.examTypeCard,
                    {
                      borderColor: selectedExamType === et.value ? tokens.mint : tokens.border,
                      backgroundColor: selectedExamType === et.value ? tokens.mintSoft : tokens.card,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedExamType === et.value }}
                >
                  <View style={styles.examTypeTopRow}>
                    <Text style={[styles.examTypeLabel, { color: selectedExamType === et.value ? tokens.mint : tokens.ink }]}>
                      {et.label}
                    </Text>
                    {selectedExamType === et.value ? (
                      <Ionicons name="checkmark-circle" size={16} color={tokens.mint} />
                    ) : null}
                  </View>
                  <Text style={[styles.examTypeMeta, { color: tokens.inkMuted }]}>
                    {et.questions} questions · {et.duration} min
                  </Text>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        </View>

        {selectedExamType && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}>
                {t("study.exam_mode.choose_material")}
              </Text>
              <Text style={[styles.sectionMeta, { color: tokens.inkMuted }]}>
                {materialsQ.data?.length ?? 0} available
              </Text>
            </View>
            {materialsQ.isLoading ? (
              <View style={[styles.stateBlock, { borderColor: tokens.border }]}>
                <PagePaySpinner size={32} />
              </View>
            ) : materialsQ.data && materialsQ.data.length > 0 ? (
              <View style={styles.materialList}>
                {materialsQ.data.map((m, idx) => (
                  <Animated.View
                    key={m.id}
                    entering={FadeInDown.delay(280 + idx * 40).duration(220).springify()}
                  >
                    <Pressable
                      onPress={() => setSelectedMaterialId(m.id)}
                      style={({ pressed }) => [
                        styles.materialCard,
                        {
                          borderColor: selectedMaterialId === m.id ? tokens.mint : tokens.border,
                          backgroundColor: selectedMaterialId === m.id ? tokens.mintSoft : tokens.card,
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedMaterialId === m.id }}
                    >
                      <View style={[styles.materialIcon, { backgroundColor: tokens.card }]}>
                        <Ionicons name="book-outline" size={16} color={tokens.mint} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.materialTitle, { color: tokens.ink }]} numberOfLines={1}>
                          {m.title}
                        </Text>
                        <Text style={[styles.materialMeta, { color: tokens.inkMuted }]} numberOfLines={1}>
                          {m.asset_types.join(" · ")}
                        </Text>
                      </View>
                      {selectedMaterialId === m.id ? (
                        <Ionicons name="checkmark-circle" size={18} color={tokens.mint} />
                      ) : null}
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            ) : (
              <View style={[styles.stateBlock, { borderColor: tokens.border }]}>
                <Ionicons name="school-outline" size={28} color={tokens.inkMuted} />
                <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
                  No materials found for this exam type. Upload one first!
                </Text>
              </View>
            )}
          </View>
        )}

        {selectedExamType && examConfig && (
          <View style={[styles.summaryCard, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
            <Ionicons name="hourglass-outline" size={18} color={tokens.mint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.summaryText, { color: tokens.mint, fontFamily: Fonts.editorialSemiBold as string }]}>
                {examConfig.duration} min · {examConfig.questions} questions
              </Text>
              <Text style={[styles.summarySub, { color: tokens.mint }]}>
                {t("study.exam_mode.pass_requirement")}
              </Text>
            </View>
          </View>
        )}

        <Pressable
          onPress={handleStartExam}
          disabled={!selectedExamType || !selectedMaterialId || submitting}
          style={({ pressed }) => [
            styles.startBtn,
            {
              backgroundColor: (!selectedExamType || !selectedMaterialId || submitting) ? tokens.border : tokens.mint,
              opacity: (!selectedExamType || !selectedMaterialId || submitting) ? 1 : pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.startBtnText, { color: (!selectedExamType || !selectedMaterialId || submitting) ? tokens.inkMuted : tokens.mintText }]}>
            {submitting ? t("study.exam_mode.preparing_exam") : t("study.exam_mode.start_exam")}
          </Text>
          {!submitting && (
            <Ionicons name="arrow-forward" size={18} color={(!selectedExamType || !selectedMaterialId) ? tokens.inkMuted : tokens.mintText} />
          )}
        </Pressable>

        <Pressable
          onPress={handleViewHistory}
          style={({ pressed }) => [
            styles.historyBtn,
            { borderColor: tokens.border, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Ionicons name="time-outline" size={18} color={tokens.ink} />
          <Text style={[styles.historyBtnText, { color: tokens.ink }]}>
            {t("study.exam_mode.exam_history") || "Exam History"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    gap: 20,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  sectionLabel: {
    fontSize: 18,
    letterSpacing: -0.3,
  },
  sectionMeta: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  examTypeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  examTypeCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    gap: 6,
  },
  examTypeTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  examTypeLabel: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  examTypeMeta: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  materialList: {
    gap: 8,
  },
  materialCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  materialIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  materialTitle: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  materialMeta: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
  },
  stateBlock: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 28,
    alignItems: "center",
    gap: 8,
  },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  summaryText: {
    fontSize: 14,
    letterSpacing: -0.2,
  },
  summarySub: {
    fontSize: 11,
    marginTop: 2,
    opacity: 0.8,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  retryText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  startBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  startBtnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  historyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
  },
  historyBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
});