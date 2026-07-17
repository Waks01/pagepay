import React, { ReactNode, useEffect, useState } from 'react';
import {
  TextInput as RNTextInput,
  TextInputProps,
  View,
  Text,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
  interpolateColor,
  Extrapolate,
} from 'react-native-reanimated';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type AnimatedInputProps = TextInputProps & {
  label?: string;
  error?: string;
  borderColor?: string;
  rightIcon?: ReactNode;
};

/**
 * Animated input field with focus/error transitions.
 *
 * All four shared values (border, underline, label, glow) are wired into
 * animated styles — none of them are dead code like in the previous version.
 * Border and label color transitions use `interpolateColor` so they run on
 * the UI thread. The shake-on-error is delegated to the parent <ErrorShake>
 * wrapper (the input itself is rendered on a stable shell so Android does
 * not steal focus mid-keystroke).
 */
export function AnimatedInput({
  label,
  error,
  borderColor: customBorderColor,
  rightIcon,
  ...props
}: AnimatedInputProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [isFocused, setIsFocused] = useState(false);
  const hasError = Boolean(error);

  // 0 = idle, 1 = focused, 2 = error. One timeline, one source of truth.
  const focusProgress = useSharedValue(0);
  const errorProgress = useSharedValue(0);
  const underlineScale = useSharedValue(0);
  const labelScale = useSharedValue(1);
  const labelOpacity = useSharedValue(0.7);
  const bgOpacity = useSharedValue(0);
  const glowOpacity = useSharedValue(0);

  useEffect(() => {
    focusProgress.value = withTiming(isFocused ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    underlineScale.value = withTiming(isFocused ? 1 : 0, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
    labelScale.value = withTiming(isFocused ? 0.88 : 1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    labelOpacity.value = withTiming(isFocused ? 1 : 0.7, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    bgOpacity.value = withTiming(isFocused ? 0.04 : 0, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
    glowOpacity.value = withTiming(isFocused ? 0.2 : 0, {
      duration: 360,
      easing: Easing.out(Easing.cubic),
    });
  }, [
    bgOpacity,
    focusProgress,
    glowOpacity,
    isFocused,
    labelOpacity,
    labelScale,
    underlineScale,
  ]);

  useEffect(() => {
    errorProgress.value = withTiming(hasError ? 1 : 0, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [errorProgress, hasError]);

  const underlineStyle = useAnimatedStyle(() => ({
    scaleX: underlineScale.value,
    opacity: interpolate(underlineScale.value, [0, 1], [0, 1], Extrapolate.CLAMP),
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const bgStyle = useAnimatedStyle(() => ({
    opacity: bgOpacity.value,
  }));

  // Border color: idle → focused (mint) → error (signal). Driven entirely on
  // the UI thread by interpolating the focus and error progress values.
  const animatedBorderStyle = useAnimatedStyle(() => {
    const border = interpolateColor(
      focusProgress.value,
      [0, 1],
      [customBorderColor ?? tokens.border, tokens.mint],
    );
    const color = interpolateColor(
      errorProgress.value,
      [0, 1],
      [border, tokens.signal],
    );
    return { borderBottomColor: color };
  });

  // Label color + scale + opacity combined into a single animated style
  // so we apply one object to the text component (Reanimated 4's type
  // system rejects mixed animated + static entries in style arrays when
  // one of the animated entries returns a non-TextStyle shape).
  const animatedLabelStyle = useAnimatedStyle(() => {
    const baseColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [tokens.inkMuted, tokens.ink],
    );
    const color = interpolateColor(
      errorProgress.value,
      [0, 1],
      [baseColor, tokens.signal],
    );
    return {
      color,
      opacity: labelOpacity.value,
      transform: [{ scale: labelScale.value }],
    };
  });

  return (
    <View style={{ gap: 8 }}>
      {label ? (
        <Animated.Text
          style={[
            {
              fontSize: 13,
              fontWeight: '500',
              color: tokens.inkMuted,
            },
            animatedLabelStyle,
          ]}
        >
          {label}
        </Animated.Text>
      ) : null}

      <View style={{ position: 'relative' }}>
        {/* Glow background (mint halo on focus) */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: tokens.mint,
              borderRadius: 8,
            },
            glowStyle,
          ]}
        />

        {/* Soft tint behind the input */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: tokens.mintSoft,
              borderRadius: 8,
            },
            bgStyle,
          ]}
        />

        {/* Input field — stable shell, no shadow so Android does not steal focus */}
        <Animated.View
          style={[
            {
              borderBottomWidth: 2,
              borderBottomColor: customBorderColor ?? tokens.border,
              borderRadius: 8,
            },
            animatedBorderStyle,
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <RNTextInput
              {...props}
              onFocus={(e) => {
                setIsFocused(true);
                props.onFocus?.(e);
              }}
              onBlur={(e) => {
                setIsFocused(false);
                props.onBlur?.(e);
              }}
              placeholderTextColor={tokens.inkMuted}
              selectionColor={tokens.mint}
              cursorColor={tokens.mint}
              style={[
                {
                  flex: 1,
                  fontSize: 16,
                  color: tokens.ink,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  backgroundColor: 'transparent',
                },
                props.style,
              ]}
            />
            {rightIcon && (
              <View style={{ paddingRight: 8 }}>
                {rightIcon}
              </View>
            )}
          </View>
        </Animated.View>

        {/* Underline animation — sits below the border so the border reads
            as the primary focus cue. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 2,
              backgroundColor: tokens.mint,
              borderRadius: 1,
            },
            underlineStyle,
          ]}
        />
      </View>

      {error ? (
        <Text style={{ fontSize: 12, color: tokens.signal, marginTop: 4, fontWeight: '500' }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
