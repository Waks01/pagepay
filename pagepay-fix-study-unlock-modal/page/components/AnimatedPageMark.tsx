import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
  interpolateColor,
  Extrapolate,
} from 'react-native-reanimated';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type AnimatedPageMarkProps = {
  width?: number;
  height?: number;
  variant?: 'idle' | 'pulse' | 'loading' | 'success' | 'error';
};

/**
 * Brand mark with five variants.
 *
 * Color transitions use `interpolateColor` (UI-thread safe) — the previous
 * version called `parseInt` inside a worklet which is not guaranteed safe
 * across Reanimated/babel versions. The `idle` variant now uses `withTiming`
 * to enter, so switching *into* idle from any other variant no longer
 * causes a hard jump. The `error` variant's `skewValue` was removed — at
 * 0.08 radians it produced ~1.5px of horizontal displacement which was
 * invisible noise.
 */
export function AnimatedPageMark({
  width = 32,
  height = 2,
  variant = 'idle',
}: AnimatedPageMarkProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const primaryColor = tokens.mint;
  const errorColor = tokens.signal;

  const scaleValue = useSharedValue(1);
  const opacityValue = useSharedValue(1);
  const rotationValue = useSharedValue(0);
  const colorValue = useSharedValue(0);
  const glowValue = useSharedValue(0.3);

  useEffect(() => {
    switch (variant) {
      case 'idle':
        scaleValue.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
        opacityValue.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
        rotationValue.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
        colorValue.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
        glowValue.value = withRepeat(
          withTiming(0.8, { duration: 2500, easing: Easing.inOut(Easing.cubic) }),
          -1,
          true,
        );
        break;

      case 'pulse':
        scaleValue.value = withRepeat(
          withTiming(1.12, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
          -1,
          true,
        );
        glowValue.value = withRepeat(
          withTiming(1.2, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
          -1,
          true,
        );
        opacityValue.value = 1;
        rotationValue.value = 0;
        colorValue.value = 0;
        break;

      case 'loading':
        scaleValue.value = 1;
        rotationValue.value = withRepeat(
          withTiming(360, { duration: 2200, easing: Easing.linear }),
          -1,
          false,
        );
        opacityValue.value = withRepeat(
          withTiming(0.5, { duration: 1100, easing: Easing.inOut(Easing.cubic) }),
          -1,
          true,
        );
        glowValue.value = withRepeat(
          withTiming(1.3, { duration: 1100, easing: Easing.inOut(Easing.cubic) }),
          -1,
          true,
        );
        break;

      case 'success':
        scaleValue.value = withSequence(
          withTiming(1.5, { duration: 380, easing: Easing.out(Easing.cubic) }),
          withTiming(1.15, { duration: 180, easing: Easing.inOut(Easing.cubic) }),
        );
        glowValue.value = withTiming(2.0, { duration: 800, easing: Easing.out(Easing.cubic) });
        opacityValue.value = 1;
        rotationValue.value = 0;
        colorValue.value = 0;
        break;

      case 'error':
        scaleValue.value = withRepeat(
          withTiming(0.92, { duration: 150, easing: Easing.inOut(Easing.cubic) }),
          4,
          true,
        );
        colorValue.value = withSequence(
          withTiming(1, { duration: 120, easing: Easing.inOut(Easing.cubic) }),
          withTiming(1, { duration: 120, easing: Easing.inOut(Easing.cubic) }),
          withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) }),
        );
        glowValue.value = withRepeat(
          withTiming(1.5, { duration: 200, easing: Easing.inOut(Easing.cubic) }),
          2,
          true,
        );
        break;

      default:
        scaleValue.value = withTiming(1, { duration: 300 });
        opacityValue.value = withTiming(1, { duration: 300 });
    }
  }, [
    colorValue,
    errorColor,
    glowValue,
    opacityValue,
    primaryColor,
    rotationValue,
    scaleValue,
    variant,
  ]);

  const animatedStyle = useAnimatedStyle(() => {
    const animatedColor = interpolateColor(
      colorValue.value,
      [0, 1],
      [primaryColor, errorColor],
    );

    return {
      transform: [
        { scale: scaleValue.value },
        { rotate: `${rotationValue.value}deg` },
      ],
      opacity: opacityValue.value,
      backgroundColor: animatedColor,
    };
  });

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowValue.value }],
    opacity: interpolate(glowValue.value, [0.3, 1, 2], [0, 0.4, 0], Extrapolate.CLAMP),
  }));

  return (
    <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width,
            height,
            borderRadius: height / 2,
            backgroundColor: primaryColor,
          },
          glowStyle,
        ]}
      />

      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[
          {
            width,
            height,
            borderRadius: height / 2,
            backgroundColor: primaryColor,
          },
          animatedStyle,
        ]}
      />
    </View>
  );
}
