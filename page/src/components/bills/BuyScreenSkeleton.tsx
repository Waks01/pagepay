import { View, StyleSheet } from 'react-native';

import { Skeleton } from '@/components/Skeleton';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type Props = {
  /**
   * Number of form-section skeletons to render in the body. Each section
   * represents a `SectionCard` in the underlying buy screen (recipient,
   * network/biller picker, amount, etc.). Default 4 covers the typical
   * buy flow; screens with fewer sections pass a smaller number.
   */
  sections?: number;
  /**
   * Whether to render a header skeleton (back button + title row) at the
   * top of the screen. Default true.
   */
  header?: boolean;
  /**
   * Whether to render a sticky bottom CTA button skeleton. Most buy screens
   * have a "Continue" button at the bottom of the scroll view. Default true.
   */
  cta?: boolean;
};

/**
 * Skeleton placeholder for the buy-* family of screens.
 *
 * Matches the visual structure of the idle form so the layout doesn't jump
 * when real content arrives:
 *   - header row (back chevron + title)
 *   - N section cards, each with a label and 2–3 input/picker rows
 *   - bottom CTA button
 *
 * Return this in place of the idle form whenever the essential queries
 * (`isInitialLoading`) are still in flight — networks, beneficiaries,
 * billers, products, plans, etc. Different buy screens load different
 * catalogs, so callers decide which queries gate the skeleton by passing
 * their own loading flag.
 */
export function BuyScreenSkeleton({
  sections = 4,
  header = true,
  cta = true,
}: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View style={[styles.root, { backgroundColor: tokens.paper }]}>
      {/* Header row — back chevron + page title */}
      {header && (
        <View style={styles.headerRow}>
          <Skeleton width={36} height={36} borderRadius={10} />
          <Skeleton width="40%" height={20} borderRadius={6} />
        </View>
      )}

      {/* Body sections */}
      {Array.from({ length: sections }).map((_, i) => (
        <SectionSkeleton key={i} />
      ))}

      {/* Bottom CTA */}
      {cta && (
        <View style={styles.ctaWrap}>
          <Skeleton width="100%" height={52} borderRadius={14} />
        </View>
      )}
    </View>
  );
}

function SectionSkeleton() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View
      style={{
        backgroundColor: tokens.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: tokens.border,
        padding: 16,
        marginBottom: 12,
        gap: 12,
      }}
    >
      {/* Section label */}
      <Skeleton width="35%" height={12} borderRadius={6} />
      {/* Main input row — full-width with a smaller trailing element,
          mimicking the recipient/network picker fields. */}
      <Skeleton width="100%" height={48} borderRadius={12} />
      {/* Secondary line, like a hint or detected-network text */}
      <Skeleton width="55%" height={11} borderRadius={6} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  ctaWrap: {
    marginTop: 'auto',
    paddingTop: 16,
  },
});