import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

export type ContentItem = {
  id: number;
  title: string;
  content_type: string;
  category: string;
  author: string | null;
  estimated_read_minutes: number;
  is_sponsored: boolean;
};

type ContentCardProps = {
  item: ContentItem;
  onPress: () => void;
};

/**
 * Phase-1 base reading rate (5 pts per 10 minutes verified). Surfacing this on
 * the card makes the value prop legible without a tooltip — the user can scan
 * the feed and instantly see what each piece is worth.
 */
const POINTS_PER_MINUTE = 0.5;

function estimatePoints(item: ContentItem): number {
  return Math.max(1, Math.round(item.estimated_read_minutes * POINTS_PER_MINUTE));
}

/**
 * Map a category to a soft cover band color. We don't have real cover images
 * yet, so the band carries the category identity — Classics reads as cream,
 * Fiction as mint, News as paper, Study as warm signal. Honest placeholder that
 * still teaches the user how the categories relate.
 */
function coverBand(category: string, isSponsored: boolean, tokens: ReturnType<typeof getTokens>) {
  if (isSponsored) return tokens.signalSoft;
  const c = category.toLowerCase();
  if (c.includes('classic')) return tokens.mintSoft;
  if (c.includes('fiction') || c.includes('novel')) return tokens.mintSoft;
  if (c.includes('news') || c.includes('article')) return tokens.paper;
  if (c.includes('study') || c.includes('exam')) return tokens.signalSoft;
  return tokens.border;
}

function getTokens(scheme: 'light' | 'dark') {
  return PagePay[scheme];
}

/**
 * The single card used for organic + sponsored reads on Home. Designed for a
 * vertical feed, not horizontal scroll. Each card has:
 *   - A 6px color band at the top keyed to the category
 *   - Title (SpaceGrotesk 600)
 *   - Author • minutes meta row
 *   - Bottom row: mint "Earn ~N pts" pill on the left, "Read →" affordance on
 *     the right
 *   - Sponsored rows add a tiny "Sponsored" label in the band
 *
 * No images, no cover art, no sponsored-stock photo. The band is the visual
 * anchor — keeps the card honest in Phase 1 and easy to swap to real covers in
 * Phase 2 without a layout reflow.
 */
export function ContentCard({ item, onPress }: ContentCardProps) {
  const scheme = useEffectiveScheme();
  const tokens = getTokens(scheme);

  const bandColor = coverBand(item.category, item.is_sponsored, tokens);
  const points = estimatePoints(item);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.estimated_read_minutes} minute read, earn about ${points} points`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: tokens.card,
          borderColor: tokens.border,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={[styles.band, { backgroundColor: bandColor, height: item.is_sponsored ? 16 : 6 }]}>
        {item.is_sponsored ? (
          <Text style={[styles.sponsoredLabel, { color: tokens.signal }]}>
            • Sponsored
          </Text>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text
          numberOfLines={2}
          style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
        >
          {item.title}
        </Text>

        <View style={styles.metaRow}>
          <Text numberOfLines={1} style={[styles.meta, { color: tokens.inkMuted }]}>
            {item.author || 'Unknown'}
          </Text>
          <View style={[styles.dot, { backgroundColor: tokens.border }]} />
          <Text style={[styles.meta, { color: tokens.inkMuted }]}>
            {item.estimated_read_minutes} min
          </Text>
        </View>

        <View style={styles.footer}>
          <View style={[styles.pointsPill, { backgroundColor: tokens.mintSoft }]}>
            <Ionicons name="wallet-outline" size={12} color={tokens.mint} />
            <Text style={[styles.pointsText, { color: tokens.mint, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              Earn ~{points} pts
            </Text>
          </View>

          <View style={styles.cta}>
            <Text style={[styles.ctaText, { color: tokens.mint, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              Read
            </Text>
            <Ionicons name="arrow-forward" size={14} color={tokens.mint} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  band: {
    height: 6,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
  },
  sponsoredLabel: {
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.8,
    fontWeight: '700',
    textTransform: 'uppercase',
    right: 12,
  },
  body: {
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 17,
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  meta: {
    fontSize: 12,
    lineHeight: 16,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  pointsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pointsText: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.2,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ctaText: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
  },
});
