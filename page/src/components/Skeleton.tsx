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
