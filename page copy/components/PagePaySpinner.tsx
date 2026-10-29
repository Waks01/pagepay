import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type PagePaySpinnerProps = {
  size?: number;
};

/**
 * Branded loading spinner.
 *
 * Two counter-rotating arcs (purple outer, green inner) plus a center
 * pulsing dot. The center dot is wrapped in a colored <Animated.View> so
 * Android gets a true colored glow — `shadow*` is iOS-only, and `elevation`
 * alone cannot produce a colored halo.
 */
export function PagePaySpinner({ size = 48 }: PagePaySpinnerProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const outerRotation = useSharedValue(0);
  const outerOpacity = useSharedValue(1);
  const innerRotation = useSharedValue(0);
  const innerScale = useSharedValue(1);
  const innerOpacity = useSharedValue(0.85);
  const dotScale = useSharedValue(1);
  const dotOpacity = useSharedValue(1);
  const dotGlowScale = useSharedValue(1);
  const dotGlowOpacity = useSharedValue(0.45);

  useEffect(() => {
    outerRotation.value = withRepeat(
      withTiming(360, { duration: 2000, easing: Easing.linear }),
      -1,
      false,
    );
    outerOpacity.value = withRepeat(
      withTiming(0.55, { duration: 1600, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );

    innerRotation.value = withRepeat(
      withTiming(-360, { duration: 2500, easing: Easing.linear }),
      -1,
      false,
    );
    innerScale.value = withRepeat(
      // Bumped from 1.15 to 1.28 — at 48px the original was barely visible.
      withTiming(1.28, { duration: 1800, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );
    innerOpacity.value = withRepeat(
      withTiming(0.55, { duration: 1200, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );

    dotScale.value = withRepeat(
      withTiming(1.35, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );
    dotOpacity.value = withRepeat(
      withTiming(0.55, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );
    dotGlowScale.value = withRepeat(
      withTiming(1.9, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );
    dotGlowOpacity.value = withRepeat(
      withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );
  }, [
    dotGlowOpacity,
    dotGlowScale,
    dotOpacity,
    dotScale,
    innerOpacity,
    innerRotation,
    innerScale,
    outerOpacity,
    outerRotation,
  ]);

  const outerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${outerRotation.value}deg` }],
    opacity: outerOpacity.value,
  }));

  const innerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${innerRotation.value}deg` },
      { scale: innerScale.value },
    ],
    opacity: innerOpacity.value,
  }));

  const dotAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: dotScale.value }],
    opacity: dotOpacity.value,
  }));

  const dotGlowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: dotGlowScale.value }],
    opacity: dotGlowOpacity.value,
  }));

  const ringSize = size;
  const ringStrokeWidth = 3.5;
  const innerRingSize = size * 0.6;
  const dotSize = size * 0.28;

  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: ringStrokeWidth,
            borderColor: '#6C5CE7',
            borderTopColor: 'transparent',
            borderRightColor: 'transparent',
          },
          outerAnimatedStyle,
        ]}
      />

      <Animated.View
        style={[
          {
            position: 'absolute',
            width: innerRingSize,
            height: innerRingSize,
            borderRadius: innerRingSize / 2,
            borderWidth: ringStrokeWidth,
            borderColor: '#00B894',
            borderBottomColor: 'transparent',
            borderLeftColor: 'transparent',
          },
          innerAnimatedStyle,
        ]}
      />

      {/* Colored glow ring — visible on Android. iOS also picks this up. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: tokens.mint,
          },
          dotGlowAnimatedStyle,
        ]}
      />

      <Animated.View
        style={[
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: tokens.mint,
            // iOS-only shadow — harmless on Android, where elevation takes over.
            shadowColor: tokens.mint,
            shadowOpacity: 0.6,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
            elevation: 8,
          },
          dotAnimatedStyle,
        ]}
      />
    </View>
  );
}
