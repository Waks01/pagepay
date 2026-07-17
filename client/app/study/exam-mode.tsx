import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';

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
  const { t } = useTranslation();
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

  const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);
  const progress = useMemo(
    () => (questions.length > 0 ? ((currentQuestionIndex + 1) / questions.length) * 100 : 0),
    [questions.length, currentQuestionIndex]
  );

  if (examState === 'active' && currentQuestion) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleSubmitExam} style={styles.exitBtn} accessibilityLabel="Exit exam">
            <Ionicons name="close" size={22} color={tokens.signal} />
          </TouchableOpacity>
          <View style={styles.timerContainer}>
            <Ionicons name="time-outline" size={18} color={timeLeft < 60 ? tokens.signal : tokens.mint} />
            <Text style={[styles.timerText, { color: timeLeft < 60 ? tokens.signal : tokens.mint }]}>
              {formatTime(timeLeft)}
            </Text>
          </View>
          <Text style={[styles.progressText, { color: tokens.inkMuted }]}>
            {currentQuestionIndex + 1}/{questions.length}
          </Text>
        </View>

        <View style={[styles.progressBarContainer, { backgroundColor: tokens.border }]}>
          <View style={[styles.progressBar, { width: `${progress}%`, backgroundColor: tokens.mint }]} />
        </View>

        <View style={styles.questionContainer}>
          <Text style={[styles.questionText, { color: tokens.ink }]}>{currentQuestion.question}</Text>

          <View style={styles.optionsContainer}>
            {currentQuestion.options.map((option, idx) => {
              const isSelected = selectedAnswers[currentQuestion.id] === option;
              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setSelectedAnswers((prev) => ({ ...prev, [currentQuestion.id]: option }))}
                  style={[
                    styles.optionBtn,
                    {
                      borderColor: isSelected ? tokens.mint : tokens.border,
                      backgroundColor: isSelected ? tokens.mintSoft : tokens.card,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={[styles.optionLetter, { backgroundColor: isSelected ? tokens.mint : tokens.border }]}>
                    <Text style={[styles.optionLetterText, { color: isSelected ? '#fff' : tokens.inkMuted }]}>
                      {String.fromCharCode(65 + idx)}
                    </Text>
                  </View>
                  <Text style={[styles.optionText, { color: tokens.ink }]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            onPress={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
            disabled={currentQuestionIndex === 0}
            style={[styles.navBtn, { borderColor: tokens.border }]}
            accessibilityState={{ disabled: currentQuestionIndex === 0 }}
          >
            <Ionicons name="chevron-back" size={20} color={tokens.inkMuted} />
            <Text style={[styles.navBtnText, { color: tokens.inkMuted }]}>Previous</Text>
          </TouchableOpacity>

          {currentQuestionIndex < questions.length - 1 ? (
            <TouchableOpacity
              onPress={() => setCurrentQuestionIndex((prev) => prev + 1)}
              style={[styles.navBtn, { backgroundColor: tokens.mint }]}
            >
              <Text style={[styles.navBtnText, { color: '#fff' }]}>Next</Text>
              <Ionicons name="chevron-forward" size={20} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleSubmitExam} style={[styles.navBtn, { backgroundColor: tokens.mint }]}>
              <Text style={[styles.navBtnText, { color: '#fff' }]}>Submit</Text>
              <Ionicons name="checkmark" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (examState === 'complete' && score !== null) {
    const passed = score >= 60;
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <View style={styles.resultContainer}>
          <View style={[styles.scoreCircle, { borderColor: passed ? tokens.mint : tokens.signal }]}>
            <Text style={[styles.scoreText, { color: passed ? tokens.mint : tokens.signal }]}>{score}%</Text>
          </View>
          <Text style={[styles.resultTitle, { color: tokens.ink }]}>
            {passed ? 'Congratulations!' : 'Keep Practicing!'}
          </Text>
          <Text style={[styles.resultSubtitle, { color: tokens.inkMuted }]}>
            {passed
              ? `You scored ${score}%. You're ready!`
              : `You scored ${score}%. Review your weak areas and try again.`}
          </Text>

          <View style={styles.resultStats}>
            <View style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.mint }]}>
                {Object.values(selectedAnswers).filter((a, i) => a === questions[i]?.answer).length}
              </Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Correct</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.signal }]}>
                {questions.length - Object.values(selectedAnswers).filter((a, i) => a === questions[i]?.answer).length}
              </Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Wrong</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Text style={[styles.statValue, { color: tokens.ink }]}>
                {questions.length}
              </Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Total</Text>
            </View>
          </View>

          <PrimaryButton
            title="Back to Exam Setup"
            onPress={handleRestart}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={tokens.mint} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>Exam Mode</Text>
        </View>

        <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
          Select your exam type and material to start a timed mock test.
        </Text>

        {error && (
          <View
            style={[styles.errorBanner, { backgroundColor: tokens.signalSoft, borderColor: tokens.signal }]}
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
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: tokens.ink }]}>Exam Type</Text>
        <View style={styles.examTypeGrid}>
          {EXAM_TYPES.map((et) => (
            <TouchableOpacity
              key={et.value}
              onPress={() => setSelectedExamType(et.value)}
              style={[
                styles.examTypeCard,
                {
                  borderColor: selectedExamType === et.value ? tokens.mint : tokens.border,
                  backgroundColor: selectedExamType === et.value ? tokens.mintSoft : tokens.card,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedExamType === et.value }}
            >
              <Text style={[styles.examTypeLabel, { color: selectedExamType === et.value ? tokens.mint : tokens.ink }]}>
                {et.label}
              </Text>
              <Text style={[styles.examTypeMeta, { color: tokens.inkMuted }]}>
                {et.questions} questions · {et.duration} min
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {selectedExamType && (
          <>
            <Text style={[styles.sectionLabel, { color: tokens.ink }]}>Select Material</Text>
            {materialsQ.isLoading ? (
              <ActivityIndicator size="small" color={tokens.mint} />
            ) : materialsQ.data && materialsQ.data.length > 0 ? (
              <View style={styles.materialList}>
                {materialsQ.data.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => setSelectedMaterialId(m.id)}
                    style={[
                      styles.materialCard,
                      {
                        borderColor: selectedMaterialId === m.id ? tokens.mint : tokens.border,
                        backgroundColor: selectedMaterialId === m.id ? tokens.mintSoft : tokens.card,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedMaterialId === m.id }}
                  >
                    <Text style={[styles.materialTitle, { color: tokens.ink }]}>{m.title}</Text>
                    <Text style={[styles.materialMeta, { color: tokens.inkMuted }]}>
                      {m.asset_types.join(', ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={[styles.emptyState, { borderColor: tokens.border }]}>
                <Ionicons name="school-outline" size={28} color={tokens.inkMuted} />
                <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
                  No materials found for this exam type. Upload one first!
                </Text>
              </View>
            )}
          </>
        )}

        <PrimaryButton
          title="Start Exam"
          onPress={handleStartExam}
          loading={submitting}
          disabled={!selectedExamType || !selectedMaterialId || submitting}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
    paddingBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  examTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  examTypeCard: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  examTypeLabel: {
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  examTypeMeta: {
    fontSize: 12,
  },
  materialList: {
    gap: 10,
    marginBottom: 24,
  },
  materialCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  materialTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  materialMeta: {
    fontSize: 12,
  },
  emptyText: {
    fontSize: 13,
    marginBottom: 24,
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 4,
  },
  retryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timerText: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressText: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressBarContainer: {
    height: 4,
    borderRadius: 2,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
  },
  questionContainer: {
    flex: 1,
    paddingHorizontal: 16,
    gap: 16,
  },
  questionText: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '500',
  },
  optionsContainer: {
    gap: 10,
  },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  optionLetter: {
    width: 28,
    height: 28,
    borderRadius: 14,
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
    paddingVertical: 16,
    gap: 12,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
  },
  navBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  exitBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  scoreCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontSize: 48,
    fontWeight: '700',
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  resultSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  resultStats: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
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
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
  },
});
