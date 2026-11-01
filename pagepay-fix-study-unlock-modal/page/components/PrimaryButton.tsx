import { Pressable, StyleSheet, Text, StyleProp, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePaySpinner } from './PagePaySpinner';

type Variant = 'mint' | 'ink' | 'ghost';

type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** mint (default — green earnings/CTA), ink (neutral dark CTA), ghost (outline). */
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
};

/**
 * The PagePay primary CTA: full width, press-scale, haptic,
 * spinner-while-loading. Default `variant="mint"` keeps backwards
 * compat with auth/submit screens. Use `ink` for dark neutral CTAs
 * (Study hero actions), `ghost` for secondary outline buttons.
 */
export function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'mint',
  style,
}: PrimaryButtonProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const isInert = loading || disabled;

  // Resolve colors per variant — inert state always degrades to border+inkMuted.
  let bg: string, fg: string, borderColor: string | undefined;
  if (isInert) {
    bg = tokens.border;
    fg = tokens.inkMuted;
    borderColor = undefined;
  } else if (variant === 'ghost') {
    bg = 'transparent';
    fg = tokens.ink;
    borderColor = tokens.border;
  } else if (variant === 'ink') {
    bg = tokens.ink;
    fg = tokens.paper;
    borderColor = tokens.ink;
  } else {
    bg = tokens.mint;
    fg = tokens.mintText;
    borderColor = undefined;
  }

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
        borderColor !== undefined ? { borderWidth: 1, borderColor } : null,
        style,
        {
          backgroundColor: bg,
          transform: [{ scale: pressed && !isInert ? 0.97 : 1 }],
        },
      ]}
    >
      {loading ? (
        <PagePaySpinner size={24} />
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