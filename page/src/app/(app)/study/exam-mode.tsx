import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';

import { apiFetch } from '@/src/shared/api/client';
import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';
import { StudyHeader } from '@/components/study/StudyHeader';

type ExamType = 'jamb' | 'waec' | 'neco' | 'nabteb' | 'custom' | null;

type ExamMaterial = {
  id: number;
  title: string;
  asset_types: string[];
  created_at: string;
};

type McqQuestion = {
  id: number;
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
};

type ExamState = 'setup' | 'active' | 'complete';

const EXAM_TYPES: { value: ExamType; label: string; duration: number; questions: number }[] = [
  { value: 'jamb', label: 'JAMB', duration: 60, questions: 20 },
  { value: 'waec', label: 'WAEC', duration: 90, questions: 20 },
  { value: 'neco', label: 'NECO', duration: 90, questions: 20 },
  { value: 'nabteb', label: 'NABTEB', duration: 90, questions: 20 },
  { value: 'custom', label: 'Custom', duration: 30, questions: 10 },
];

export default function ExamModeScreen() {
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();

  const [examState, setExamState] = useState<ExamState>('setup');
  const [selectedExamType, setSelectedExamType] = useState<ExamType>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<McqQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [score, setScore] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);

  const materialsQ = useQuery({
    queryKey: ['study', 'materials', selectedExamType],
    queryFn: async () => {
      const url = selectedExamType
        ? `/api/v1/study/materials?exam_type=${selectedExamType}`
        : '/api/v1/study/materials';
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('Failed to load materials');
      return res.json() as Promise<ExamMaterial[]>;
    },
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (examState !== 'active') return;
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleSubmitExam();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [examState]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleStartExam = async () => {
    if (!selectedExamType || !selectedMaterialId) return;

    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/v1/study/materials/${selectedMaterialId}`);
      if (!res.ok) throw new Error('Failed to load material');
      const material = await res.json();

      const mcqAssets = material.assets.filter((a: any) => a.type === 'mcq' && a.unlocked && a.content);
      if (mcqAssets.length === 0) {
        throw new Error('No MCQs available. Generate MCQs first.');
      }

      const allQuestions: McqQuestion[] = [];
      for (const asset of mcqAssets) {
        const content = asset.content as any;
        if (Array.isArray(content)) {
          for (const q of content) {
            allQuestions.push({
              id: q.id || allQuestions.length,
              question: q.question || q.prompt || '',
              options: q.options || [],
              answer: q.answer || q.correct || '',
              explanation: q.explanation || '',
            });
          }
        }
      }

      if (allQuestions.length === 0) {
        throw new Error('No questions found in MCQs.');
      }

      const examConfig = EXAM_TYPES.find((e) => e.value === selectedExamType)!;
      const shuffled = allQuestions.sort(() => Math.random() - 0.5).slice(0, examConfig.questions);

      setQuestions(shuffled);
      setTimeLeft(examConfig.duration * 60);
      setCurrentQuestionIndex(0);
      setSelectedAnswers({});
      setScore(null);
      setExamState('active');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start exam';
      setError(message);
      setRetryAction(() => () => handleStartExam());
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitExam = useCallback(async () => {
    if (questions.length === 0) return;

    let correct = 0;
    for (const q of questions) {
      if (selectedAnswers[q.id] === q.answer) correct++;
    }
    const finalScore = Math.round((correct / questions.length) * 100);
    setScore(finalScore);

    try {
      await apiFetch('/api/v1/study/quiz/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: questions[0].id, score: finalScore }),
      });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch {
      // bonus is optional
    }

    setExamState('complete');
  }, [questions, selectedAnswers, qc]);

  const handleRestart = () => {
    setExamState('setup');
    setSelectedMaterialId(null);
    setQuestions([]);
    setCurrentQuestionIndex(0);
    setSelectedAnswers({});
    setTimeLeft(0);
    setScore(null);
  };

  const handleExit = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    router.back();
  };

  const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);
  const progress = useMemo(
    () => (questions.length > 0 ? ((currentQuestionIndex + 1) / questions.length) * 100 : 0),
    [questions.length, currentQuestionIndex]
  );

  const examConfig = EXAM_TYPES.find((e) => e.value === selectedExamType);
  const isUrgent = timeLeft < 60 && examState === 'active';

  // Pulsing animation for the timer under 60s
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
      true
    );
  }, [isUrgent, pulse]);

  // ── ACTIVE ──────────────────────────────────────────────
  if (examState === 'active' && currentQuestion) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <View style={styles.activeHeader}>
          <Pressable
            onPress={handleExit}
            accessibilityRole="button"
            accessibilityLabel="Exit exam"
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
            {String(currentQuestionIndex + 1).padStart(2, '0')}/{questions.length}
          </Text>
        </View>

        <View style={[styles.progressBarContainer, { backgroundColor: tokens.border }]}>
          <View style={[styles.progressBar, { width: `${progress}%`, backgroundColor: tokens.mint }]} />
        </View>

        <ScrollView contentContainerStyle={styles.questionContainer} showsVerticalScrollIndicator={false}>
          <Animated.View
            key={currentQuestionIndex}
            entering={FadeIn.duration(200)}
            style={styles.questionBlock}
          >
            <Text style={[styles.questionEyebrow, { color: tokens.inkMuted }]}>
              QUESTION {String(currentQuestionIndex + 1).padStart(2, '0')} OF {questions.length}
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
                  onPress={() => setSelectedAnswers((prev) => ({ ...prev, [currentQuestion.id]: option }))}
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
                  {isSelected ? <Ionicons name="checkmark-circle" size={18} color={tokens.mint} /> : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: tokens.border, backgroundColor: tokens.paper }]}>
          <Pressable
            onPress={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
            disabled={currentQuestionIndex === 0}
            style={({ pressed }) => [
              styles.navBtn,
              styles.navBtnGhost,
              { borderColor: tokens.border, opacity: currentQuestionIndex === 0 ? 0.4 : pressed ? 0.7 : 1 },
            ]}
            accessibilityState={{ disabled: currentQuestionIndex === 0 }}
          >
            <Ionicons name="chevron-back" size={18} color={tokens.ink} />
            <Text style={[styles.navBtnText, { color: tokens.ink }]}>Previous</Text>
          </Pressable>

          {currentQuestionIndex < questions.length - 1 ? (
            <Pressable
              onPress={() => setCurrentQuestionIndex((prev) => prev + 1)}
              style={({ pressed }) => [styles.navBtn, { backgroundColor: tokens.mint, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.navBtnText, { color: tokens.mintText }]}>Next</Text>
              <Ionicons name="chevron-forward" size={18} color={tokens.mintText} />
            </Pressable>
          ) : (
            <Pressable
              onPress={handleSubmitExam}
              style={({ pressed }) => [styles.navBtn, { backgroundColor: tokens.signal, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.navBtnText, { color: '#fff' }]}>Submit</Text>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── COMPLETE ────────────────────────────────────────────
  if (examState === 'complete' && score !== null) {
    const passed = score >= 60;
    const correctCount = Object.values(selectedAnswers).filter((a, i) => a === questions[i]?.answer).length;
    const wrongCount = questions.length - correctCount;

    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <StudyHeader title="Exam Result" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.resultScroll}>
          <Animated.View entering={FadeInDown.duration(320).springify()} style={styles.resultHero}>
            <View style={[styles.resultBadge, { backgroundColor: passed ? tokens.mintSoft : tokens.signalFaint }]}>
              <Ionicons
                name={passed ? 'trophy' : 'refresh-circle'}
                size={28}
                color={passed ? tokens.mint : tokens.signal}
              />
            </View>
            <Text
              style={[styles.resultTitle, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}
            >
              {passed ? 'You passed!' : 'Almost there.'}
            </Text>
            <Text style={[styles.resultSubtitle, { color: tokens.inkMuted }]}>
              {passed
                ? `You scored ${score}%. You're ready for the real thing.`
                : `You scored ${score}%. Review your weak areas and try again.`}
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(120).duration(240)} style={[styles.scoreCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Text style={[styles.scorePct, { color: passed ? tokens.mint : tokens.signal, fontFamily: Fonts.editorialSemiBold as string }]}>
              {score}
              <Text style={[styles.scorePctSym, { color: passed ? tokens.mint : tokens.signal }]}>%</Text>
            </Text>
            <Text style={[styles.scoreLabel, { color: tokens.inkMuted }]}>FINAL SCORE</Text>
          </Animated.View>

          <View style={styles.resultStats}>
            <Animated.View entering={FadeInDown.delay(200).duration(220)} style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.mint, fontFamily: Fonts.editorialSemiBold as string }]}>{correctCount}</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Correct</Text>
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(260).duration(220)} style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.signal, fontFamily: Fonts.editorialSemiBold as string }]}>{wrongCount}</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Wrong</Text>
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(320).duration(220)} style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}>{questions.length}</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Total</Text>
            </Animated.View>
          </View>

          <View style={styles.resultActions}>
            <PrimaryButton title="Back to Setup" onPress={handleRestart} variant="mint" style={{ width: '100%' }} />
            <PrimaryButton title="Done" onPress={() => router.back()} variant="ghost" style={{ width: '100%' }} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── SETUP ───────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <StudyHeader
          title="Exam Mode"
          sub="Timed mock test, scored automatically"
          onBack={() => router.back()}
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
                accessibilityLabel="Retry"
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => { setError(null); setRetryAction(null); }}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Ionicons name="close" size={16} color={tokens.signal} accessibilityLabel="" />
            </TouchableOpacity>
          </Animated.View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionLabel, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}>
              Pick exam type
            </Text>
            <Text style={[styles.sectionMeta, { color: tokens.inkMuted }]}>{EXAM_TYPES.length} options</Text>
          </View>
          <View style={styles.examTypeGrid}>
            {EXAM_TYPES.map((et, idx) => (
              <Animated.View
                key={et.value}
                entering={FadeInDown.delay(idx * 40).duration(240).springify()}
                style={{ flex: 1, minWidth: '45%' }}
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
                Choose material
              </Text>
              <Text style={[styles.sectionMeta, { color: tokens.inkMuted }]}>
                {materialsQ.data?.length ?? 0} available
              </Text>
            </View>
            {materialsQ.isLoading ? (
              <View style={[styles.stateBlock, { borderColor: tokens.border }]}>
                <ActivityIndicator size="small" color={tokens.mint} />
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
                          {m.asset_types.join(' · ')}
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
                60% required to pass · timed, single attempt
              </Text>
            </View>
          </View>
        )}

        <PrimaryButton
          title={submitting ? 'Preparing exam…' : 'Start Exam'}
          onPress={handleStartExam}
          loading={submitting}
          disabled={!selectedExamType || !selectedMaterialId || submitting}
          style={{ width: '100%' }}
        />
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
  section: {
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 18,
    letterSpacing: -0.3,
  },
  sectionMeta: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  examTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  examTypeCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    gap: 6,
  },
  examTypeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  examTypeLabel: {
    fontSize: 15,
    fontWeight: '700',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  materialIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  materialTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  materialMeta: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
  stateBlock: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
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
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  // ── ACTIVE ──
  activeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressText: {
    flex: 1,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  progressBarContainer: {
    height: 3,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 2,
    overflow: 'hidden',
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
    fontWeight: '700',
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
    flexDirection: 'row',
    alignItems: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLetterText: {
    fontSize: 13,
    fontWeight: '700',
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
  },
  navBtnGhost: {
    backgroundColor: 'transparent',
  },
  navBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  // ── COMPLETE ──
  resultScroll: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    gap: 16,
  },
  resultHero: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
    gap: 10,
  },
  resultBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultTitle: {
    fontSize: 26,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  resultSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  scoreCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 4,
  },
  scorePct: {
    fontSize: 56,
    letterSpacing: -1.4,
    lineHeight: 64,
  },
  scorePctSym: {
    fontSize: 24,
    fontWeight: '700',
    opacity: 0.6,
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  resultStats: {
    flexDirection: 'row',
    gap: 8,
  },
  statBox: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    letterSpacing: -0.4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  resultActions: {
    gap: 8,
    marginTop: 8,
  },
});
