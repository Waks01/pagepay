import { useState, useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Animated, {
  FadeIn,
  SlideInDown,
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { apiFetch } from '@/src/shared/api/client';
import { PLATFORM_ENV } from '@/src/shared/lib/ads';
import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { RewardedAd } from '@/components/ads/RewardedAd';
import { PagePaySpinner } from '@/components/PagePaySpinner';

type UnlockModalProps = {
  visible: boolean;
  pointsCost: number;
  userBalance: number;
  onUnlockPoints: () => Promise<void>;
  onWatchAd: () => Promise<void>;
  onClose: () => void;
};

// Animated lock icon with breathing effect
function AnimatedLockIcon({ color }: { color: string }) {
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);

  useEffect(() => {
    // Breathing animation
    scale.value = withSequence(
      withTiming(1.1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
    );
    
    // Subtle wiggle
    rotate.value = withSequence(
      withTiming(-3, { duration: 150 }),
      withTiming(3, { duration: 300 }),
      withTiming(0, { duration: 150 })
    );
    
    const interval = setInterval(() => {
      scale.value = withSequence(
        withTiming(1.1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      );
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Ionicons name="lock-closed-outline" size={28} color={color} />
    </Animated.View>
  );
}

export function UnlockModal({
  visible,
  pointsCost,
  userBalance,
  onUnlockPoints,
  onWatchAd,
  onClose,
}: UnlockModalProps) {
  const [showAd, setShowAd] = useState(false);
  const [loadingMethod, setLoadingMethod] = useState<'points' | 'ad' | null>(null);
  const [adUnit, setAdUnit] = useState('');
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const canAfford = userBalance >= pointsCost;

  // Fetch current user for userId (required for SSV)
  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) throw new Error('Failed to load profile');
      return (await res.json()) as { id: number; points_balance: number };
    },
  });

  // Fetch ad config for rewarded unit
  const { data: adConfig } = useQuery({
    queryKey: ['ads-config'],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/config/ads?env=${PLATFORM_ENV}`);
      if (!res.ok) return {};
      return (await res.json()) as Record<string, string>;
    },
  });

  useEffect(() => {
    if (adConfig) {
      const platform = require('react-native').Platform.OS;
      const unitKey = platform === 'android' ? 'rewarded_android' : 'rewarded_ios';
      setAdUnit(adConfig[unitKey] || '');
    }
  }, [adConfig]);

  const handlePointsUnlock = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoadingMethod('points');
    try {
      await onUnlockPoints();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } finally {
      setLoadingMethod(null);
    }
  };

  const handleAdStart = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoadingMethod('ad');
    setShowAd(true);
  };

  const handleAdClaimed = async (_info: {
    pointsCredited: number;
    newBalance: number;
    pending?: boolean;
  }) => {
    // Ad reward already credited by the RewardedAd component
    // (via the SSV flow). Now unlock the study material —
    // pending credits still trigger the unlock (the user did
    // watch the ad; the server will catch up on the next
    // /auth/me refresh).
    try {
      await onUnlockPoints();
      setShowAd(false);
      onClose();
    } catch {
      // stay on modal
    } finally {
      setLoadingMethod(null);
    }
  };

  const handleAdClose = () => {
    setShowAd(false);
    setLoadingMethod(null);
  };

  if (showAd && user) {
    return (
      <RewardedAd
        visible
        adUnit={adUnit}
        adUnitName={Platform.OS === 'android' ? 'rewarded_android' : 'rewarded_ios'}
        userId={user.id}
        title="Watch to unlock"
        eyebrow="Sponsored"
        body="Watch this ad to unlock the study material for free."
        claimLabel="Claim unlock"
        allowSkip
        skipLabel="Skip"
        onClaimed={handleAdClaimed}
        onSkipped={handleAdClose}
        onClose={handleAdClose}
      />
    );
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close unlock dialog"
      >
        <Animated.View
          entering={FadeIn.duration(200)}
          style={[styles.overlayBg]}
          pointerEvents="none"
        />
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.sheetWrap}>
          <Animated.View
            entering={SlideInDown.duration(400).springify().damping(20).stiffness(300)}
            style={[styles.sheet, { backgroundColor: tokens.card }]}
            accessibilityLabel="Unlock answer"
          >
            <View style={styles.handleRow}>
              <View style={[styles.handle, { backgroundColor: tokens.borderStrong }]} />
            </View>

            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Cancel unlock"
              style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Ionicons name="close" size={18} color={tokens.inkMuted} />
            </Pressable>

            <View style={styles.iconWrap}>
              <View style={[styles.iconCircle, { backgroundColor: tokens.mintFaint }]}>
                <AnimatedLockIcon color={tokens.mint} />
              </View>
            </View>

            <Text
              style={[styles.title, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}
            >
              Unlock answer
            </Text>
            <Text style={[styles.sub, { color: tokens.inkMuted }]}>
              Choose how you'd like to unlock this study asset.
            </Text>

            <View style={styles.choices}>
              <Pressable
                onPress={canAfford ? handlePointsUnlock : undefined}
                disabled={!canAfford || loadingMethod !== null}
                accessibilityRole="button"
                accessibilityLabel={`Spend ${pointsCost} points`}
                accessibilityState={{ disabled: !canAfford }}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    borderColor: canAfford ? tokens.border : tokens.border,
                    backgroundColor: tokens.card,
                    opacity: !canAfford ? 0.55 : pressed ? 0.92 : 1,
                  },
                ]}
              >
                <Text style={[styles.choiceLabel, { color: tokens.inkMuted }]}>
                  Pay with points
                </Text>
                <Text
                  style={[styles.choicePrice, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}
                >
                  {pointsCost}
                </Text>
                <Text style={[styles.choiceSub, { color: tokens.inkMuted }]}>
                  {canAfford ? 'Instant access' : `Need ${pointsCost - userBalance} more`}
                </Text>
                {loadingMethod === 'points' && (
                  <PagePaySpinner size={18} />
                )}
              </Pressable>

              <Pressable
                onPress={handleAdStart}
                disabled={loadingMethod !== null}
                accessibilityRole="button"
                accessibilityLabel="Watch a short ad to unlock for free"
                style={({ pressed }) => [
                  styles.choice,
                  styles.choicePrimary,
                  {
                    borderColor: tokens.ink,
                    backgroundColor: tokens.ink,
                    opacity: pressed ? 0.92 : 1,
                  },
                ]}
              >
                <Text style={[styles.choiceLabel, { color: 'rgba(255,255,255,0.7)' }]}>
                  Watch a short ad
                </Text>
                <Text
                  style={[
                    styles.choicePrice,
                    { color: tokens.paper, fontFamily: Fonts.editorialSemiBold as string },
                  ]}
                >
                  Free
                </Text>
                <Text style={[styles.choiceSub, { color: 'rgba(255,255,255,0.7)' }]}>
                  ~30 seconds
                </Text>
                {loadingMethod === 'ad' && (
                  <PagePaySpinner size={18} />
                )}
              </Pressable>
            </View>

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel unlock"
              style={({ pressed }) => [styles.cancel, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.cancelText, { color: tokens.inkMuted }]}>
                Continue browsing
              </Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlayBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(14,17,22,0.55)',
  },
  sheetWrap: {
    width: '100%',
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 14,
    position: 'relative',
  },
  handleRow: {
    alignItems: 'center',
    marginBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  close: {
    position: 'absolute',
    top: 14,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    alignItems: 'center',
    marginTop: 6,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    textAlign: 'center',
    letterSpacing: -0.4,
    marginTop: 4,
  },
  sub: {
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 4,
  },
  choices: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  choice: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 6,
    position: 'relative',
  },
  choicePrimary: {},
  choiceLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.06,
    textTransform: 'uppercase',
  },
  choicePrice: {
    fontSize: 26,
    letterSpacing: -0.4,
  },
  choiceSub: {
    fontSize: 11.5,
  },
  choiceSpinner: {
    marginTop: 4,
  },
  cancel: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
