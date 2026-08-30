import { useState, useMemo } from 'react';
import { StyleSheet, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { McqQuestion } from '@/components/study/McqQuestion';
import { Flashcard } from '@/components/study/Flashcard';
import { EssayPrompt } from '@/components/study/EssayPrompt';
import { VideoPlayer } from '@/components/study/VideoPlayer';
import { DiagramViewer } from '@/components/study/DiagramViewer';
import { InteractiveExample } from '@/components/study/InteractiveExample';
import { PrimaryButton } from '@/components/PrimaryButton';
import { UnlockModal } from '@/components/study/UnlockModal';

type AssetInfo = {
  id: number;
  material_id: number;
  type: string;
  points_to_unlock: number;
};

type McqContent = {
  questions: Array<{
    question: string;
    options: string[];
    correct_index: number;
    explanation: string;
  }>;
};

type FlashcardContent = {
  cards: Array<{ front: string; back: string }>;
};

type EssayContent = {
  questions: Array<{ id: number; prompt: string; outline: string[] }>;
};

type DiagramContent = {
  title: string;
  description: string;
  elements: Array<{
    id: string;
    label: string;
    description: string;
    position: string;
  }>;
  connections: Array<{
    from: string;
    to: string;
    label: string;
  }>;
  svg_hint: string;
};

type VideoContent = {
  title: string;
  duration_seconds: number;
  scenes: Array<{
    time: string;
    visual: string;
    narration: string;
    text_overlay: string;
  }>;
  summary: string;
};

type ExampleContent = {
  title: string;
  problem: string;
  steps: Array<{
    step: number;
    instruction: string;
    hint: string;
    answer: string;
    explanation: string;
  }>;
  final_answer: string;
  try_yourself: {
    problem: string;
    hints: string[];
    solution_steps: string[];
    final_answer: string;
  };
};

type AssetContent = McqContent | FlashcardContent | EssayContent | DiagramContent | VideoContent | ExampleContent;

type AssetBrowserProps = {
  assets: AssetInfo[];
  userBalance: number;
  onUnlock: (assetId: number) => Promise<void>;
  unlockedAssets: Record<number, unknown>;
  onQuizComplete?: (assetId: number, score: number) => Promise<void>;
};

type AccordionSection = {
  type: 'mcq' | 'flashcard' | 'essay' | 'diagram' | 'video' | 'example';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  assets: AssetInfo[];
};

export function AssetBrowser({ assets, userBalance, onUnlock, unlockedAssets, onQuizComplete }: AssetBrowserProps) {
  const { t } = useTranslation();
  const isAssetUnlocked = (assetId: number) =>
    assetId in unlockedAssets;
  const [pendingUnlock, setPendingUnlock] = useState<AssetInfo | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mcqState, setMcqState] = useState<Record<number, Record<number, boolean>>>({});
  const [completedQuizzes, setCompletedQuizzes] = useState<Record<number, number>>({});
  const [submittingQuiz, setSubmittingQuiz] = useState<Record<number, boolean>>({});
  const [bookmarkedQuestions, setBookmarkedQuestions] = useState<Record<number, Set<number>>>({});
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const getMcqScore = (assetId: number, questions: McqContent['questions']): number | null => {
    const answers = mcqState[assetId];
    if (!answers) return null;
    const answeredCount = Object.keys(answers).length;
    if (answeredCount < questions.length) return null;
    const correctCount = questions.filter((_, idx) => answers[idx]).length;
    return Math.round((correctCount / questions.length) * 100);
  };

  const handleMcqAnswered = (assetId: number, questionIdx: number, correct: boolean) => {
    setMcqState((prev) => ({
      ...prev,
      [assetId]: { ...(prev[assetId] || {}), [questionIdx]: correct },
    }));
  };

  const toggleBookmark = (assetId: number, questionIdx: number) => {
    setBookmarkedQuestions((prev) => {
      const assetBookmarks = prev[assetId] || new Set<number>();
      const newBookmarks = new Set(assetBookmarks);
      if (newBookmarks.has(questionIdx)) {
        newBookmarks.delete(questionIdx);
      } else {
        newBookmarks.add(questionIdx);
      }
      return { ...prev, [assetId]: newBookmarks };
    });
  };

  const handleSubmitQuiz = async (assetId: number, questions: McqContent['questions']) => {
    const score = getMcqScore(assetId, questions);
    if (score === null) return;
    
    setSubmittingQuiz((prev) => ({ ...prev, [assetId]: true }));
    try {
      if (onQuizComplete) {
        await onQuizComplete(assetId, score);
      }
      setCompletedQuizzes((prev) => ({ ...prev, [assetId]: score }));
    } catch (error) {
      console.error('Quiz submission failed:', error);
    } finally {
      setSubmittingQuiz((prev) => ({ ...prev, [assetId]: false }));
    }
  };

  const sections: AccordionSection[] = useMemo(() => [
    {
      type: 'video',
      label: t('study.asset_browser.section_video'),
      icon: 'play-circle-outline',
      assets: assets.filter((a) => a.type === 'video'),
    },
    {
      type: 'diagram',
      label: t('study.asset_browser.section_diagram'),
      icon: 'git-branch-outline',
      assets: assets.filter((a) => a.type === 'diagram'),
    },
    {
      type: 'example',
      label: t('study.asset_browser.section_example'),
      icon: 'create-outline',
      assets: assets.filter((a) => a.type === 'example'),
    },
    {
      type: 'mcq',
      label: t('study.asset_browser.section_mcq'),
      icon: 'help-circle-outline',
      assets: assets.filter((a) => a.type === 'mcq'),
    },
    {
      type: 'flashcard',
      label: t('study.asset_browser.section_flashcard'),
      icon: 'albums-outline',
      assets: assets.filter((a) => a.type === 'flashcard'),
    },
    {
      type: 'essay',
      label: t('study.asset_browser.section_essay'),
      icon: 'document-text-outline',
      assets: assets.filter((a) => a.type === 'essay'),
    },
  ], [assets, t]);

  const toggleExpand = (type: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const handleRetake = (assetId: number) => {
    setMcqState((prev) => {
      const next = { ...prev };
      delete next[assetId];
      return next;
    });
    setCompletedQuizzes((prev) => {
      const next = { ...prev };
      delete next[assetId];
      return next;
    });
  };

  const handleUnlock = async (asset: AssetInfo) => {
    try {
      await onUnlock(asset.id);
    } catch (error) {
      if (__DEV__) {
        console.error('[AssetBrowser] Unlock failed:', error);
      }
      // Don't close modal on error — let the caller / parent handle it
      throw error;
    }
    setPendingUnlock(null);
  };

  const renderAssetContent = (asset: AssetInfo, content: AssetContent) => {
    if (asset.type === 'mcq') {
      const mcq = content as McqContent;
      const score = getMcqScore(asset.id, mcq.questions);
      const allAnswered = score !== null;
      const finalScore = completedQuizzes[asset.id] ?? score;
      const isSubmitting = submittingQuiz[asset.id] ?? false;

      return (
        <View style={styles.assetContent}>
          {mcq.questions.map((q, idx) => {
            const assetBookmarks = bookmarkedQuestions[asset.id];
            const isBookmarked = assetBookmarks ? assetBookmarks.has(idx) : false;
            return (
              <McqQuestion
                key={idx}
                question={q.question}
                options={q.options}
                correct_index={q.correct_index}
                explanation={q.explanation}
                onAnswered={(correct) => handleMcqAnswered(asset.id, idx, correct)}
                onBookmark={() => toggleBookmark(asset.id, idx)}
                bookmarked={isBookmarked}
              />
            );
          })}
          {allAnswered && !completedQuizzes[asset.id] && (
            <PrimaryButton
              title={isSubmitting ? t('study.asset_browser.submitting') : t('study.asset_browser.submit_quiz')}
              onPress={() => handleSubmitQuiz(asset.id, mcq.questions)}
              loading={isSubmitting}
              disabled={isSubmitting}
            />
          )}
          {finalScore !== undefined && (
            <View style={[styles.scoreBox, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
              <Ionicons
                name={finalScore >= 80 ? 'trophy' : 'analytics-outline'}
                size={20}
                color={finalScore >= 80 ? tokens.mint : tokens.inkMuted}
              />
              <Text style={[styles.scoreText, { color: tokens.ink }]}>
                {t('study.asset_browser.score', { percent: finalScore })}
              </Text>
              {finalScore >= 80 && (
                <Text style={[styles.bonusLabel, { color: tokens.mint }]}>
                  {t('study.asset_browser.bonus_label')}
                </Text>
              )}
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                onPress={() => handleRetake(asset.id)}
                style={styles.retakeBtn}
                accessibilityRole="button"
                accessibilityLabel={t('study.asset_browser.retake')}
              >
                <Ionicons name="refresh-outline" size={14} color={tokens.ink} />
                <Text style={[styles.retakeText, { color: tokens.ink }]}>
                  {t('study.asset_browser.retake')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      );
    }
    if (asset.type === 'flashcard') {
      const fc = content as FlashcardContent;
      return (
        <View style={styles.assetContent}>
          {fc.cards.map((card, idx) => (
            <Flashcard 
              key={idx} 
              front={card.front} 
              back={card.back}
              assetId={asset.id}
              cardIndex={idx}
            />
          ))}
        </View>
      );
    }
    if (asset.type === 'essay') {
      const essay = content as EssayContent;
      return (
        <View style={styles.assetContent}>
          {essay.questions.map((q) => (
            <EssayPrompt key={q.id} prompt={q.prompt} outline={q.outline} />
          ))}
        </View>
      );
    }
    if (asset.type === 'video') {
      const video = content as VideoContent;
      return (
        <View style={styles.assetContent}>
          <VideoPlayer content={video} />
        </View>
      );
    }
    if (asset.type === 'diagram') {
      const diagram = content as DiagramContent;
      return (
        <View style={styles.assetContent}>
          <DiagramViewer content={diagram} />
        </View>
      );
    }
    if (asset.type === 'example') {
      const example = content as ExampleContent;
      return (
        <View style={styles.assetContent}>
          <InteractiveExample content={example} materialId={asset.material_id} exampleId={asset.id} />
        </View>
      );
    }
    return null;
  };

  return (
    <View style={styles.root}>
      {sections.map((section) => {
        if (section.assets.length === 0) return null;
        const isExpanded = expanded.has(section.type);

        return (
          <View key={section.type} style={[styles.section, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Pressable
              onPress={() => toggleExpand(section.type)}
              style={({ pressed }) => [
                styles.sectionHeader,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name={section.icon} size={20} color={tokens.mint} />
              <Text style={[styles.sectionTitle, { color: tokens.ink }]}>{section.label}</Text>
              <Text style={[styles.sectionCount, { color: tokens.inkMuted }]}>
                {section.assets.length}
              </Text>
              <View style={{ flex: 1 }} />
              <Ionicons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={tokens.inkMuted}
              />
            </Pressable>

            {isExpanded && (
              <Animated.View
                entering={FadeInDown.duration(200)}
                exiting={FadeOutDown.duration(150)}
                style={styles.sectionBody}
              >
                {section.assets.map((asset) => {
                  const isUnlocked = asset.id in unlockedAssets;

                  return (
                    <View key={asset.id} style={[styles.assetCard, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
                      {isUnlocked ? (
                        renderAssetContent(asset, unlockedAssets[asset.id] as AssetContent)
                      ) : (
                        <View style={styles.lockedState}>
                          <Ionicons name="lock-closed-outline" size={28} color={tokens.inkMuted} />
                          <Text style={[styles.lockedText, { color: tokens.inkMuted }]}>
                            {t('study.asset_browser.locked_label', { points: asset.points_to_unlock })}
                          </Text>
                          <PrimaryButton
                            title={t('study.asset_browser.unlock')}
                            onPress={() => setPendingUnlock(asset)}
                            disabled={userBalance < asset.points_to_unlock}
                          />
                        </View>
                      )}
                    </View>
                  );
                })}
              </Animated.View>
            )}
          </View>
        );
      })}

      {pendingUnlock && (
        <UnlockModal
          visible
          pointsCost={pendingUnlock.points_to_unlock}
          userBalance={userBalance}
          onUnlockPoints={() => handleUnlock(pendingUnlock)}
          onClose={() => setPendingUnlock(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: '500',
  },
  sectionBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  assetCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  assetContent: {
    gap: 14,
  },
  lockedState: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  lockedText: {
    fontSize: 13,
    textAlign: 'center',
  },
  scoreBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '600',
  },
  bonusLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  retakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  retakeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
