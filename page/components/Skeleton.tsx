import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

type SkeletonProps = {
  width?: number | string;
  height: number;
  borderRadius?: number;
  marginBottom?: number;
};

/**
 * Base animated skeleton block with a shimmer-glow effect.
 *
 * Uses a smooth sine-wave pulse between `border` (the base tone) and
 * `mintSoft` (the shimmer highlight) so it reads as a living surface
 * rather than a blinking placeholder.
 *
 * Drop-in replacement for any View/Text during data loading.
 */
export function Skeleton({
  width = '100%',
  height,
  borderRadius = 8,
  marginBottom = 0,
}: SkeletonProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const animStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      pulse.value,
      [0, 1],
      [tokens.border, tokens.mintSoft],
    ),
    opacity: 0.6 + pulse.value * 0.25,
  }));

  return (
    <Animated.View style={[{ width, height, borderRadius, marginBottom }, animStyle] as any} />
  );
}
