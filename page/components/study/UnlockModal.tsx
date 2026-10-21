import { useState, useEffect } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePaySpinner } from '@/components/PagePaySpinner';
import { RewardedAdButton } from '@/src/components/ads/RewardedAdButton';

type UnlockMethod = 'sv' | 'cashable';

type UnlockModalProps = {
  visible: boolean;
  pointsCost: number;
  svBalance: number;
  cashableBalance: number;
  onUnlock: (method: UnlockMethod) => Promise<void>;
  onClose: () => void;
  /** Called after a rewarded ad credits the student. */
  onBalanceChange?: () => void;
};

function AnimatedLockIcon({ color }: { color: string }) {
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
  }), []);

  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
    );
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

  return (
    <Animated.View style={animatedStyle}>
      <Ionicons name="lock-closed-outline" size={28} color={color} />
    </Animated.View>
  );
}

export function UnlockModal({
  visible,
  pointsCost,
  svBalance,
  cashableBalance,
  onUnlock,
  onClose,
  onBalanceChange,
}: UnlockModalProps) {
  const [loading, setLoading] = useState(false);
  // SV is the primary wallet; the choice sticks across opens so a user
  // who prefers spending earnings isn't re-prompted every unlock.
  const [method, setMethod] = useState<UnlockMethod>('sv');
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const wallets: { key: UnlockMethod; label: string; name: string; balance: number }[] = [
    { key: 'sv', label: 'Service credits', name: 'sv', balance: svBalance },
    { key: 'cashable', label: 'Cashable points', name: 'pts', balance: cashableBalance },
  ];
  const canAfford = (balance: number) => balance >= pointsCost;
  const anyAffordable = wallets.some((w) => canAfford(w.balance));
  // A student who cannot pay must still have a way forward, or the
  // unlock is a dead end. Rewarded ads credit SV through the server's
  // SSV callback, so watching an ad is the way to earn the balance
  // needed to unlock.
  const adsCanGetThere = !anyAffordable && pointsCost > 0;
  const adsNeeded = adsCanGetThere
    ? Math.ceil(Math.max(0, pointsCost - svBalance) / 16)
    : 0;

  const handleUnlock = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      await onUnlock(method);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (error) {
      // The backend 402 carries the real price and balance ("Need 50
      // cashable points. You have 10.") — show it verbatim rather than
      // leaving the sheet to just do nothing.
      const message = error instanceof Error ? error.message : 'Unlock failed';
      Alert.alert('Unlock failed', message);
    } finally {
      setLoading(false);
    }
  };

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
          style={styles.overlayBg}
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
              Spend points to unlock this study asset.
            </Text>

            <View style={styles.choices}>
              {wallets.map((wallet) => {
                const affordable = canAfford(wallet.balance);
                const selected = method === wallet.key;
                return (
                  <Pressable
                    key={wallet.key}
                    onPress={() => setMethod(wallet.key)}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityLabel={`Pay with ${wallet.label}`}
                    accessibilityState={{ selected, disabled: !affordable }}
                    style={({ pressed }) => [
                      styles.choice,
                      {
                        borderColor: selected ? tokens.mint : tokens.border,
                        backgroundColor: selected ? tokens.mintFaint : tokens.card,
                        opacity: !affordable ? 0.55 : pressed ? 0.92 : 1,
                      },
                    ]}
                  >
                    <View style={styles.choiceTopRow}>
                      <View
                        style={[
                          styles.radio,
                          { borderColor: selected ? tokens.mint : tokens.border },
                        ]}
                      >
                        {selected && (
                          <View style={[styles.radioDot, { backgroundColor: tokens.mint }]} />
                        )}
                      </View>
                      <Text style={[styles.choiceLabel, { color: tokens.inkMuted }]}>
                        {wallet.label}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.choicePrice,
                        { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string },
                      ]}
                    >
                      {pointsCost} {wallet.name}
                    </Text>
                    <Text style={[styles.choiceSub, { color: tokens.inkMuted }]}>
                      {affordable
                        ? `Balance ${wallet.balance} · instant access`
                        : `Need ${pointsCost - wallet.balance} more`}
                    </Text>
                    {loading && selected && <PagePaySpinner size={18} />}
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={anyAffordable ? handleUnlock : undefined}
              disabled={!anyAffordable || loading}
              accessibilityRole="button"
              accessibilityLabel="Pay and unlock"
              accessibilityState={{ disabled: !anyAffordable }}
              style={({ pressed }) => [
                styles.payCta,
                {
                  backgroundColor: tokens.mint,
                  opacity: !anyAffordable ? 0.55 : pressed ? 0.92 : 1,
                },
              ]}
            >
              <Text style={styles.payCtaText}>
                {loading
                  ? 'Unlocking…'
                  : anyAffordable
                    ? `Pay ${pointsCost} ${method === 'sv' ? 'sv' : 'pts'} to unlock`
                    : 'Not enough balance'}
              </Text>
            </Pressable>

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

            {/* The way out for a student who cannot pay. Without this
                the unlock is a dead end and the asset is unreachable
                for anyone without money. Watching an ad credits 16 SV
                through the server's SSV callback, so this is the same
                earn path the wallet offers, surfaced exactly where the
                student is stuck. */}
            {adsCanGetThere && (
              <View
                style={[
                  styles.earnBox,
                  { borderColor: tokens.border, backgroundColor: tokens.mintFaint },
                ]}
              >
                <View style={styles.earnHeader}>
                  <Ionicons name="play-circle-outline" size={18} color={tokens.mint} />
                  <Text style={[styles.earnTitle, { color: tokens.ink }]}>
                    Earn credits to unlock
                  </Text>
                </View>
                <Text style={[styles.earnSub, { color: tokens.inkMuted }]}>
                  {adsNeeded} {adsNeeded === 1 ? 'ad' : 'ads'} to earn{' '}
                  {pointsCost - svBalance} sv
                </Text>
                <RewardedAdButton
                  style={styles.earnButton}
                  onEarned={() => {
                    onBalanceChange?.();
                  }}
                  label="Watch an ad"
                  amountSv={16}
                />
              </View>
            )}
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
  choiceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  payCta: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  payCtaText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
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
  cancel: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '500',
  },
  earnBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    marginTop: 2,
  },
  earnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  earnTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  earnSub: {
    fontSize: 12.5,
    marginTop: -4,
  },
  earnButton: {
    marginTop: 4,
  },
});
