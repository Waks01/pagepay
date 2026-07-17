import React, { useEffect, useState } from 'react';
import { View, Pressable, Text, LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
  interpolateColor,
  Extrapolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { PagePay, Fonts } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type AuthTabSwitchProps = {
  activeTab: 'login' | 'register';
  onTabChange: (tab: 'login' | 'register') => void;
};

/**
 * Tab switch with sliding underline indicator.
 *
 * Underline width and travel distance are measured at runtime via
 * `onLayout` instead of hard-coded magic numbers. Active/inactive text
 * color and scale are interpolated through a single `progress` shared
 * value (0=login active, 1=register active) so all three layers
 * (underline, login text, register text) move as one.
 */
export function AuthTabSwitch({ activeTab, onTabChange }: AuthTabSwitchProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [tabWidth, setTabWidth] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(activeTab === 'login' ? 0 : 1, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
  }, [activeTab, progress]);

  const onContainerLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width / 2;
    if (w !== tabWidth) setTabWidth(w);
  };

  const underlineStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(progress.value, [0, 1], [0, tabWidth], Extrapolate.CLAMP),
      },
    ],
    // Subtle stretch on settle so the underline lands with a hint of bounce.
    scaleX: interpolate(progress.value, [0, 0.5, 1], [1, 1.04, 1], Extrapolate.CLAMP),
  }));

  const loginStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 0.95], Extrapolate.CLAMP) }],
    color: interpolateColor(progress.value, [0, 1], [tokens.ink, tokens.inkMuted]),
  }));

  const registerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.95, 1], Extrapolate.CLAMP) }],
    color: interpolateColor(progress.value, [0, 1], [tokens.inkMuted, tokens.ink]),
  }));

  const handleChange = (tab: 'login' | 'register') => {
    if (tab === activeTab) return;
    Haptics.selectionAsync().catch(() => undefined);
    onTabChange(tab);
  };

  return (
    <View
      onLayout={onContainerLayout}
      style={{
        flexDirection: 'row',
        marginBottom: 28,
        borderBottomWidth: 1,
        borderBottomColor: tokens.border,
        position: 'relative',
      }}
    >
      <Pressable
        onPress={() => handleChange('login')}
        style={{ flex: 1, paddingVertical: 16, alignItems: 'center' }}
        accessibilityRole="tab"
        accessibilityState={{ selected: activeTab === 'login' }}
      >
        <Animated.Text
          style={[
            {
              fontFamily: Fonts.display,
              fontSize: 16,
              fontWeight: '600',
              letterSpacing: -0.3,
            },
            loginStyle,
          ]}
        >
          Sign in
        </Animated.Text>
      </Pressable>

      <Pressable
        onPress={() => handleChange('register')}
        style={{ flex: 1, paddingVertical: 16, alignItems: 'center' }}
        accessibilityRole="tab"
        accessibilityState={{ selected: activeTab === 'register' }}
      >
        <Animated.Text
          style={[
            {
              fontFamily: Fonts.display,
              fontSize: 16,
              fontWeight: '600',
              letterSpacing: -0.3,
            },
            registerStyle,
          ]}
        >
          Create account
        </Animated.Text>
      </Pressable>

      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: tabWidth || '50%',
            height: 3,
            backgroundColor: tokens.mint,
            borderRadius: 1.5,
          },
          underlineStyle,
        ]}
      />
    </View>
  );
}
