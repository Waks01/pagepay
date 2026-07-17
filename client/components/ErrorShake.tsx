import React, { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

type ErrorShakeProps = {
  trigger?: boolean;
  children: React.ReactNode;
};

/**
 * Wraps any view and shakes it on error.
 *
 * Three oscillations (left → right → left → right → left → center) using
 * the Material standard bezier for a snappier feel than a generic ease.
 * The sequence settles back to translateX=0 on the last step so subsequent
 * trigger calls always start from a known origin (this was the bug in the
 * previous version — the final step was already 0, so re-triggering mid-
 * animation would land in an inconsistent place).
 */
const SHAKE = Easing.bezier(0.36, 0.07, 0.19, 0.97);

export function ErrorShake({ trigger = false, children }: ErrorShakeProps) {
  const translateX = useSharedValue(0);

  useEffect(() => {
    if (trigger) {
      // Always snap to 0 first so the sequence has a deterministic start.
      translateX.value = 0;
      translateX.value = withSequence(
        withTiming(-10, { duration: 70, easing: SHAKE }),
        withTiming(10, { duration: 70, easing: SHAKE }),
        withTiming(-8, { duration: 70, easing: SHAKE }),
        withTiming(8, { duration: 70, easing: SHAKE }),
        withTiming(-4, { duration: 60, easing: SHAKE }),
        withTiming(0, { duration: 80, easing: Easing.out(Easing.cubic) }),
      );
    }
  }, [trigger, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}
