/**
 * "Watch ad" button - the earn path.
 *
 * The student opts in, watches a rewarded ad, and earns 16 SV. The
 * credit is granted by the server through the SSV callback, not by this
 * component: the ad's own reward callback is only a prompt to refresh
 * the balance, and the server's credit is what counts.
 *
 * The ad is never shown automatically. A rewarded ad that appears
 * unprompted is a policy violation and terrible UX in a study app.
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useRewardedAd } from '@/src/shared/lib/ads';
import { useCurrentUser } from '@/src/shared/lib/current-user';
import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type Props = {
  /** Called after the ad is watched. The balance refresh is the parent's job. */
  onEarned?: () => void;
  /** Label for the button. */
  label?: string;
  /** Show the SV amount next to the label. */
  showAmount?: boolean;
  /** How many SV one view is worth, for the label. */
  amountSv?: number;
  style?: object;
};

export function RewardedAdButton({
  onEarned,
  label = 'Watch ad',
  showAmount = true,
  amountSv = 16,
  style,
}: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const user = useCurrentUser();
  const [busy, setBusy] = useState(false);

  const { show, isLoaded, isShowing, error } = useRewardedAd(
    user?.id,
    () => {
      // UX only - the server credits the SV via SSV. The parent
      // refetches the balance; if it has not moved yet, the credit is
      // still in flight, so the refresh is retried briefly.
      onEarned?.();
    },
  );

  const onPress = useCallback(() => {
    if (isShowing) return;
    setBusy(true);
    const shown = show();
    if (!shown) {
      // Nothing was ready. Tell the student rather than failing silently.
      setBusy(false);
    }
  }, [isShowing, show]);

  const disabled = busy || isShowing;

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
        {disabled ? (
          <ActivityIndicator size="small" color={tokens.mint} />
        ) : (
          <Ionicons name="play-circle-outline" size={18} color={tokens.mint} />
        )}
        <Text style={[styles.label, { color: tokens.mint }]}>
          {isShowing ? 'Loading ad...' : label}
        </Text>
        {showAmount ? (
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
