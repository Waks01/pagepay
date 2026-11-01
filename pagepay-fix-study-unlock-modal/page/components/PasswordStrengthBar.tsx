import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type PasswordStrengthBarProps = {
  /** 0..4 — number of filled segments. */
  strength: number;
  /** Display label. */
  label: string;
  /** Color for the filled portion. */
  color: string;
  /** Muted color for the unfilled portion. */
  mutedColor: string;
  /** Muted color for the helper text. */
  inkMuted: string;
};

/**
 * Four-segment password strength indicator.
 *
 * Each bar segment scales in from the left with a 60ms cascade when the
 * password becomes non-empty — the only place in the auth flow that had
 * zero animation. Fill color transitions to the target color over 200ms
 * when strength changes, and the label crossfades.
 */
const STAGGER_MS = 60;
const BAR_DURATION = 260;

export function PasswordStrengthBar({
  strength,
  label,
  color,
  mutedColor,
  inkMuted,
}: PasswordStrengthBarProps) {
  const [visible, setVisible] = React.useState(false);

  // Trigger the cascade on mount and whenever strength is reset to 0
  // (e.g. password cleared). We do this with a key-bump on the parent
  // pattern, but inside the component we just watch the value transition.
  useEffect(() => {
    setVisible(true);
  }, []);

  return (
    <View style={styles.row}>
      <View style={styles.bars}>
        {[0, 1, 2, 3].map((i) => (
          <PasswordStrengthSegment
            key={i}
            index={i}
            filled={i < strength}
            color={color}
            mutedColor={mutedColor}
            trigger={visible}
          />
        ))}
      </View>
      <AnimatedStrengthLabel label={label} color={color} />
    </View>
  );
}

function PasswordStrengthSegment({
  index,
  filled,
  color,
  mutedColor,
  trigger,
}: {
  index: number;
  filled: boolean;
  color: string;
  mutedColor: string;
  trigger: boolean;
}) {
  const progress = useSharedValue(0);
  const fillProgress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      index * STAGGER_MS,
      withTiming(trigger ? 1 : 0, { duration: BAR_DURATION, easing: Easing.out(Easing.cubic) }),
    );
  }, [index, progress, trigger]);

  useEffect(() => {
    fillProgress.value = withTiming(filled ? 1 : 0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [fillProgress, filled]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: interpolate(progress.value, [0, 1], [0, 1], Extrapolate.CLAMP) }],
    backgroundColor: fillProgress.value > 0.5 ? color : mutedColor,
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolate.CLAMP),
  }));

  return (
    <Animated.View style={[styles.bar, animatedStyle]} />
  );
}

function AnimatedStrengthLabel({ label, color }: { label: string; color: string }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(2);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
    return () => {
      opacity.value = 0;
      translateY.value = 2;
    };
  }, [label, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.Text
      style={[
        styles.label,
        { color },
        animatedStyle,
      ]}
    >
      {label}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bars: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  bar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    minWidth: 70,
    textAlign: 'right',
  },
});
