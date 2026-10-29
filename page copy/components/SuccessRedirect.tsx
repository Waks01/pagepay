import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedPageMark } from './AnimatedPageMark';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type SuccessRedirectProps = {
  visible?: boolean;
};

/**
 * Full-screen success overlay shown on auth completion.
 *
 * Sequence (all on the UI thread via `withDelay`):
 * 1. Overlay fade-in (200ms)
 * 2. PageMark bounce + rotate (400ms)
 * 3. Ring 1 expand (delayed 150ms, 600ms)
 * 4. Ring 2 expand (delayed 250ms, 700ms)
 * 5. Checkmark scale-in with bounce (delayed 200ms, 330ms)
 * 6. Glow halo expand (delayed 200ms, 300ms)
 * 7. Overlay fade-out (delayed 900ms, 300ms) before navigation
 */
export function SuccessRedirect({ visible = false }: SuccessRedirectProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const overlayOpacity = useSharedValue(0);
  const markScale = useSharedValue(0);
  const markRotation = useSharedValue(-180);
  const checkScale = useSharedValue(0);
  const checkRotation = useSharedValue(-90);
  const checkGlowScale = useSharedValue(0);
  const ring1Scale = useSharedValue(0);
  const ring1Opacity = useSharedValue(1);
  const ring2Scale = useSharedValue(0);
  const ring2Opacity = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      overlayOpacity.value = withTiming(1, {
        duration: 200,
        easing: Easing.out(Easing.cubic),
      });

      markScale.value = withSequence(
        withTiming(1.6, { duration: 320, easing: Easing.out(Easing.cubic) }),
        withTiming(1.3, { duration: 80, easing: Easing.inOut(Easing.cubic) }),
      );
      markRotation.value = withTiming(0, {
        duration: 400,
        easing: Easing.out(Easing.cubic),
      });

      checkScale.value = withDelay(
        200,
        withSequence(
          withTiming(1.3, { duration: 250, easing: Easing.out(Easing.cubic) }),
          withTiming(1.0, { duration: 80, easing: Easing.inOut(Easing.cubic) }),
        ),
      );
      checkRotation.value = withDelay(
        200,
        withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) }),
      );
      checkGlowScale.value = withDelay(
        200,
        withTiming(1.5, { duration: 300, easing: Easing.out(Easing.cubic) }),
      );

      ring1Scale.value = withDelay(
        150,
        withTiming(2.2, { duration: 600, easing: Easing.out(Easing.cubic) }),
      );
      ring1Opacity.value = withDelay(
        150,
        withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) }),
      );

      ring2Scale.value = withDelay(
        250,
        withTiming(2.5, { duration: 700, easing: Easing.out(Easing.cubic) }),
      );
      ring2Opacity.value = withDelay(
        250,
        withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) }),
      );

      overlayOpacity.value = withDelay(
        900,
        withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) }),
      );
    } else {
      overlayOpacity.value = 0;
      markScale.value = 0;
      markRotation.value = -180;
      checkScale.value = 0;
      checkRotation.value = -90;
      checkGlowScale.value = 0;
      ring1Scale.value = 0;
      ring1Opacity.value = 1;
      ring2Scale.value = 0;
      ring2Opacity.value = 1;
    }
  }, [
    checkGlowScale,
    checkRotation,
    checkScale,
    markRotation,
    markScale,
    overlayOpacity,
    ring1Opacity,
    ring1Scale,
    ring2Opacity,
    ring2Scale,
    visible,
  ]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const markStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: markScale.value },
      { rotate: `${markRotation.value}deg` },
    ],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: checkScale.value },
      { rotate: `${checkRotation.value}deg` },
    ],
  }));

  const checkGlowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkGlowScale.value }],
    opacity: interpolate(checkGlowScale.value, [0, 1.5], [0, 0.3], Extrapolate.CLAMP),
  }));

  const ring1Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring1Scale.value }],
    opacity: ring1Opacity.value,
  }));

  const ring2Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring2Scale.value }],
    opacity: ring2Opacity.value,
  }));

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="auto"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: tokens.paper,
          zIndex: 9999,
        },
        overlayStyle,
      ]}
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: 80,
              height: 80,
              borderRadius: 40,
              borderWidth: 2,
              borderColor: tokens.mint,
            },
            ring1Style,
          ]}
        />

        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: 100,
              height: 100,
              borderRadius: 50,
              borderWidth: 1.5,
              borderColor: tokens.mint,
            },
            ring2Style,
          ]}
        />

        <Animated.View style={markStyle}>
          <AnimatedPageMark width={80} height={5} variant="idle" />
        </Animated.View>

        <View style={{ height: 32 }} />

        {/* Glow halo — colored, not a second icon */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: 140,
              height: 140,
              borderRadius: 70,
              backgroundColor: tokens.mint,
            },
            checkGlowStyle,
          ]}
        />

        <Animated.View style={checkStyle}>
          <Ionicons
            name="checkmark-circle"
            size={100}
            color={tokens.mint}
            style={{
              // iOS shadow only — Android elevation handled by parent.
              shadowColor: tokens.mint,
              shadowOpacity: 0.4,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 0 },
            }}
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
}
