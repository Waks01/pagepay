import { Pressable, StyleSheet, Text, View, StyleProp, ViewStyle } from 'react-native';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type CategoryChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** Visually quieter (used in horizontal scrollers inside cards). */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The horizontal pill used for category browsing on Home and for the filter row
 * on Catalog.
 *
 * Resting state: cream-paper background, ink text, hairline border.
 * Selected state: solid mint, mintText label, no border — same fill as the
 * primary button so the user learns one "go" pattern.
 *
 * Tapping fires `onPress`. The press scale lives on the outer Pressable so the
 * label and pill both compress together.
 */
export function CategoryChip({
  label,
  selected = false,
  onPress,
  compact = false,
  style,
}: CategoryChipProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.base,
        compact ? styles.compact : null,
        {
          backgroundColor: selected ? tokens.mint : tokens.card,
          borderColor: selected ? tokens.mint : tokens.border,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          compact ? styles.labelCompact : null,
          {
            color: selected ? tokens.mintText : tokens.ink,
            fontFamily: 'SpaceGrotesk_500Medium',
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.1,
  },
  labelCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
});

// re-exported for screens that compose the chip into a horizontal scroller
export const CategoryChipRow = ({ children }: { children: React.ReactNode }) => (
  <View style={{ flexDirection: 'row', gap: 8 }}>{children}</View>
);
