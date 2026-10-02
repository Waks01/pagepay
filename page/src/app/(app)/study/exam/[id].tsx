import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import { apiFetch } from "@/src/shared/api/client";
import {
  ExamQuestion,
  ExamSubmitResponse,
  getExamQuestions,
  submitExam,
  submitExamAnswer,
} from "@/src/features/study/api";
import { Fonts, PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PageHeader } from "@/components/PageHeader";
import { PagePaySpinner } from "@/components/PagePaySpinner";

type ExamStatus = "loading" | "active" | "submitted" | "timed_out" | "not_found";

export default function ExamActiveScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = Number(id);
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();

  const [status, setStatus] = useState<ExamStatus>("loading");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ExamSubmitResponse | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const questionsQ = useQuery({
    queryKey: ["exam", sessionId, "questions"],
    queryFn: async () => {
      const data = await getExamQuestions(sessionId);
      return data;
    },
  });

  const questions: ExamQuestion[] = questionsQ.data?.questions ?? [];
  const expiresAt = questionsQ.data?.expires_at ?? "";

  // Compute local timeLeft from expiresAt
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setTimeLeft(diff);
      if (diff <= 0 && status === "active") {
        handleSubmit(true);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Poll for status changes (e.g. auto-submit by scheduler)
  useEffect(() => {
    if (status !== "active") return;
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/v1/study/exam/${sessionId}/questions`);
        if (res.ok) {
          const data = await res.json();
          if (data.status !== "in_progress") {
            setStatus(data.status as ExamStatus);
            if (data.status === "submitted" || data.status === "timed_out") {
              // Fetch result
              const resultRes = await apiFetch(`/api/v1/study/exam/${sessionId}/result`);
              if (resultRes.ok) {
                const resultData = await resultRes.json();
                setResult(resultData);
              }
            }
          }
        }
      } catch {
        // ignore poll errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [sessionId, status]);

  useEffect(() => {
    if (questionsQ.isLoading) {
      setStatus("loading");
    } else if (questionsQ.isError) {
      setStatus("not_found");
    } else if (questions.length > 0 && status === "loading") {
      setStatus("active");
    }
  }, [questionsQ.isLoading, questionsQ.isError, questions.length, status]);

  const handleSubmit = useCallback(
    async (isAuto = false) => {
      if (questions.length === 0 || submitting) return;
      setSubmitting(true);
      try {
        const res = await submitExam(sessionId);
        setResult(res);
        setStatus(isAuto ? "timed_out" : "submitted");
        qc.invalidateQueries({ queryKey: ["me"] });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to submit exam";
        setStatus("active");
        // Surface error? For now just log
        console.error("[exam] submit failed:", message);
      } finally {
        setSubmitting(false);
      }
    },
    [sessionId, questions.length, submitting, qc],
  );

  const handleAnswer = useCallback(
    async (questionId: number, answer: string) => {
      setSelectedAnswers((prev) => ({ ...prev, [questionId]: answer }));
      try {
        await submitExamAnswer(sessionId, questionId, answer);
      } catch {
        // answer will be retried on next submit
      }
    },
    [sessionId],
  );

  const handleExit = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    router.back();
  };

  const currentQuestion = useMemo(() => questions[currentIndex], [questions, currentIndex]);
  const progress = useMemo(
    () => (questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0),
    [questions.length, currentIndex],
  );

  const isUrgent = timeLeft < 60 && status === "active";
  const pulse = useSharedValue(1);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  useEffect(() => {
    if (!isUrgent) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withTiming(0.55, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [isUrgent, pulse]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ── RESULT / COMPLETE ──────────────────────────────────────────────
  if ((status === "submitted" || status === "timed_out") && result) {
    const passed = result.score >= 60;
    return (
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <PageHeader
          title={t("study.exam_mode.exam_result")}
          showBack
          onBack={() => router.back()}
          backgroundColor={tokens.card}
          borderBottomColor={tokens.border}
          tokens={tokens}
        />
        <ScrollView contentContainerStyle={styles.resultScroll}>
          <Animated.View entering={FadeInDown.duration(320).springify()} style={styles.resultHero}>
            <View style={[styles.resultBadge, { backgroundColor: passed ? tokens.mintSoft : tokens.signalFaint }]}>
              <Ionicons
                name={passed ? "trophy" : "refresh-circle"}
                size={28}
                color={passed ? tokens.mint : tokens.signal}
              />
            </View>
            <Text
              style={[styles.resultTitle, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}
            >
              {passed ? t("study.exam_mode.you_passed") : t("study.exam_mode.almost_there")}
            </Text>
            <Text style={[styles.resultSubtitle, { color: tokens.inkMuted }]}>
              {passed
                ? `You scored ${result.score}%. You're ready for the real thing.`
                : `You scored ${result.score}%. Review your weak areas and try again.`}
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(120).duration(240)} style={[styles.scoreCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Text style={[styles.scorePct, { color: passed ? tokens.mint : tokens.signal, fontFamily: Fonts.editorialSemiBold as string }]}>
              {result.score}
              <Text style={[styles.scorePctSym, { color: passed ? tokens.mint : tokens.signal }]}>%</Text>
            </Text>
            <Text style={[styles.scoreLabel, { color: tokens.inkMuted }]}>{t("study.exam_mode.final_score")}</Text>
          </Animated.View>

          <View style={styles.resultStats}>
            <Animated.View entering={FadeInDown.delay(200).duration(220)} style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.mint, fontFamily: Fonts.editorialSemiBold as string }]}>{result.correct_count}</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t("study.exam_mode.correct")}</Text>
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(260).duration(220)} style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.signal, fontFamily: Fonts.editorialSemiBold as string }]}>{result.wrong_count}</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t("study.exam_mode.wrong")}</Text>
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(320).duration(220)} style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}>{result.total_questions}</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t("study.exam_mode.total")}</Text>
            </Animated.View>
          </View>

          <View style={styles.resultActions}>
            <Pressable
              onPress={() => router.replace(`/study/exam-mode`)}
              style={({ pressed }) => [
                styles.resultBtn,
                { backgroundColor: tokens.mint, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.resultBtnText, { color: tokens.mintText }]}>
                {t("study.exam_mode.back_to_setup")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.resultBtn,
                { backgroundColor: tokens.card, borderColor: tokens.border, borderWidth: 1, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.resultBtnText, { color: tokens.ink }]}>
                {t("study.exam_mode.done")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── LOADING / ERROR ────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <PageHeader title={t("study.exam_mode.loading")} showBack onBack={handleExit} backgroundColor={tokens.card} borderBottomColor={tokens.border} tokens={tokens} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <PagePaySpinner size={36} />
          <Text style={[styles.loadingText, { color: tokens.inkMuted }]}>
            {t("study.exam_mode.preparing_exam")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === "not_found" || questions.length === 0) {
    return (
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <PageHeader title={t("study.exam_mode.exam_result")} showBack onBack={handleExit} backgroundColor={tokens.card} borderBottomColor={tokens.border} tokens={tokens} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 }}>
          <Ionicons name="alert-circle-outline" size={48} color={tokens.signal} />
          <Text style={[styles.loadingText, { color: tokens.ink, textAlign: "center" }]}>
            {t("study.exam_mode.exam_ended") || "This exam is no longer available."}
          </Text>
          <Pressable
            onPress={() => router.replace("/study/exam-mode")}
            style={({ pressed }) => [
              styles.resultBtn,
              { backgroundColor: tokens.mint, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.resultBtnText, { color: tokens.mintText }]}>
              {t("study.exam_mode.back_to_setup")}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── ACTIVE EXAM ────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <View style={styles.activeHeader}>
        <Pressable
          onPress={handleExit}
          accessibilityRole="button"
          accessibilityLabel={t("study.exam_mode.exit_exam")}
          style={({ pressed }) => [styles.exitBtn, { borderColor: tokens.border, backgroundColor: tokens.card, opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="close" size={20} color={tokens.ink} />
        </Pressable>

        <Animated.View
          style={[
            styles.timerPill,
            { backgroundColor: isUrgent ? tokens.signalFaint : tokens.mintFaint, borderColor: isUrgent ? tokens.signal : tokens.mint },
            pulseStyle,
          ]}
        >
          <Ionicons name="time-outline" size={14} color={isUrgent ? tokens.signal : tokens.mint} />
          <Text style={[styles.timerText, { color: isUrgent ? tokens.signal : tokens.mint }]}>
            {formatTime(timeLeft)}
          </Text>
        </Animated.View>

        <Text style={[styles.progressText, { color: tokens.inkMuted }]}>
          {String(currentIndex + 1).padStart(2, "0")}/{questions.length}
        </Text>
      </View>

      <View style={[styles.progressBarContainer, { backgroundColor: tokens.border }]}>
        <View style={[styles.progressBar, { width: `${progress}%`, backgroundColor: tokens.mint }]} />
      </View>

      <ScrollView contentContainerStyle={styles.questionContainer} showsVerticalScrollIndicator={false}>
        <Animated.View
          key={currentIndex}
          entering={FadeIn.duration(200)}
          style={styles.questionBlock}
        >
          <Text style={[styles.questionEyebrow, { color: tokens.inkMuted }]}>
            QUESTION {String(currentIndex + 1).padStart(2, "0")} OF {questions.length}
          </Text>
          <Text style={[styles.questionText, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}>
            {currentQuestion.question}
          </Text>
        </Animated.View>

        <View style={styles.optionsContainer}>
          {currentQuestion.options.map((option, idx) => {
            const isSelected = selectedAnswers[currentQuestion.id] === option;
            const letter = String.fromCharCode(65 + idx);
            return (
              <Pressable
                key={idx}
                onPress={() => handleAnswer(currentQuestion.id, option)}
                style={({ pressed }) => [
                  styles.optionBtn,
                  {
                    borderColor: isSelected ? tokens.mint : tokens.border,
                    backgroundColor: isSelected ? tokens.mintSoft : tokens.card,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                <View style={[styles.optionLetter, { backgroundColor: isSelected ? tokens.mint : tokens.paper, borderColor: isSelected ? tokens.mint : tokens.border }]}>
                  <Text style={[styles.optionLetterText, { color: isSelected ? tokens.mintText : tokens.ink }]}>
                    {letter}
                  </Text>
                </View>
                <Text style={[styles.optionText, { color: tokens.ink }]}>{option}</Text>
                {isSelected && <Ionicons name="checkmark-circle" size={18} color={tokens.mint} />}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: tokens.border, backgroundColor: tokens.paper }]}>
        <Pressable
          onPress={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
          disabled={currentIndex === 0}
          style={({ pressed }) => [
            styles.navBtn,
            styles.navBtnGhost,
            { borderColor: tokens.border, opacity: currentIndex === 0 ? 0.4 : pressed ? 0.7 : 1 },
          ]}
          accessibilityState={{ disabled: currentIndex === 0 }}
        >
          <Ionicons name="chevron-back" size={18} color={tokens.ink} />
          <Text style={[styles.navBtnText, { color: tokens.ink }]}>{t("study.exam_mode.previous")}</Text>
        </Pressable>

        {currentIndex < questions.length - 1 ? (
          <Pressable
            onPress={() => setCurrentIndex((prev) => prev + 1)}
            style={({ pressed }) => [styles.navBtn, { backgroundColor: tokens.mint, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={[styles.navBtnText, { color: tokens.mintText }]}>{t("study.exam_mode.next")}</Text>
            <Ionicons name="chevron-forward" size={18} color={tokens.mintText} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => handleSubmit(false)}
            disabled={submitting}
            style={({ pressed }) => [styles.navBtn, { backgroundColor: tokens.signal, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={[styles.navBtnText, { color: "#fff" }]}>{t("study.exam_mode.submit")}</Text>
            <Ionicons name="checkmark" size={18} color="#fff" />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingText: {
    fontSize: 13,
    textAlign: "center",
  },
  activeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  exitBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  timerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  timerText: {
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  progressText: {
    flex: 1,
    textAlign: "right",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  progressBarContainer: {
    height: 3,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: 3,
    borderRadius: 2,
  },
  questionContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 16,
  },
  questionBlock: {
    paddingTop: 4,
    gap: 10,
  },
  questionEyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  questionText: {
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  optionsContainer: {
    gap: 8,
  },
  optionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  optionLetter: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  optionLetterText: {
    fontSize: 13,
    fontWeight: "700",
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
  },
  navBtnGhost: {
    backgroundColor: "transparent",
  },
  navBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  resultScroll: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    gap: 16,
  },
  resultHero: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
    gap: 10,
  },
  resultBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  resultTitle: {
    fontSize: 26,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  resultSubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  scoreCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 4,
  },
  scorePct: {
    fontSize: 56,
    letterSpacing: -1.4,
    lineHeight: 64,
  },
  scorePctSym: {
    fontSize: 24,
    fontWeight: "700",
    opacity: 0.6,
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
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
  resultActions: {
    gap: 8,
    marginTop: 8,
  },
  resultBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  resultBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
});