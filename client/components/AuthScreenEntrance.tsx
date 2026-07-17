import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { AnimatedPageMark } from './AnimatedPageMark';
import { PagePay, Fonts } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type AuthScreenEntranceProps = {
  title: string;
  subtitle?: string;
};

/**
 * Entrance choreography for the auth card.
 *
 * Sequence: PageMark slide-in (0-300ms) → title fade (200ms delay, 320ms)
 * → subtitle fade (400ms delay, 320ms). All delays are now driven by
 * `withDelay` worklets so the animations stay on the UI thread and never
 * fire after unmount (the old `setTimeout` version could leak warnings).
 */
export function AuthScreenEntrance({
  title,
  subtitle,
}: AuthScreenEntranceProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const markTranslateX = useSharedValue(-50);
  const markOpacity = useSharedValue(0);
  const titleOpacity = useSharedValue(0);
  const subtitleOpacity = useSharedValue(0);

  useEffect(() => {
    markTranslateX.value = withTiming(0, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
    markOpacity.value = withTiming(1, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });

    titleOpacity.value = withDelay(
      200,
      withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }),
    );

    if (subtitle) {
      subtitleOpacity.value = withDelay(
        400,
        withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }),
      );
    }
  }, [markOpacity, markTranslateX, subtitle, subtitleOpacity, titleOpacity]);

  const markAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: markTranslateX.value }],
    opacity: markOpacity.value,
  }));

  const titleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
  }));

  const subtitleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
  }));

  return (
    <View style={{ alignItems: 'center', marginBottom: 32, gap: 12 }}>
      <Animated.View style={markAnimatedStyle}>
        <AnimatedPageMark width={40} height={3} variant="pulse" />
      </Animated.View>

      <Animated.View style={titleAnimatedStyle}>
        <Text
          style={{
            fontFamily: Fonts.display,
            fontSize: 28,
            fontWeight: '700',
            color: tokens.ink,
            textAlign: 'center',
            letterSpacing: -0.5,
          }}
        >
          {title}
        </Text>
      </Animated.View>

      {subtitle ? (
        <Animated.View style={subtitleAnimatedStyle}>
          <Text
            style={{
              fontSize: 14,
              color: tokens.inkMuted,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            {subtitle}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}
