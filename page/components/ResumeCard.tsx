import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type ResumeCardProps = {
  title: string;
  author: string | null;
  /** 0..1 — fraction of the book already read. */
  progress: number;
  /** Minutes the user has left to finish. */
  minutesLeft: number;
  onPress: () => void;
};

/**
 * Wide resume card. The first thing on Home when there's an in-progress book.
 * The whole card is tappable; "Resume" is a visible affordance so the user
 * knows what the tap does without reading surrounding copy.
 *
 * Stub-friendly: render this component only when a resume payload exists.
 * During Phase 1 there is no in-progress endpoint yet, so Home simply hides
 * the entire "Keep reading" section when nothing is in flight.
 */
export function ResumeCard({ title, author, progress, minutesLeft, onPress }: ResumeCardProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  // Clamp once; the prop is trusted but no reason to draw a 110% bar.
  const p = Math.max(0, Math.min(1, progress));
  const pct = Math.round(p * 100);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Resume ${title}, ${pct} percent read, about ${minutesLeft} minutes left`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: tokens.mint,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            style={[
              styles.eyebrow,
              { color: tokens.mintText, fontFamily: 'SpaceGrotesk_500Medium' },
            ]}
          >
            KEEP READING
          </Text>
          <Text
            numberOfLines={2}
            style={[
              styles.title,
              { color: tokens.mintText, fontFamily: 'SpaceGrotesk_700Bold' },
            ]}
          >
            {title}
          </Text>
          {author ? (
            <Text style={[styles.author, { color: tokens.mintText }]}>
              {author}
            </Text>
          ) : null}
        </View>

        <View
          style={[
            styles.iconBubble,
            { backgroundColor: tokens.mintText, opacity: 0.18 },
          ]}
        >
          <Ionicons name="book" size={20} color={tokens.mintText} />
        </View>
      </View>

      <View style={[styles.barTrack, { backgroundColor: tokens.mintText, opacity: 0.22 }]}>
        <View
          style={[
            styles.barFill,
            {
              backgroundColor: tokens.mintText,
              opacity: 1,
              width: `${pct}%`,
            },
          ]}
        />
      </View>

      <View style={styles.footerRow}>
        <Text style={[styles.progress, { color: tokens.mintText }]}>
          {pct}% · {minutesLeft} min left
        </Text>
        <View style={[styles.resumeCta, { backgroundColor: tokens.mintText }]}>
          <Text
            style={[
              styles.resumeCtaText,
              { color: tokens.mint, fontFamily: 'SpaceGrotesk_700Bold' },
            ]}
          >
            Resume
          </Text>
          <Ionicons name="arrow-forward" size={14} color={tokens.mint} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    // Carousel-friendly: fixed width so cards line up in a horizontal
    // scroller with consistent widths. Tall enough to show title +
    // progress + CTA without dominating the home screen.
    width: 260,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    opacity: 0.8,
  },
  title: {
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.2,
    opacity: 0.96,
  },
  author: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.78,
  },
  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    borderRadius: 2,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progress: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.85,
  },
  resumeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  resumeCtaText: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
  },
});
