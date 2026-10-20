/**
 * Native advanced ad, styled to match PagePay's card UI.
 *
 * Native ads are rendered by the app, so the layout is ours - which
 * means it has to be visually distinct from real content, not just
 * shoved into a card. The "Ad" label and the muted border keep it
 * readable as an advertisement.
 *
 * The ad is only rendered once it has loaded, so the feed does not
 * reflow when it arrives.
 */

import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeAdView } from 'react-native-google-mobile-ads';

import { useNativeAd } from '@/src/shared/lib/ads';
import { useCurrentUser } from '@/src/shared/lib/current-user';
import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

export function NativeAdCard({
  style,
  onPress,
}: {
  style?: object;
  onPress?: () => void;
}) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const user = useCurrentUser();
  const nativeAd = useNativeAd(user?.id);
  const [failed, setFailed] = useState(false);

  if (!nativeAd || failed) return null;

  const icon = nativeAd.icon?.url;
  // The creative images live on the ad itself; `mediaContent` only
  // carries aspect ratio and video metadata.
  const image = nativeAd.images?.[0]?.url;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tokens.card, borderColor: tokens.border },
        style,
      ]}
    >
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: tokens.inkFaint }]}>Ad</Text>
      </View>

      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={nativeAd.headline || 'Sponsored'}
        style={styles.body}
      >
        {image ? (
          <Image source={{ uri: image }} style={styles.media} resizeMode="cover" />
        ) : null}

        <View style={styles.text}>
          {icon ? (
            <Image source={{ uri: icon }} style={styles.icon} />
          ) : null}
          <Text
            style={[styles.headline, { color: tokens.ink }]}
            numberOfLines={2}
          >
            {nativeAd.headline}
          </Text>
          {nativeAd.body ? (
            <Text
              style={[styles.description, { color: tokens.inkMuted }]}
              numberOfLines={3}
            >
              {nativeAd.body}
            </Text>
          ) : null}
          {nativeAd.callToAction ? (
            <View style={[styles.cta, { backgroundColor: tokens.mintSoft }]}>
              <Text style={[styles.ctaText, { color: tokens.mint }]}>
                {nativeAd.callToAction}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {nativeAd.advertiser ? (
        <Text style={[styles.advertiser, { color: tokens.inkFaint }]}>
          {nativeAd.advertiser}
        </Text>
      ) : null}

      <NativeAdView nativeAd={nativeAd} style={styles.hidden} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    fontFamily: Fonts.sans,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  body: {
    flexDirection: 'row',
    gap: 12,
  },
  media: {
    width: 84,
    height: 84,
    borderRadius: 10,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  icon: {
    width: 20,
    height: 20,
    borderRadius: 4,
  },
  headline: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '700',
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 17,
  },
  cta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 2,
  },
  ctaText: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    fontWeight: '700',
  },
  advertiser: {
    fontFamily: Fonts.sans,
    fontSize: 10,
  },
  // The native ad view must be mounted for the assets to register,
  // but it is not drawn - the fields above are rendered by us.
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },
});
