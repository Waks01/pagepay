import { useState } from 'react';
import { StyleSheet, Pressable, Text, View, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { SymbolEditor } from '@/components/study/SymbolEditor';
import { apiFetch } from '@/src/shared/api/client';

type Step = {
  step: number;
  instruction: string;
  hint: string;
  answer: string;
  explanation: string;
};

type TryYourself = {
  problem: string;
  hints: string[];
  solution_steps: string[];
  final_answer: string;
};

type ExampleContent = {
  title: string;
  problem: string;
  steps: Step[];
  final_answer: string;
  try_yourself: TryYourself;
};

type InteractiveExampleProps = {
  content: ExampleContent;
  materialId: number;
  exampleId: number;
};

type ExampleState = {
  revealedSteps: number[];
  showTryYourself: boolean;
  userAnswer: string;
  feedback: string | null;
  hint: string | null;
  isCorrect: boolean | null;
  showAnswer: boolean;
  attempts: number;
  isChecking: boolean;
};

export function InteractiveExample({ content, materialId, exampleId }: InteractiveExampleProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [state, setState] = useState<ExampleState>({
    revealedSteps: [],
    showTryYourself: false,
    userAnswer: '',
    feedback: null,
    hint: null,
    isCorrect: null,
    showAnswer: false,
    attempts: 0,
    isChecking: false,
  });

  const revealStep = (stepIndex: number) => {
    setState((prev) => ({
      ...prev,
      revealedSteps: [...prev.revealedSteps, stepIndex],
    }));
  };

  const revealAllSteps = () => {
    setState((prev) => ({
      ...prev,
      revealedSteps: content.steps.map((s) => s.step - 1),
    }));
  };

  const handleCheckAnswer = async () => {
    if (!state.userAnswer.trim() || state.isChecking) return;

    setState((prev) => ({ ...prev, isChecking: true }));
    try {
      const res = await apiFetch('/api/v1/study/examples/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          material_id: materialId,
          example_id: exampleId,
          user_answer: state.userAnswer,
          user_attempt: `attempt_${state.attempts + 1}`,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to check answer');
      }

      const result = await res.json();
      setState((prev) => ({
        ...prev,
        feedback: result.feedback,
        hint: result.hint,
        isCorrect: result.correct,
        showAnswer: result.show_answer,
        attempts: prev.attempts + 1,
        isChecking: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        feedback: 'Something went wrong. Please try again.',
        isChecking: false,
      }));
    }
  };

  const resetTryYourself = () => {
    setState((prev) => ({
      ...prev,
      userAnswer: '',
      feedback: null,
      hint: null,
      isCorrect: null,
      showAnswer: false,
      attempts: 0,
    }));
  };

  const allStepsRevealed = state.revealedSteps.length === content.steps.length;

  return (
    <View style={[styles.container, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <View style={styles.header}>
        <Ionicons name="school-outline" size={24} color={tokens.mint} />
        <Text style={[styles.title, { color: tokens.ink }]}>{content.title}</Text>
      </View>

      <View style={[styles.problemBox, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
        <Text style={[styles.problemLabel, { color: tokens.inkMuted }]}>Problem</Text>
        <Text style={[styles.problemText, { color: tokens.ink }]}>{content.problem}</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: tokens.ink }]}>Worked Solution</Text>
          {!allStepsRevealed && (
            <Pressable onPress={revealAllSteps} style={({ pressed }) => [styles.revealAllBtn, { opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[styles.revealAllText, { color: tokens.mint }]}>Reveal All</Text>
            </Pressable>
          )}
        </View>

        {content.steps.map((step, idx) => {
          const isRevealed = state.revealedSteps.includes(idx);
          const isLast = idx === content.steps.length - 1;

          return (
            <View key={idx} style={[styles.stepCard, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
              {!isRevealed ? (
                <Pressable
                  onPress={() => revealStep(idx)}
                  style={({ pressed }) => [styles.revealBtn, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Ionicons name="eye-outline" size={20} color={tokens.mint} />
                  <Text style={[styles.revealBtnText, { color: tokens.mint }]}>
                    Step {step.step} — Tap to reveal
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.stepContent}>
                  <View style={styles.stepHeader}>
                    <View style={[styles.stepNumber, { backgroundColor: tokens.mint }]}>
                      <Text style={[styles.stepNumberText, { color: tokens.mintText }]}>{step.step}</Text>
                    </View>
                    <Text style={[styles.stepInstruction, { color: tokens.ink }]}>{step.instruction}</Text>
                  </View>
                  <View style={[styles.stepAnswer, { backgroundColor: tokens.mint + '15', borderColor: tokens.border }]}>
                    <Text style={[styles.stepAnswerLabel, { color: tokens.mint }]}>Answer:</Text>
                    <Text style={[styles.stepAnswerText, { color: tokens.ink }]}>{step.answer}</Text>
                  </View>
                  <View style={[styles.stepExplanation, { backgroundColor: tokens.ink + '08' }]}>
                    <Ionicons name="information-outline" size={14} color={tokens.inkMuted} />
                    <Text style={[styles.stepExplanationText, { color: tokens.inkMuted }]}>{step.explanation}</Text>
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {allStepsRevealed && (
          <View style={[styles.finalAnswerBox, { backgroundColor: tokens.mint + '15', borderColor: tokens.mint + '40' }]}>
            <Text style={[styles.finalAnswerLabel, { color: tokens.mint }]}>Final Answer</Text>
            <Text style={[styles.finalAnswerText, { color: tokens.ink }]}>{content.final_answer}</Text>
          </View>
        )}
      </View>

      <View style={[styles.divider, { backgroundColor: tokens.border }]} />

      <View style={styles.tryYourselfSection}>
        <View style={styles.tryHeader}>
          <Ionicons name="create-outline" size={22} color={tokens.mint} />
          <Text style={[styles.tryTitle, { color: tokens.ink }]}>Try It Yourself</Text>
        </View>

        <View style={[styles.tryProblemBox, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
          <Text style={[styles.tryProblemText, { color: tokens.ink }]}>{content.try_yourself.problem}</Text>
        </View>

        {!state.showTryYourself ? (
          <Pressable
            onPress={() => setState((prev) => ({ ...prev, showTryYourself: true }))}
            style={[styles.startTryBtn, { backgroundColor: tokens.mint }]}
          >
            <Text style={[styles.startTryBtnText, { color: tokens.mintText }]}>Start Problem</Text>
          </Pressable>
        ) : (
          <View style={styles.tryForm}>
            <SymbolEditor
              value={state.userAnswer}
              onChange={(text) => setState((prev) => ({ ...prev, userAnswer: text }))}
              placeholder="Enter your answer here... Use the symbols above for math/physics/code"
              height={100}
            />

            <View style={styles.tryActions}>
              <Pressable
                onPress={handleCheckAnswer}
                disabled={!state.userAnswer.trim() || state.isChecking}
                style={[
                  styles.checkBtn,
                  {
                    backgroundColor: state.userAnswer.trim() && !state.isChecking ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <Text style={[styles.checkBtnText, { color: state.userAnswer.trim() && !state.isChecking ? tokens.mintText : tokens.inkMuted }]}>
                  {state.isChecking ? 'Checking...' : 'Check Answer'}
                </Text>
              </Pressable>

              <Pressable onPress={resetTryYourself} style={styles.resetBtn}>
                <Text style={[styles.resetBtnText, { color: tokens.inkMuted }]}>Reset</Text>
              </Pressable>
            </View>

            {state.feedback && (
              <View style={[
                styles.feedbackBox,
                {
                  backgroundColor: state.isCorrect ? '#34C75920' : '#FF950020',
                  borderColor: state.isCorrect ? '#34C759' : '#FF9500',
                },
              ]}>
                <Ionicons
                  name={state.isCorrect ? 'checkmark-circle' : 'alert-circle'}
                  size={20}
                  color={state.isCorrect ? '#34C759' : '#FF9500'}
                />
                <Text style={[styles.feedbackText, { color: tokens.ink }]}>{state.feedback}</Text>
              </View>
            )}

            {state.hint && !state.isCorrect && (
              <View style={[styles.hintBox, { backgroundColor: '#FF950010', borderColor: '#FF9500' }]}>
                <Ionicons name="bulb-outline" size={16} color="#FF9500" />
                <Text style={[styles.hintText, { color: tokens.ink }]}>{state.hint}</Text>
              </View>
            )}

            {state.showAnswer && (
              <View style={[styles.answerReveal, { backgroundColor: tokens.mint + '15', borderColor: tokens.mint + '40' }]}>
                <Text style={[styles.answerRevealLabel, { color: tokens.mint }]}>Correct Answer:</Text>
                <Text style={[styles.answerRevealText, { color: tokens.ink }]}>{content.try_yourself.final_answer}</Text>
              </View>
            )}

            <View style={[styles.hintsBox, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
              <Text style={[styles.hintsLabel, { color: tokens.inkMuted }]}>Need help? Hints:</Text>
              {content.try_yourself.hints.map((hint, idx) => (
                <View key={idx} style={styles.hintItem}>
                  <View style={[styles.hintBullet, { backgroundColor: tokens.mint }]}>
                    <Text style={[styles.hintBulletText, { color: tokens.mintText }]}>{idx + 1}</Text>
                  </View>
                  <Text style={[styles.hintItemText, { color: tokens.ink }]}>{hint}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  problemBox: {
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  problemLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  problemText: {
    fontSize: 15,
    lineHeight: 22,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  revealAllBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  revealAllText: {
    fontSize: 12,
    fontWeight: '600',
  },
  stepCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  revealBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
  },
  revealBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  stepContent: {
    padding: 14,
    gap: 10,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 13,
    fontWeight: '700',
  },
  stepInstruction: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  stepAnswer: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginLeft: 38,
  },
  stepAnswerLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  stepAnswerText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  stepExplanation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 10,
    borderRadius: 10,
    marginLeft: 38,
  },
  stepExplanationText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  finalAnswerBox: {
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
  },
  finalAnswerLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  finalAnswerText: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  tryYourselfSection: {
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  tryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tryTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  tryProblemBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  tryProblemText: {
    fontSize: 14,
    lineHeight: 20,
  },
  startTryBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  startTryBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  tryForm: {
    gap: 12,
  },
  tryActions: {
    flexDirection: 'row',
    gap: 10,
  },
  checkBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  checkBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  resetBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PagePay.light.border,
  },
  resetBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  feedbackBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  feedbackText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  hintText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  answerReveal: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  answerRevealLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  answerRevealText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  hintsBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  hintsLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  hintItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  hintBullet: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintBulletText: {
    fontSize: 11,
    fontWeight: '700',
  },
  hintItemText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
