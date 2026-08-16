import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

type PlanGridProps<T> = {
  items: ReadonlyArray<T>;
  isActive: (item: T) => boolean;
  onSelect: (item: T) => void;
  /** Primary visible string (e.g. size, name, denomination). */
  primary: (item: T) => string;
  /** Secondary visible string (e.g. validity, network). */
  secondary?: (item: T) => string | undefined;
  /** Tertiary visible string (e.g. price) — rendered mint. */
  tertiary?: (item: T) => string | undefined;
  /** Override the default 47% column width. */
  cardWidth?: string | number;
  /** Hide the mint checkmark on the active card. */
  hideCheck?: boolean;
  /** Empty-state placeholder when `items` is empty. */
  emptyLabel?: string;
  /** Extra style for the outer grid. */
  style?: ViewStyle;
};

/**
 * PlanGrid — 2-col grid of selectable cards with mint checkmark on the active card.
 * Generic over the item type so each screen supplies its own renderer.
 */
export function PlanGrid<T>({
  items,
  isActive,
  onSelect,
  primary,
  secondary,
  tertiary,
  cardWidth = '47%',
  hideCheck = false,
  emptyLabel,
  style,
}: PlanGridProps<T>) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  if (items.length === 0 && emptyLabel) {
    return (
      <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>{emptyLabel}</Text>
    );
  }

  return (
    <View style={[styles.grid, style]}>
      {items.map((item, idx) => {
        const active = isActive(item);
        const sec = secondary?.(item);
        const ter = tertiary?.(item);
        return (
          <TouchableOpacity
            key={idx}
            onPress={() => onSelect(item)}
            style={[
              styles.card,
              {
                width: cardWidth as ViewStyle['width'],
                backgroundColor: active ? tokens.mintSoft : tokens.paper,
                borderColor: active ? tokens.mint : tokens.border,
              },
            ]}
          >
            {active && !hideCheck && (
              <View style={styles.check}>
                <Ionicons name="checkmark" size={10} color="#fff" />
              </View>
            )}
            <Text style={[styles.primary, { color: tokens.ink }]} numberOfLines={1}>
              {primary(item)}
            </Text>
            {sec && (
              <Text style={[styles.secondary, { color: tokens.inkMuted }]} numberOfLines={1}>
                {sec}
              </Text>
            )}
            {ter && (
              <Text style={[styles.tertiary, { color: tokens.mint }]}>{ter}</Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  card: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    position: 'relative',
  },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#0E7C66',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  secondary: {
    fontSize: 10,
    fontWeight: '500',
  },
  tertiary: {
    fontSize: 13,
    fontWeight: '600',
  },
});
