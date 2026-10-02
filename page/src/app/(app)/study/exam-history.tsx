import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import { apiFetch } from "@/src/shared/api/client";
import { Fonts, PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PageHeader } from "@/components/PageHeader";
import { PagePaySpinner } from "@/components/PagePaySpinner";
import { fetchExamHistory, fetchExamResult, ExamHistoryItem } from "@/src/features/study/api";

export default function ExamHistoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const historyQ = useQuery({
    queryKey: ["exam", "history"],
    queryFn: async () => {
      const data = await fetchExamHistory();
      return data as ExamHistoryItem[];
    },
  });

  const [selectedResult, setSelectedResult] = useState<{
    session: ExamHistoryItem;
    detail: Awaited<ReturnType<typeof fetchExamResult>>;
  } | null>(null);

  const handleViewResult = async (sessionId: number) => {
    try {
      const detail = await fetchExamResult(sessionId);
      setSelectedResult({ session: historyQ.data?.find((s) => s.id === sessionId)!, detail });
    } catch {
      // ignore
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <PageHeader
        title={t("study.exam_mode.exam_history") || "Exam History"}
        showBack
        onBack={() => router.back()}
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        tokens={tokens}
      />

      {selectedResult ? (
        <ScrollView contentContainerStyle={styles.detailScroll}>
          <View style={styles.detailHeader}>
            <Pressable
              onPress={() => setSelectedResult(null)}
              style={({ pressed }) => [
                styles.backBtn,
                { borderColor: tokens.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="chevron-back" size={18} color={tokens.ink} />
              <Text style={[styles.backBtnText, { color: tokens.ink }]}>Back</Text>
            </Pressable>
            <Text style={[styles.detailTitle, { color: tokens.ink }]}>
              {selectedResult.session.exam_type.toUpperCase()} Exam
            </Text>
            <Text style={[styles.detailDate, { color: tokens.inkMuted }]}>
              {formatDate(selectedResult.session.started_at)}
            </Text>
          </View>

          <View style={styles.resultStats}>
            <View style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: selectedResult.detail.passed ? tokens.mint : tokens.signal, fontFamily: Fonts.editorialSemiBold as string }]}>
                {selectedResult.detail.score}%
              </Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Score</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.mint, fontFamily: Fonts.editorialSemiBold as string }]}>
                {selectedResult.detail.correct_count}
              </Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Correct</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.signal, fontFamily: Fonts.editorialSemiBold as string }]}>
                {selectedResult.detail.wrong_count}
              </Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Wrong</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: tokens.ink }]}>Question Review</Text>
            {selectedResult.detail.questions.map((q, idx) => (
              <View
                key={q.id}
                style={[styles.questionCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}
              >
                <View style={styles.questionHeader}>
                  <Text style={[styles.questionNumber, { color: tokens.inkMuted }]}>
                    Q{idx + 1}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: q.is_correct ? tokens.mintSoft : tokens.signalFaint }]}>
                    <Ionicons
                      name={q.is_correct ? "checkmark-circle" : "close-circle"}
                      size={14}
                      color={q.is_correct ? tokens.mint : tokens.signal}
                    />
                    <Text style={[styles.badgeText, { color: q.is_correct ? tokens.mint : tokens.signal }]}>
                      {q.is_correct ? "Correct" : "Wrong"}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.questionText, { color: tokens.ink }]}>{q.question}</Text>
                <View style={styles.answersRow}>
                  <View style={[styles.answerPill, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
                    <Text style={[styles.answerLabel, { color: tokens.inkMuted }]}>Your answer:</Text>
                    <Text style={[styles.answerValue, { color: tokens.ink }]}>
                      {q.selected_answer || "—"}
                    </Text>
                  </View>
                  <View style={[styles.answerPill, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
                    <Text style={[styles.answerLabel, { color: tokens.mint }]}>Correct:</Text>
                    <Text style={[styles.answerValue, { color: tokens.mint }]}>{q.correct_answer}</Text>
                  </View>
                </View>
                {q.explanation && (
                  <Text style={[styles.explanation, { color: tokens.inkMuted }]}>
                    {q.explanation}
                  </Text>
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {historyQ.isLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <PagePaySpinner size={32} />
            </View>
          ) : historyQ.data && historyQ.data.length > 0 ? (
            historyQ.data.map((session, idx) => (
              <Animated.View
                key={session.id}
                entering={FadeInDown.delay(idx * 40).duration(220).springify()}
              >
                <Pressable
                  onPress={() => handleViewResult(session.id)}
                  style={({ pressed }) => [
                    styles.historyCard,
                    {
                      backgroundColor: tokens.card,
                      borderColor: tokens.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <View style={[styles.historyIcon, { backgroundColor: session.passed ? tokens.mintSoft : tokens.signalFaint }]}>
                    <Ionicons
                      name={session.passed ? "trophy" : "refresh-circle"}
                      size={18}
                      color={session.passed ? tokens.mint : tokens.signal}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.historyTitle, { color: tokens.ink }]}>
                      {session.exam_type.toUpperCase()}
                    </Text>
                    <Text style={[styles.historyMeta, { color: tokens.inkMuted }]}>
                      {formatDate(session.started_at)} · {session.total_questions} questions
                    </Text>
                  </View>
                  <View style={styles.historyScore}>
                    <Text style={[styles.historyScoreText, { color: session.passed ? tokens.mint : tokens.signal }]}>
                      {session.score ?? 0}%
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={tokens.inkMuted} />
                </Pressable>
              </Animated.View>
            ))
          ) : (
            <View style={styles.empty}>
              <Ionicons name="school-outline" size={40} color={tokens.inkMuted} />
              <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
                No exams taken yet. Start your first exam!
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    gap: 12,
  },
  detailScroll: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    gap: 16,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  detailTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  detailDate: {
    fontSize: 12,
  },
  resultStats: {
    flexDirection: "row",
    gap: 8,
  },
  statBox: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    letterSpacing: -0.4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  questionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  questionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  questionNumber: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  questionText: {
    fontSize: 14,
    lineHeight: 20,
  },
  answersRow: {
    flexDirection: "row",
    gap: 8,
  },
  answerPill: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 2,
  },
  answerLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  answerValue: {
    fontSize: 13,
    fontWeight: "600",
  },
  explanation: {
    fontSize: 12,
    lineHeight: 18,
  },
  historyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  historyIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  historyMeta: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  historyScore: {
    marginRight: 4,
  },
  historyScoreText: {
    fontSize: 16,
    fontWeight: "700",
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
});