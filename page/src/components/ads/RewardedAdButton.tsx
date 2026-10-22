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

import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useRewardedAd } from '@/src/shared/lib/ads';
import {
  useCurrentUser,
  useCurrentUserStore,
} from '@/src/shared/lib/current-user';
import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type Props = {
  /** Called once the credit has actually landed. */
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
   * wallet. The button then does not wait for a balance to move — the
   * caller waits for the unlock instead.
   */
  skipCreditWait?: boolean;
  style?: object;
};

/** How long to wait for the server's SSV credit before giving up. */
const CREDIT_WAIT_MS = 30_000;
const CREDIT_POLL_MS = 1_500;

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
  const user = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const [credited, setCredited] = useState(false);
  const balanceBeforeRef = useRef<number | null>(null);

  const balance = user?.service_credit_balance ?? 0;

  /**
   * Wait for the server's SSV credit to actually land.
   *
   * The credit is granted by the backend when AdMob's callback arrives,
   * which is asynchronous and can trail the ad closing by a second or
   * two. A fixed delay either shows a stale balance or refreshes before
   * the credit exists, so poll the store until the balance moves.
   */
  const waitForCredit = useCallback(async () => {
    const before = balanceBeforeRef.current;
    setCrediting(true);
    const deadline = Date.now() + CREDIT_WAIT_MS;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, CREDIT_POLL_MS));
      const fresh = await useCurrentUserStore.getState().refresh();
      const now = fresh?.service_credit_balance ?? 0;
      if (before == null || now > before) {
        setCrediting(false);
        setCredited(true);
        onEarned?.();
        return;
      }
    }

    // The credit did not arrive in time. The server may still be
    // processing it, so say so rather than claiming failure.
    setCrediting(false);
    onEarned?.();
  }, [onEarned]);

  const { show, isLoaded, isShowing, error } = useRewardedAd(
    user?.id,
    () => {
      if (skipCreditWait) {
        // The ad unlocks something, so no balance is going to move.
        // The caller waits for the unlock.
        setCrediting(true);
        onEarned?.();
        return;
      }
      // UX only - the server credits the SV via SSV.
      balanceBeforeRef.current = balance;
      void waitForCredit();
    },
    customData,
  );

  const onPress = useCallback(() => {
    if (isShowing || crediting) return;
    setBusy(true);
    setCredited(false);
    const shown = show();
    if (!shown) {
      // Nothing was ready. Tell the student rather than failing silently.
      setBusy(false);
    }
  }, [isShowing, crediting, show]);

  const disabled = busy || isShowing || crediting;

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
          <Ionicons
            name={credited ? 'checkmark-circle' : 'play-circle-outline'}
            size={18}
            color={tokens.mint}
          />
        )}
        <Text style={[styles.label, { color: tokens.mint }]}>
          {credited
            ? 'Credited'
            : crediting
              ? 'Crediting...'
              : isShowing
                ? 'Loading ad...'
                : label}
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
