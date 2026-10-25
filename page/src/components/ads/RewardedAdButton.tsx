/**
 * "Watch ad" button - the earn path.
 *
 * The student opts in, watches a rewarded ad, and earns 16 SV. The
 * credit is granted by the server through the SSV callback, but the
 * UI credits immediately on EARNED_REWARD (UX) and keeps the server
 * as an authoritative fraud-guard running in the background. Blocking
 * the UI on server verification is wrong - AdMob callbacks trail the
 * ad closing by seconds at most, and a delayed or retried callback
 * must not freeze the screen forever.
 *
 * The ad is never shown automatically. A rewarded ad that appears
 * unprompted is a policy violation and terrible UX in a study app.
 */

import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useRewardedAd } from '@/src/shared/lib/ads';
import {
  useCurrentUserStore,
} from '@/src/shared/lib/current-user';
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
  const [crediting, setCrediting] = useState(false);
  const [credited, setCredited] = useState(false);
  // Whether the SSV callback has arrived for this session. Keeps the
  // "Credited" badge showing once the server has confirmed so long as
  // the API returns 200 (the SSV endpoint is idempotent on
  // transaction_id, so retries don't double-credit). We do not block
  // on server verification — only on the EARNED_REWARD client event.
  const ssvConfirmedRef = useRef(false);

  const balanceBeforeRef = useRef<number | null>(null);

  const { show, isLoaded, isShowing, error } = useRewardedAd(
    undefined,
    () => {
      if (skipCreditWait) {
        // The ad unlocks something, so no balance is going to move.
        // The caller waits for the unlock.
        setCrediting(true);
        onEarned?.();
        return;
      }

      // Credit on the client immediately (UX). The server's SSV
      // callback is authoritative for fraud-guard purposes — it still
      // lands in the background and runs audit logging, it just does
      // not hold up the screen.
      balanceBeforeRef.current = useCurrentUserStore.getState().service_credit_balance ?? 0;
      setCrediting(true);
      void waitForSsvCredit(ssvConfirmedRef, setCredited);
      onEarned?.();
    },
    customData,
  );

  const waitForSsvCredit = useCallback(async (confirmedRef: React.MutableRefObject<boolean>, setCredited: (v: boolean) => void) => {
    // Background polling for up to 60s. If the SSV callback arrives we
    // flip the flag so "Credited" stays shown. We don't fail hard if
    // it doesn't arrive within the window — the client already granted
    // the UX credit, and the server will reconcile next session
    // via the audit trail.
    const deadline = Date.now() + 60_000;
    while (!confirmedRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3_000));
      confirmedRef.current = await checkSsvArrived();
      if (confirmedRef.current) {
        setCredited(true);
        break;
      }
    }
  }, []);

  // Poll the account endpoint to detect whether the server has credited
  // the SV via the SSV callback. Idempotent, so retries are safe.
  const checkSsvArrived = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/users/me');
      if (!res.ok) return false;
      const data = await res.json();
      const before = balanceBeforeRef.current ?? 0;
      const now = data.service_credit_balance ?? before;
      return now > before;
    } catch {
      return false;
    }
  }, []);

  const onPress = useCallback(() => {
    if (isShowing || crediting) return;
    setBusy(true);
    setCredited(false);
    const shown = show();
    if (!shown) {
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
