import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
  interpolate,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type McqQuestionProps = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  onAnswered: (correct: boolean) => void;
  onBookmark?: () => void;
  bookmarked?: boolean;
};

// Animated Touchable with spring physics
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

// Confetti particle component
function ConfettiParticle({ index, color }: { index: number; color: string }) {
  const translateY = useSharedValue(-20);
  const translateX = useSharedValue(0);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    const angle = (index / 12) * Math.PI * 2;
    const distance = 60 + Math.random() * 40;
    
    translateX.value = withTiming(Math.cos(angle) * distance, { duration: 800, easing: Easing.out(Easing.cubic) });
    translateY.value = withSequence(
      withTiming(Math.sin(angle) * distance - 40, { duration: 400, easing: Easing.out(Easing.cubic) }),
      withTiming(Math.sin(angle) * distance + 100, { duration: 800, easing: Easing.in(Easing.cubic) })
    );
    rotate.value = withTiming((Math.random() - 0.5) * 720, { duration: 1200 });
    opacity.value = withDelay(400, withTiming(0, { duration: 400 }));
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.confettiParticle,
        { backgroundColor: color },
        animatedStyle,
      ]}
    />
  );
}

export function McqQuestion({
  question,
  options,
  correct_index,
  explanation,
  onAnswered,
  onBookmark,
  bookmarked,
}: McqQuestionProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  // Animation values
  const cardScale = useSharedValue(1);
  const explanationOpacity = useSharedValue(0);
  const explanationTranslateY = useSharedValue(20);

  const handleSelect = (idx: number) => {
    if (showAnswer) return;
    
    const correct = idx === correct_index;
    
    // Haptic feedback
    if (correct) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setSelected(idx);
    setShowAnswer(true);
    onAnswered(correct);

    // Card celebration for correct answer
    if (correct) {
      cardScale.value = withSequence(
        withSpring(1.02, { damping: 10, stiffness: 200 }),
        withSpring(1, { damping: 15, stiffness: 300 })
      );
      setTimeout(() => setShowConfetti(true), 100);
      setTimeout(() => setShowConfetti(false), 1500);
    }

    // Reveal explanation with smooth animation
    explanationOpacity.value = withDelay(300, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    explanationTranslateY.value = withDelay(300, withSpring(0, { damping: 20, stiffness: 200 }));
  };

  const isCorrect = selected === correct_index;
  const optionColors = options.map((_, idx) => {
    if (!showAnswer) return tokens.border;
    if (idx === correct_index) return tokens.mint;
    if (idx === selected && idx !== correct_index) return tokens.signal;
    return tokens.border;
  });

  const badgeTextColor = (idx: number) =>
    optionColors[idx] === tokens.mint
      ? tokens.mintText
      : optionColors[idx] === tokens.signal
        ? '#fff'
        : tokens.inkMuted;

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  const explanationAnimatedStyle = useAnimatedStyle(() => ({
    opacity: explanationOpacity.value,
    transform: [{ translateY: explanationTranslateY.value }],
  }));

  const confettiColors = [tokens.mint, tokens.mintSoft];

  return (
    <Animated.View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }, cardAnimatedStyle]}>
      {/* Confetti celebration */}
      {showConfetti && (
        <View style={styles.confettiContainer}>
          {Array.from({ length: 12 }).map((_, i) => (
            <ConfettiParticle
              key={i}
              index={i}
              color={confettiColors[i % confettiColors.length]}
            />
          ))}
        </View>
      )}
      
      <View style={styles.questionHeader}>
        <Text style={[styles.question, { color: tokens.ink }]}>{question}</Text>
        {onBookmark && (
          <TouchableOpacity
            onPress={onBookmark}
            style={styles.bookmarkBtn}
            accessibilityRole="button"
            accessibilityLabel={bookmarked ? 'Remove bookmark' : 'Bookmark this question'}
          >
            <Ionicons
              name={bookmarked ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={bookmarked ? tokens.mint : tokens.inkMuted}
            />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.options}>
        {options.map((opt, idx) => {
          const scale = useSharedValue(1);
          const shakeX = useSharedValue(0);

          const optionAnimatedStyle = useAnimatedStyle(() => ({
            transform: [{ scale: scale.value }, { translateX: shakeX.value }],
          }));

          const handleOptionPress = () => {
            if (showAnswer) return;
            
            const correct = idx === correct_index;
            
            // Press animation
            scale.value = withSequence(
              withTiming(0.95, { duration: 80 }),
              withSpring(1, { damping: 12, stiffness: 400 })
            );

            // Shake for wrong answer
            if (!correct) {
              shakeX.value = withSequence(
                withTiming(-8, { duration: 50 }),
                withTiming(8, { duration: 50 }),
                withTiming(-8, { duration: 50 }),
                withTiming(8, { duration: 50 }),
                withTiming(0, { duration: 50 })
              );
            }

            handleSelect(idx);
          };

          return (
            <AnimatedTouchable
              key={idx}
              onPress={handleOptionPress}
              disabled={showAnswer}
              activeOpacity={1}
              accessibilityRole="button"
              accessibilityLabel={`Option ${String.fromCharCode(65 + idx)}: ${opt}`}
              accessibilityState={{ disabled: showAnswer, selected: selected === idx }}
              accessibilityHint={showAnswer ? undefined : "Select this answer"}
              style={[
                styles.option,
                { 
                  borderColor: optionColors[idx],
                  backgroundColor: tokens.paper,
                  borderWidth: optionColors[idx] === tokens.border ? 1.5 : 2,
                },
                optionAnimatedStyle,
              ]}
            >
              <View style={[styles.badge, { backgroundColor: optionColors[idx] }]}>
                <Text style={[styles.badgeText, { color: badgeTextColor(idx) }]}>{String.fromCharCode(65 + idx)}</Text>
              </View>
              <Text style={[styles.optionText, { color: tokens.ink }]}>{opt}</Text>
              {showAnswer && idx === correct_index && (
                <Ionicons name="checkmark-circle" size={20} color={tokens.mint} accessibilityLabel="Correct answer" />
              )}
              {showAnswer && idx === selected && idx !== correct_index && (
                <Ionicons name="close-circle" size={20} color={tokens.signal} accessibilityLabel="Incorrect answer" />
              )}
            </AnimatedTouchable>
          );
        })}
      </View>
      {showAnswer && (
        <Animated.View style={[styles.explanation, { backgroundColor: tokens.paper }, explanationAnimatedStyle]}>
          <Text style={[styles.explanationLabel, { color: isCorrect ? tokens.mint : tokens.signal }]}>
            {isCorrect ? '✨ Correct!' : '❌ Incorrect'}
          </Text>
          <Text style={[styles.explanationText, { color: tokens.inkMuted }]}>{explanation}</Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  confettiContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    zIndex: 10,
    pointerEvents: 'none',
  },
  confettiParticle: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  question: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    flex: 1,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bookmarkBtn: {
    padding: 4,
  },
  options: {
    gap: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    padding: 14,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  explanation: {
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  explanationLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  explanationText: {
    fontSize: 13,
    lineHeight: 19,
  },
});
