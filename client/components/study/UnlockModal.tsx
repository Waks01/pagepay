import { useState, useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Animated, {
  FadeIn,
  SlideInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { apiFetch } from '@/src/shared/api/client';
import { PLATFORM_ENV } from '@/src/shared/lib/ads';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RewardedAd } from '@/components/ads/RewardedAd';

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
      <Animated.View 
        entering={FadeIn.duration(200)}
        style={[styles.overlay, { backgroundColor: scheme === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.55)' }]}
      >
        <Animated.View 
          entering={SlideInDown.duration(400).springify().damping(20).stiffness(300)}
          style={[styles.sheet, { backgroundColor: tokens.card, borderColor: tokens.border }]}
        >
          <View style={styles.headerRow} accessibilityLabel="Unlock answer">
            <AnimatedLockIcon color={tokens.mint} />
            <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              Unlock answer
            </Text>
          </View>

          <Animated.Text 
            entering={FadeIn.delay(300).duration(400)}
            style={[styles.cost, { color: tokens.inkMuted }]}
          >
            This asset costs <Text style={{ color: tokens.mint, fontWeight: '700' }}>{pointsCost} pts</Text> to unlock.
            {'\n'}Your balance: <Text style={{ color: canAfford ? tokens.mint : tokens.signal, fontWeight: '600' }}>{userBalance} pts</Text>
          </Animated.Text>

          <Animated.View 
            entering={SlideInDown.delay(400).duration(300).springify()}
            style={styles.buttons}
          >
            <PrimaryButton
              title={canAfford ? `Spend ${pointsCost} pts` : 'Not enough points'}
              onPress={handlePointsUnlock}
              loading={loadingMethod === 'points'}
              disabled={!canAfford || loadingMethod !== null}
            />
            <PrimaryButton
              title="Watch ad instead"
              onPress={handleAdStart}
              loading={loadingMethod === 'ad'}
              disabled={loadingMethod !== null}
            />
          </Animated.View>

          <Pressable 
            onPress={onClose} 
            style={({ pressed }) => [styles.close, { opacity: pressed ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Cancel unlock"
          >
            <Text style={[styles.closeText, { color: tokens.inkMuted }]}>Cancel</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 20,
    letterSpacing: -0.4,
  },
  cost: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  buttons: {
    gap: 10,
  },
  close: {
    alignSelf: 'center',
    paddingVertical: 8,
  },
  closeText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
