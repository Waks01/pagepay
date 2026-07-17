/**
 * NativeAdBanner
 *
 * Compact native ad card that blends seamlessly with content.
 * Renders AdMob Native Advanced in a small, non-intrusive format
 * that matches the app's content card style.
 *
 * Design principles:
 * - Compact height (~100-120px) to not disrupt scrolling
 * - Clear "Ad" label for transparency
 * - Same border radius and shadow as ContentCard
 * - Respects app theme (light/dark mode)
 */

import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';


export type NativeAdBannerProps = {
  /** AdMob native unit ID for in_feed slot. Empty = disabled. */
  adUnit: string;
  /** Optional session id for analytics — currently unused
   *  (the legacy impression-logging endpoint was removed in
   *  the ad-system security hardening pass). Kept on the
   *  prop type so existing call sites don't break. */
  sessionId?: number | null;
};


export function NativeAdBanner({ adUnit, sessionId }: NativeAdBannerProps) {
  void sessionId;
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [nativeAd, setNativeAd] = useState<any>(null);
  const [error, setError] = useState(false);
  const adRef = useRef<any>(null);

  useEffect(() => {
    if (!adUnit || Platform.OS === 'web') {
      return;
    }

    let isActive = true;
    let unsubClicked: (() => void) | null = null;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeAd, NativeAdEventType, NativeAdView, NativeAsset, NativeMediaView, NativeAssetType } = require('react-native-google-mobile-ads');

    NativeAd.createForAdRequest(adUnit)
      .then((ad) => {
        if (!isActive) {
          ad.destroy();
          return;
        }
        adRef.current = ad;
        setNativeAd(ad);
        setError(false);

        unsubClicked = ad.addAdEventListener(
          NativeAdEventType.CLICKED,
          () => {
            if (__DEV__) {
              console.log('[NativeAdBanner] Ad clicked');
            }
          }
        );
      })
      .catch((err) => {
        if (__DEV__) {
          console.warn('[NativeAdBanner] Failed to load ad:', err);
        }
        if (isActive) {
          setError(true);
        }
      });

    return () => {
      isActive = false;
      if (unsubClicked) unsubClicked();
      if (adRef.current) {
        adRef.current.destroy();
        adRef.current = null;
      }
    };
  }, [adUnit]);

  useEffect(() => {
    if (!nativeAd) return;
    return () => {
      nativeAd.destroy();
    };
  }, [nativeAd]);

  if (error || !nativeAd) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeAdView, NativeAsset, NativeMediaView, NativeAssetType } = require('react-native-google-mobile-ads');

    return (
      <View style={[styles.container, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
        {/* Ad Label */}
        <View style={styles.adBadge}>
          <Ionicons name="megaphone-outline" size={10} color={tokens.inkMuted} />
          <Text style={[styles.adLabel, { color: tokens.inkMuted }]}>Ad</Text>
        </View>

        {/* Native Ad Content */}
        <NativeAdView nativeAd={nativeAd} style={styles.nativeAdContent}>
          {/* Advertiser Info Row */}
          <View style={styles.advertiserRow}>
            {/* Icon */}
            {nativeAd.icon && (
              <NativeAsset assetType={NativeAssetType.ICON}>
                <Image
                  source={{ uri: nativeAd.icon.url }}
                  style={{ width: 32, height: 32, borderRadius: 6 }}
                  resizeMode="cover"
                />
              </NativeAsset>
            )}

            {/* Text Content */}
            <View style={styles.textContent}>
              {/* Headline */}
              <NativeAsset assetType={NativeAssetType.HEADLINE}>
                <Text style={[styles.headline, { color: tokens.ink }]} numberOfLines={1}>
                  {nativeAd.headline}
                </Text>
              </NativeAsset>

              {/* Body */}
              {nativeAd.body && (
                <NativeAsset assetType={NativeAssetType.BODY}>
                  <Text style={[styles.body, { color: tokens.inkMuted }]} numberOfLines={2}>
                    {nativeAd.body}
                  </Text>
                </NativeAsset>
              )}
            </View>

            {/* CTA Button */}
            {nativeAd.callToAction && (
              <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
                <View style={[styles.cta, { backgroundColor: tokens.mint }]}>
                  <Text style={styles.ctaText}>{nativeAd.callToAction}</Text>
                </View>
              </NativeAsset>
            )}
          </View>

          {/* Media Asset */}
          {nativeAd.mediaContent && (
            <NativeMediaView style={styles.media} />
          )}
        </NativeAdView>
      </View>
    );
  } catch (err) {
    if (__DEV__) {
      console.warn('[NativeAdBanner] Render failed:', err);
    }
    return null;
  }
}


const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  adBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  adLabel: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nativeAdContent: {
    flex: 1,
  },
  advertiserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  textContent: {
    flex: 1,
    gap: 2,
  },
  headline: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  body: {
    fontSize: 11,
    lineHeight: 14,
  },
  cta: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  ctaText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  media: {
    width: '100%',
    height: 60,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
});
