import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeInDown,
  FadeInRight,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type EssayPromptProps = {
  prompt: string;
  outline: string[];
};

export function EssayPrompt({ prompt, outline }: EssayPromptProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  // Prompt typing effect
  const promptOpacity = useSharedValue(0);
  const promptTranslateY = useSharedValue(10);

  useEffect(() => {
    promptOpacity.value = withDelay(200, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
    promptTranslateY.value = withDelay(200, withSpring(0, { damping: 20, stiffness: 200 }));
  }, []);

  const promptAnimatedStyle = useAnimatedStyle(() => ({
    opacity: promptOpacity.value,
    transform: [{ translateY: promptTranslateY.value }],
  }));

  return (
    <Animated.View 
      entering={FadeInDown.duration(500).springify().damping(20).stiffness(200)}
      style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}
    >
      <Animated.View 
        entering={FadeInRight.delay(100).duration(400).springify()}
        style={[styles.labelPill, { backgroundColor: tokens.mintSoft }]}
        accessibilityLabel="Essay Question"
      >
        <Ionicons name="document-text-outline" size={14} color={tokens.mint} accessibilityLabel="" />
        <Text style={[styles.labelText, { color: tokens.mint }]}>Essay Question</Text>
      </Animated.View>
      
      <Animated.Text style={[styles.prompt, { color: tokens.ink }, promptAnimatedStyle]}>
        {prompt}
      </Animated.Text>
      
      <View style={[styles.outlineBox, { backgroundColor: tokens.paper }]}>
        <Text style={[styles.outlineTitle, { color: tokens.inkMuted }]}>Suggested outline:</Text>
        {outline.map((point, idx) => (
          <Animated.View
            key={idx}
            entering={FadeInRight.delay(400 + idx * 80).duration(400).springify()}
            style={styles.outlineRow}
          >
            <View style={[styles.bullet, { backgroundColor: tokens.mint }]} />
            <Text style={[styles.outlinePoint, { color: tokens.ink }]}>{point}</Text>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  labelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  labelText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  prompt: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  outlineBox: {
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  outlineTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  outlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  outlinePoint: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
