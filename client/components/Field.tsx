import { ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  Pressable,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type FieldProps = {
  label: string;
  helper?: string;
  error?: string | null;
  rightIcon?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
} & Omit<TextInputProps, 'style'>;

/**
 * The form field primitive used across PagePay auth.
 *
 * - Tiny uppercase label above the input.
 * - Resting border: page-paper tone. On focus: mint 2px with mintSoft 4px ring.
 * - On error: signal-color border + message below.
 * - Trailing icon slot for password eye toggle, etc.
 *
 * The internal layout is deliberately stable: the children of the shell View
 * are always the same shape (TextInput + always-mounted icon slot), and the
 * shell style is a single object per render — not an array that grows or
 * shrinks on focus. That keeps Android from re-laying-out the input and
 * stealing focus mid-keystroke.
 */
export function Field({
  label,
  helper,
  error,
  rightIcon,
  containerStyle,
  ...inputProps
}: FieldProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const hasError = Boolean(error);

  // The shell style is fully static per render. No shadow on focus — Android's
  // shadow rendering expands the view's visual bounds by a fraction of a pixel
  // on some GPUs, which is enough to trigger a layout pass that steals focus
  // and hands it to the next field. Color and border carry the focus signal.
  const shellStyle: StyleProp<ViewStyle> = hasError ? styles.shellError : styles.shell;
  const shellDynamic: ViewStyle = {
    borderColor: hasError ? tokens.signal : tokens.border,
    backgroundColor: tokens.card,
    borderRadius: 12,
  };

  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      <Text
        style={[styles.label, { color: hasError ? tokens.ink : tokens.inkMuted }]}
      >
        {label}
      </Text>

      <View style={[shellStyle, shellDynamic]}>
        <TextInput
          {...inputProps}
          placeholderTextColor={tokens.inkMuted}
          // Mint caret gives a clear focus signal without triggering any layout
          // pass — no shadow, no border change, no width change.
          selectionColor={tokens.mint}
          cursorColor={tokens.mint}
          style={[styles.input, { color: tokens.ink }]}
        />
        {rightIcon ? (
          <View style={styles.icon}>{rightIcon}</View>
        ) : (
          <View style={styles.icon} />
        )}
      </View>

      {error ? (
        <Text style={[styles.helper, { color: tokens.signal }]}>{error}</Text>
      ) : helper ? (
        <Text style={[styles.helper, { color: tokens.inkMuted }]}>{helper}</Text>
      ) : null}
    </View>
  );
}

/**
 * Convenience: a built-in password-reveal toggle that can be passed as
 * `rightIcon` on a Field with secureTextEntry.
 */
export function PasswordToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  const scheme = useEffectiveScheme();
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons
        name={visible ? 'eye-off-outline' : 'eye-outline'}
        size={20}
        color={PagePay[scheme].inkMuted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.08,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    minHeight: 52,
    borderWidth: 1,
  },
  shellError: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    minHeight: 52,
    borderWidth: 2,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    paddingVertical: 14,
  },
  icon: {
    width: 28,
    paddingLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  helper: {
    fontSize: 12,
    lineHeight: 16,
  },
});