import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PagePaySpinner } from './PagePaySpinner';
import { PagePay, Fonts } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type AnimatedSubmitButtonProps = {
  title: string;
  onPress: () => void;
  isLoading?: boolean;
  isSuccess?: boolean;
  isError?: boolean;
  disabled?: boolean;
};

/**
 * Submit button with state choreography.
 *
 * State machine: idle → loading → success | error → idle.
 *
 * Background color now drives off a single `bgProgress` shared value (0=idle,
 * 1=loading-tinted, 2=success, 3=error) and is interpolated on the UI thread.
 * The success state uses a deeper green than the primary to read as a
 * positive confirmation, not a no-op. Press feedback uses a 0.96 scale with
 * `withSequence` to bounce back. Haptics fire on every state transition.
 */
export function AnimatedSubmitButton({
  title,
  onPress,
  isLoading = false,
  isSuccess = false,
  isError = false,
  disabled = false,
}: AnimatedSubmitButtonProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const scaleValue = useSharedValue(1);
  const textOpacity = useSharedValue(1);
  const spinnerOpacity = useSharedValue(0);
  const checkmarkOpacity = useSharedValue(0);
  const checkmarkScale = useSharedValue(0.6);

  // Single source of truth for the background color: 0=primary, 1=loading,
  // 2=success (deeper), 3=error (signal). All transitions are interpolated.
  const bgProgress = useSharedValue(0);

  useEffect(() => {
    if (isLoading) {
      textOpacity.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
      spinnerOpacity.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
      checkmarkOpacity.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) });
      bgProgress.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
      Haptics.selectionAsync().catch(() => undefined);
    } else if (isSuccess) {
      spinnerOpacity.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.cubic) });
      checkmarkOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
      checkmarkScale.value = withSequence(
        withTiming(1.25, { duration: 180, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: 120, easing: Easing.inOut(Easing.cubic) }),
      );
      bgProgress.value = withTiming(2, { duration: 280, easing: Easing.out(Easing.cubic) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } else if (isError) {
      textOpacity.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
      spinnerOpacity.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) });
      checkmarkOpacity.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) });
      // Flash to error red, then settle back to primary.
      bgProgress.value = withSequence(
        withTiming(3, { duration: 80, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 600, easing: Easing.inOut(Easing.cubic) }),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } else {
      textOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
      spinnerOpacity.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.cubic) });
      checkmarkOpacity.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) });
      checkmarkScale.value = 0.6;
      bgProgress.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    }
  }, [
    bgProgress,
    checkmarkOpacity,
    checkmarkScale,
    isError,
    isLoading,
    isSuccess,
    spinnerOpacity,
    textOpacity,
  ]);

  const scaleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleValue.value }],
  }));

  const textAnimatedStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
  }));

  const spinnerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: spinnerOpacity.value,
  }));

  const checkmarkAnimatedStyle = useAnimatedStyle(() => ({
    opacity: checkmarkOpacity.value,
    transform: [{ scale: checkmarkScale.value }],
  }));

  // Deeper green for the success state so it reads as "confirmed" rather
  // than identical to the idle primary. On dark scheme the brighter mint
  // works as both, so we saturate it slightly there.
  const successColor = scheme === 'dark' ? tokens.mint : '#0A6B58';
  const loadingColor = scheme === 'dark' ? '#1F7A5C' : '#0B6B58';

  const backgroundAnimatedStyle = useAnimatedStyle(() => {
    // Two-stage interpolation: 0→1 (primary→loading-tint), 1→2 (→success), 2→3 (→error).
    if (bgProgress.value <= 1) {
      return {
        backgroundColor: interpolateColor(
          bgProgress.value,
          [0, 1],
          [tokens.mint, loadingColor],
        ),
      };
    }
    if (bgProgress.value <= 2) {
      return {
        backgroundColor: interpolateColor(
          bgProgress.value,
          [1, 2],
          [loadingColor, successColor],
        ),
      };
    }
    return {
      backgroundColor: interpolateColor(
        bgProgress.value,
        [2, 3],
        [successColor, tokens.signal],
      ),
    };
  });

  return (
    <Animated.View
      style={[
        { overflow: 'hidden', borderRadius: 12 },
        scaleAnimatedStyle,
      ]}
    >
      <Animated.View style={[{ borderRadius: 12 }, backgroundAnimatedStyle]}>
        <Pressable
          onPress={onPress}
          onPressIn={() => {
            scaleValue.value = withTiming(0.96, {
              duration: 90,
              easing: Easing.out(Easing.cubic),
            });
          }}
          onPressOut={() => {
            scaleValue.value = withTiming(1, {
              duration: 140,
              easing: Easing.out(Easing.cubic),
            });
          }}
          disabled={disabled || isLoading || isSuccess}
          style={{
            paddingHorizontal: 24,
            paddingVertical: 14,
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 52,
            borderRadius: 12,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Animated.Text
            style={[
              {
                fontSize: 16,
                fontWeight: '700',
                color: tokens.mintText,
                fontFamily: Fonts.display,
                letterSpacing: 0.2,
                position: 'absolute',
              },
              textAnimatedStyle,
            ]}
          >
            {title}
          </Animated.Text>

          <Animated.View
            style={[{ position: 'absolute' }, spinnerAnimatedStyle]}
            pointerEvents="none"
          >
            <PagePaySpinner size={24} />
          </Animated.View>

          <Animated.View
            style={[{ position: 'absolute' }, checkmarkAnimatedStyle]}
            pointerEvents="none"
          >
            <Ionicons name="checkmark-circle" size={24} color={tokens.mintText} />
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
