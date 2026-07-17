import { ActivityIndicator, Pressable, StyleSheet, Text, StyleProp, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The PagePay primary CTA: solid mint, full width, press-scale, haptic,
 * spinner-while-loading. Used for the auth submit and any primary screen action.
 */
export function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  style,
}: PrimaryButtonProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const isInert = loading || disabled;
  const bg = isInert ? tokens.border : tokens.mint;
  const fg = isInert ? tokens.inkMuted : tokens.mintText;

  return (
    <Pressable
      onPress={() => {
        if (!isInert) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPress();
        }
      }}
      disabled={isInert}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isInert, busy: loading }}
      style={({ pressed }) => [
        styles.btn,
        style,
        {
          backgroundColor: bg,
          transform: [{ scale: pressed && !isInert ? 0.97 : 1 }],
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Text style={[styles.label, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});