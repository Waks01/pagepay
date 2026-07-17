/**
 * AdPlaceholder
 *
 * Shown in the four ad slots (banner, native, interstitial, rewarded)
 * while the native AdMob SDK is not yet wired. Renders a styled
 * placeholder that:
 *   - Looks like an ad ("Sponsored" eyebrow + body copy)
 *   - Tells the dev (via console + a tiny "DEV" tag) that the
 *     placeholder is intentional
 *
 * Production behavior: when the native SDK lands, this component
 * is replaced with a thin wrapper that mounts the real AdMob view
 * in the same shape (same props, same layout).
 *
 * Why no impression logging: the legacy
 * `logAdImpression()` helper was removed in the ad-system
 * security hardening pass. The /api/v1/ads/impression endpoint
 * is now 410 Gone, and the new server-authoritative flow
 * (POST /ads/request-token + AdMob SSV) doesn't need any
 * client-side impression logging — only the SSV callback
 * matters, and that fires automatically.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';


export type AdPlaceholderProps = {
  /** Which slot this placeholder fills. */
  adType: 'banner' | 'native' | 'interstitial' | 'rewarded';
  /** AdMob unit ID for the current slot. If empty,
   *  the placeholder renders the "slot disabled" state. */
  adUnit: string;
  /** Optional session id — currently unused (kept on the
   *  prop type for compatibility with existing call sites).
   *  See the file header for why. */
  sessionId?: number | null;
  /** Where the placeholder sits in the layout. */
  variant: 'banner' | 'inline' | 'interstitial' | 'fullscreen';
  /** Body copy under the eyebrow. Slot-specific. */
  body?: string;
  /** Optional tap handler — used for native ads where the
   *  whole card is the CTA. */
  onPress?: () => void;
};


export function AdPlaceholder({
  adType: _adType,
  adUnit,
  sessionId: _sessionId,
  variant,
  body,
  onPress,
}: AdPlaceholderProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  if (!adUnit) {
    // Slot disabled — render a thin "ad slot disabled" hint
    // so the layout doesn't show an empty gap. Dev builds
    // can use this to confirm the env=dev test IDs flow.
    if (__DEV__) {
      return (
        <View
          style={[
            styles.disabledBanner,
            { backgroundColor: tokens.paper, borderColor: tokens.border },
          ]}
        >
          <Ionicons name="information-circle-outline" size={14} color={tokens.inkMuted} />
          <Text style={[styles.disabledText, { color: tokens.inkMuted }]}>
            Ad slot disabled (no unit id for {variant})
          </Text>
        </View>
      );
    }
    return null;
  }

  if (variant === 'banner') {
    return (
      <View
        style={[
          styles.banner,
          { backgroundColor: tokens.signalSoft, borderColor: tokens.border },
        ]}
      >
        <View style={styles.bannerLabel}>
          <Ionicons name="megaphone-outline" size={12} color={tokens.signal} />
          <Text style={[styles.eyebrow, { color: tokens.signal }]}>Sponsored</Text>
        </View>
        <Text
          numberOfLines={1}
          style={[styles.bannerCopy, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
        >
          {body ?? 'Try Premium — unlock unlimited reads.'}
        </Text>
      </View>
    );
  }

  if (variant === 'inline' || variant === 'interstitial' || variant === 'fullscreen') {
    return (
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={`Sponsored ${_adType} placeholder`}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: tokens.card,
            borderColor: tokens.border,
            transform: [{ scale: pressed && onPress ? 0.98 : 1 }],
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={[styles.dot, { backgroundColor: tokens.signalSoft }]}>
            <Ionicons name="megaphone-outline" size={12} color={tokens.signal} />
          </View>
          <Text style={[styles.eyebrow, { color: tokens.signal }]}>Sponsored</Text>
          {__DEV__ ? (
            <View style={[styles.devPill, { borderColor: tokens.border }]}>
              <Text style={[styles.devPillText, { color: tokens.inkMuted }]}>DEV</Text>
            </View>
          ) : null}
        </View>
        <Text
          style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
        >
          {body ?? 'Your ad could live here.'}
        </Text>
        <Text style={[styles.note, { color: tokens.inkMuted }]}>
          Real AdMob slot is not wired yet — this placeholder stands in until the native
          SDK is installed (Phase 2 follow-up).
        </Text>
      </Pressable>
    );
  }

  return null;
}


const styles = StyleSheet.create({
  disabledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    marginHorizontal: 16,
  },
  disabledText: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.2,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  bannerLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bannerCopy: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  devPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  devPillText: {
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.6,
    fontWeight: '700',
  },
  title: {
    fontSize: 17,
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  note: {
    fontSize: 12,
    lineHeight: 16,
  },
});
