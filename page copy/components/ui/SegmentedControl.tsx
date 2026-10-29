/**
 * SegmentedControl — a three-segment pill (iOS-style) for mutually-exclusive
 * choices. Used by:
 *   - The reader's Read/Study/Listen mode switcher (v3 §3.4)
 *   - The catalog's education level / class picker
 *
 * Design rules:
 *   - Exactly one segment is selected at a time (caller controls the
 *     selected value via props; the component is fully controlled).
 *   - The active segment uses tokens.mint background + tokens.mintText
 *     label so it pops on every scheme (light, dark, sepia).
 *   - Inactive segments use tokens.paper background + tokens.inkMuted
 *     so they're visible but clearly secondary.
 *   - Hit slop is generous — segmented controls live at the bottom of
 *     a scroll, where thumbs land sloppily.
 *   - The component does not own an `onChange` state; it's a controlled
 *     input. The parent owns `value` and reacts to `onChange`.
 *
 * Why not <Picker> or <RadioGroup>: <Picker> is a wheel dialog on iOS
 * (way too heavy for a 3-option switch), and React Native doesn't ship
 * a RadioGroup. A row of 3 tappable pill segments is the right shape
 * for "pick one of N=2..4 short labels" in mobile.
 */

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  icon?: string; // optional Ionicons name, rendered before the label
};

type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T | null;
  onChange: (next: T) => void;
  activeBackground: string;
  activeText: string;
  inactiveBackground: string;
  inactiveText: string;
  borderColor: string;
  accessibilityLabel?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  activeBackground,
  activeText,
  inactiveBackground,
  inactiveText,
  borderColor,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  return (
    <View
      style={[
        styles.root,
        { backgroundColor: inactiveBackground, borderColor },
      ]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.7}
            hitSlop={6}
            style={[
              styles.segment,
              {
                backgroundColor: selected ? activeBackground : 'transparent',
              },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
          >
            <Text
              style={[
                styles.segmentText,
                {
                  color: selected ? activeText : inactiveText,
                },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: 1,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
