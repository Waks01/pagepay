import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

type SectionCardProps = {
  /** Label shown in the card header (e.g. "Network", "Amount"). */
  label?: string;
  /** Optional element rendered to the right of the label (counters, badges). */
  accessory?: ReactNode;
  /** Card body. */
  children: ReactNode;
  /** Extra style overrides for the outer card. */
  style?: ViewStyle;
};

/**
 * Section card — the standard visual container for VTU screens.
 * Wraps a label + body in a card with the brand border + background.
 */
export function SectionCard({ label, accessory, children, style }: SectionCardProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tokens.card, borderColor: tokens.border },
        style,
      ]}
    >
      {label && (
        <View style={styles.header}>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>{label}</Text>
          {accessory}
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
});
