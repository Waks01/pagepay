/**
 * Animated splash overlay (JS handoff).
 *
 * Shows immediately after the native splash (expo-splash-screen) dismisses.
 * Runs the full animation sequence from splash.html: entry bounce on the
 * monogram, slide-up on wordmark, continuous ambient loops (8 floating
 * point tokens + 6 sparkle dots), then fades out to reveal the app.
 *
 * No Lottie — Reanimated 4 only. Matches design-preview/splash.html exactly.
 */
import { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import LinearGradient from 'react-native-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

const { width: SCREEN_W } = Dimensions.get('window');
const TOKEN_COUNT = 8;
const SPARKLE_COUNT = 6;

const MONOGRAM_XML = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" rx="224" fill="#0E7C66"/>
  <path fill="#FBFAF6" fill-rule="evenodd" d="M248 192 L600 192 C788 192 912 312 912 432 C912 552 788 672 600 672 L420 672 L420 832 L360 892 L248 892 Z M420 360 L600 360 C676 360 736 392 736 432 C736 472 676 504 600 504 L420 504 Z"/>
  <path fill="#0E7C66" d="M360 892 L420 832 L420 892 Z"/>
  <circle cx="580" cy="432" r="56" fill="#0E7C66"/>
  <circle cx="580" cy="432" r="48" fill="none" stroke="#FBFAF6" stroke-width="3" opacity="0.6"/>
  <circle cx="566" cy="418" r="6" fill="#FBFAF6" opacity="0.5"/>
  <g transform="translate(760,320)">
    <path fill="#FBFAF6" d="M0 -28 L6 -6 L28 0 L6 6 L0 28 L-6 6 L-28 0 L-6 -6 Z"/>
    <path fill="#FBFAF6" opacity="0.7" transform="translate(40,40) scale(0.4)" d="M0 -28 L6 -6 L28 0 L6 6 L0 28 L-6 6 L-28 0 L-6 -6 Z"/>
  </g>
</svg>`;

const TOKEN_SPECS = [
  { left: '8%', top: '70%', delay: 0 },
  { left: '18%', top: '78%', delay: 700 },
  { left: '78%', top: '72%', delay: 1300 },
  { left: '86%', top: '80%', delay: 2000 },
  { left: '6%', top: '86%', delay: 2600 },
  { left: '88%', top: '88%', delay: 3200 },
  { left: '26%', top: '90%', delay: 3800 },
  { left: '70%', top: '92%', delay: 4400 },
];

const SPARKLE_SPECS = [
  { left: '28%', top: '32%', delay: 0 },
  { left: '72%', top: '30%', delay: 600 },
  { left: '22%', top: '50%', delay: 1100 },
  { left: '78%', top: '52%', delay: 1500 },
  { left: '50%', top: '26%', delay: 300 },
  { left: '50%', top: '58%', delay: 1800 },
];

type SplashOverlayProps = {
  onDone: () => void;
};

function FloatingToken({ index, left, top, delayMs }: { index: number; left: string; top: string; delayMs: number }) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = 0;
    t.value = withDelay(
      delayMs,
      withRepeat(
        withTiming(1, {
          duration: 5400,
          easing: Easing.out(Easing.quad),
        }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(t);
  }, [t, delayMs]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -t.value * 220 },
      { scale: 0.9 + t.value * 0.1 },
    ],
    opacity: t.value < 0.15 ? t.value / 0.15 : 1 - t.value,
  }));

  const value = ['+1', '+5', '+9'][index % 3];

  return (
    <Animated.View
      style={[
        styles.token,
        { left: left as any, top: top as any },
        animatedStyle,
      ]}
    >
      <View
        style={[
          styles.tokenChip,
          {
            backgroundColor: tokens.mint,
            borderColor: tokens.paper,
          },
        ]}
      >
        <Animated.Text
          style={[
            styles.tokenText,
            { color: tokens.paper },
          ]}
        >
          {value}
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

function Sparkle({ left, top, delayMs }: { left: string; top: string; delayMs: number }) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = 0;
    t.value = withDelay(
      delayMs,
      withRepeat(
        withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.cubic) }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(t);
  }, [t, delayMs]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 0.6 + t.value * 0.6 },
    ],
    opacity: t.value * 0.8,
  }));

  return (
    <Animated.View
      style={[
        styles.sparkle,
        { left: left as any, top: top as any, backgroundColor: tokens.mint },
        animatedStyle,
      ]}
    />
  );
}

export function SplashOverlay({ onDone }: SplashOverlayProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const entry = useSharedValue(0);
  const fadeOut = useSharedValue(1);
  const shimmerX = useSharedValue(-1);
  const progressX = useSharedValue(-1.2);
  const breathe = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Hide the native splash to reveal this animated overlay
        await SplashScreen.hideAsync();
      } catch {
        // best-effort
      }
      if (cancelled) return;

      entry.value = withTiming(1, {
        duration: 900,
        easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      });

      shimmerX.value = withDelay(
        500,
        withTiming(1, {
          duration: 1100,
          easing: Easing.out(Easing.cubic),
        }),
      );

      progressX.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
        -1,
        true,
      );

      breathe.value = withDelay(
        900,
        withRepeat(
          withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.cubic) }),
          -1,
          true,
        ),
      );

      fadeOut.value = withDelay(
        1200,
        withTiming(
          0,
          { duration: 250, easing: Easing.in(Easing.cubic) },
          (finished) => {
            if (finished && !cancelled) runOnJS(onDone)();
          },
        ),
      );
    })();

    return () => {
      cancelled = true;
      cancelAnimation(entry);
      cancelAnimation(fadeOut);
      cancelAnimation(shimmerX);
      cancelAnimation(progressX);
      cancelAnimation(breathe);
    };
  }, [entry, fadeOut, shimmerX, progressX, breathe, onDone]);

  const monogramStyle = useAnimatedStyle(() => {
    const s = entry.value <= 0.6
      ? 0.6 + entry.value * 0.7667
      : 1.06 - (entry.value - 0.6) * 0.15;
    return {
      transform: [
        { scale: s },
        { rotate: `${(1 - entry.value) * -8}deg` },
        { scale: entry.value > 0.9 ? 1 + Math.sin((entry.value - 0.9) / 0.1 * Math.PI) * 0.04 : 1 },
      ],
      opacity: entry.value,
    };
  });

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (shimmerX.value * 2 - 1) * SCREEN_W * 0.6 }],
    opacity: shimmerX.value < 0 ? 0 : 1,
  }));

  const wordmarkStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - entry.value) * 14 }],
    opacity: entry.value,
  }));

  const progressStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progressX.value * (SCREEN_W * 2.2 - 120) }],
  }));

  const rootStyle = useAnimatedStyle(() => ({
    opacity: fadeOut.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.root,
        { backgroundColor: tokens.paper },
        rootStyle,
      ]}
    >
      {/* Background blob */}
      <View style={styles.blob}>
        <BlurView style={StyleSheet.absoluteFill} intensity={20} tint="light" />
      </View>

      {/* Floating tokens */}
      {TOKEN_SPECS.map((spec, i) => (
        <FloatingToken
          key={`tok-${i}`}
          index={i}
          left={spec.left}
          top={spec.top}
          delayMs={spec.delay}
        />
      ))}

      {/* Sparkles */}
      {SPARKLE_SPECS.map((spec, i) => (
        <Sparkle
          key={`sp-${i}`}
          left={spec.left}
          top={spec.top}
          delayMs={spec.delay}
        />
      ))}

      {/* Monogram + shimmer */}
      <Animated.View style={[styles.monogramWrap, monogramStyle]}>
        <View style={styles.shimmerWrap}>
          <SvgXml xml={MONOGRAM_XML} width="100%" height="100%" />
          <Animated.View style={[styles.shimmer, shimmerStyle]}>
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.55)', 'transparent']}
              start={{ x: 0.3, y: 0.5 }}
              end={{ x: 0.7, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
      </Animated.View>

      {/* Wordmark */}
      <Animated.View style={[styles.wordmarkWrap, wordmarkStyle]}>
        <Animated.Text style={[styles.wordmarkText, { color: tokens.mint }]}>PagePay</Animated.Text>
      </Animated.View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, progressStyle]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  blob: {
    position: 'absolute',
    width: 360,
    height: 360,
    left: '50%',
    top: '38%',
    marginLeft: -180,
    marginTop: -180,
    borderRadius: 180,
    overflow: 'hidden',
  },
  monogramWrap: {
    width: 152,
    height: 152,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shimmerWrap: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    borderRadius: 28,
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '60%',
  },
  wordmarkWrap: {
    marginTop: 28,
  },
  wordmarkText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: -1.4,
    textAlign: 'center',
  },
  progressTrack: {
    position: 'absolute',
    bottom: 78,
    left: '50%',
    marginLeft: -60,
    width: 120,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#E6F1ED',
    overflow: 'hidden',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '35%',
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#0E7C66',
  },
  token: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenChip: {
    height: 26,
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  tokenText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sparkle: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
