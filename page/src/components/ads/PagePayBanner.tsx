/**
 * Banner ad.
 *
 * Placed on the list screens only, never inside a reading or exam
 * flow. A banner in the middle of a study session is the fastest way to
 * lose a student, and AdMob's own policy treats obstructing content
 * as a policy violation.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

import {
  ACTIVE_AD_UNITS,
  reportImpressionValue,
} from '@/src/shared/lib/ads';
import { useCurrentUser } from '@/src/shared/lib/current-user';
import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

/**
 * An anchored adaptive banner, which sizes itself to the device width.
 *
 * Renders nothing until the ad has loaded, so the screen does not jump
 * when it arrives, and nothing at all if it fails to load.
 */
export function PagePayBanner({
  style,
  maxHeight = 90,
}: {
  style?: object;
  maxHeight?: number;
}) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const user = useCurrentUser();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  if (!loaded) {
    // Reserve the height so the layout does not shift when it arrives.
    return <View style={[styles.placeholder, { height: maxHeight }]} />;
  }

  return (
    <View style={[styles.container, style]}>
      <BannerAd
        unitId={ACTIVE_AD_UNITS.banner}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        maxHeight={maxHeight}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => setFailed(true)}
        onPaid={(event) => {
          void reportImpressionValue(event, 'banner');
        }}
      />
      <Text style={[styles.label, { color: tokens.inkFaint }]}>Ad</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    overflow: 'hidden',
  },
  placeholder: {
    width: '100%',
  },
  label: {
    fontFamily: Fonts.sans,
    fontSize: 9,
    marginTop: 2,
    letterSpacing: 0.4,
  },
});
