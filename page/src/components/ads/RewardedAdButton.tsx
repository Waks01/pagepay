/**
 * "Watch ad" button - the earn path.
 *
 * Reward immediately on the client-side EARNED_REWARD callback.
 * AdMob's own docs say: reward the user with the client callback,
 * validate via SSV in the background. Never block the UI waiting for
 * the SSV POST to hit your server.
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useRewardedAd } from '@/src/shared/lib/ads';
import { useCurrentUserStore } from '@/src/shared/lib/current-user';
import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type Props = {
  /** Called once the credit has actually landed (client-side). */
  onEarned?: () => void;
  /** Label for the button. */
  label?: string;
  /** Show the SV amount next to the label. */
  showAmount?: boolean;
  /** How many SV one view is worth, for the label. */
  amountSv?: number;
  /**
   * What this ad is paying for, sent to the server with the ad and
   * returned in the SSV callback. Use it when the ad unlocks
   * something specific rather than crediting the wallet.
   */
  customData?: string;
  /**
   * Set when the ad unlocks something rather than crediting the
   * wallet. The caller waits for the unlock instead.
   */
  skipCreditWait?: boolean;
  style?: object;
};

export function RewardedAdButton({
  onEarned,
  label = 'Watch ad',
  showAmount = true,
  amountSv = 16,
  customData,
  skipCreditWait = false,
  style,
}: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [busy, setBusy] = useState(false);
  const [credited, setCredited] = useState(false);

  const { show, isLoaded, isShowing, error } = useRewardedAd(
    undefined,
    () => {
      if (skipCreditWait) {
        setCredited(true);
        onEarned?.();
        return;
      }

      // Google best practice: reward immediately on EARNED_REWARD.
      // SSV will hit the backend asynchronously for fraud validation.
      setCredited(true);
      // Refresh balance in background so it reflects server truth
      void useCurrentUserStore.getState().refresh();
      onEarned?.();
    },
    customData,
  );

  const onPress = useCallback(() => {
    if (isShowing || credited) return;
    setBusy(true);
    setCredited(false);
    const shown = show();
    if (!shown) {
      setBusy(false);
    }
  }, [isShowing, credited, show]);

  const disabled = busy || isShowing || credited;

  return (
    <View style={style}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: tokens.mintSoft,
            borderColor: tokens.mint,
            opacity: disabled ? 0.6 : pressed ? 0.8 : 1,
          },
        ]}
      >
        {disabled && !credited ? (
          <ActivityIndicator size="small" color={tokens.mint} />
        ) : (
          <Ionicons
            name={credited ? 'checkmark-circle' : 'play-circle-outline'}
            size={18}
            color={tokens.mint}
          />
        )}
        <Text style={[styles.label, { color: tokens.mint }]}>
          {credited ? 'Credited' : isShowing ? 'Loading ad...' : label}
        </Text>
        {showAmount && !credited ? (
          <Text style={[styles.amount, { color: tokens.mint }]}>
            +{amountSv} SV
          </Text>
        ) : null}
      </Pressable>
      {error && !busy ? (
        <Text style={[styles.error, { color: tokens.error }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  label: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '600',
  },
  amount: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '700',
  },
  error: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    marginTop: 4,
  },
});
