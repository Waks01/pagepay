/**
 * RewardedAd
 *
 * Server-token SSV flow for AdMob rewarded videos.
 *
 * Flow (server-authoritative — the client never tells the
 * server how much revenue the ad earned):
 *
 *   1. User taps "Watch Ad" → handleWatchAd fires.
 *   2. Client POSTs to /api/v1/ads/request-token with the slot
 *      name (e.g. "rewarded_android"). Server returns a
 *      `custom_data` string bound to a one-time AdRequest row.
 *   3. Client creates the AdMob ad request with that
 *      `custom_data` in serverSideVerificationOptions. AdMob
 *      signs the data and fires a server-to-server SSV
 *      callback when the user finishes watching.
 *   4. The server's SSV handler verifies the signature, looks
 *      up the AdRequest by token, and credits the user.
 *   5. AdEventType.CLOSED fires on the client. Client polls
 *      /api/v1/ads/recent-credits?since=<tokenIssuedAt> until
 *      a credit lands (or 15s elapses).
 *   6. onClaimed fires with the credited amount + new balance,
 *      and the parent screen invalidates ['me'] so the wallet
 *      chip updates.
 *
 * The previous implementation had the client compute revenue
 * from the AdMob `PAID` event and POST it to a
 * `/ads/reward-claim` endpoint. That endpoint was an attack
 * surface (a client could fabricate `revenue_usd` and mint
 * arbitrary points) and is now 410 Gone. The new flow has the
 * client trust the server for everything credit-related.
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, ActivityIndicator, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { requestAdToken, pollRecentCredits } from '@/src/shared/lib/ads';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type AdState = 'loading' | 'ready' | 'showing' | 'error';

/** Slot name (e.g. "rewarded_android") used as the `ad_unit`
 *  argument to /api/v1/ads/request-token. The actual AdMob
 *  unit ID (ca-app-pub-.../...) is the `adUnit` prop and is
 *  passed straight to createForAdRequest. */
export type RewardedAdProps = {
  /** Whether the modal is currently shown. Parent-controlled. */
  visible: boolean;
  /** AdMob rewarded unit ID (e.g. "ca-app-pub-.../..."). */
  adUnit: string;
  /** Slot name (e.g. "rewarded_android") used when requesting
   *  the server-issued ad-request token. */
  adUnitName: string;
  /** Current user ID for SSV customData. Required. */
  userId: number;
  /** The active reading session id, if any. Used for bundling rewards. */
  sessionId?: number;
  /** Title shown in modal. */
  title: string;
  /** Eyebrow above the title. */
  eyebrow?: string;
  /** Body copy under the title. */
  body?: string;
  /** Claim button label. */
  claimLabel?: string;
  /** Whether the user is allowed to skip without claiming. */
  allowSkip?: boolean;
  /** Skip button label. */
  skipLabel?: string;
  /** Called when the credit is confirmed (or, with `pending:
   *  true`, when the poll budget ran out and the credit is
   *  still in flight server-side). */
  onClaimed: (info: {
    pointsCredited: number;
    newBalance: number;
    /** True if the poll timed out — the credit is still
     *  expected to land but the client didn't observe it.
     *  Parents should show a "credit pending" toast and
     *  still advance the user (the credit will appear on
     *  the next /auth/me refresh). */
    pending?: boolean;
  }) => void;
  /** Called when the user skips without watching. */
  onSkipped?: () => void;
  /** Called when the modal closes. */
  onClose: () => void;
  /** Start loading the ad immediately, even while the modal is
   *  hidden. When `visible` flips to true the ad may already be
   *  ready, eliminating the 5–10 s network wait. */
  preload?: boolean;
};

export function RewardedAd(props: RewardedAdProps) {
  const {
    visible,
    adUnit,
    adUnitName,
    userId,
    sessionId,
    title,
    eyebrow,
    body,
    claimLabel = 'Watch Ad',
    allowSkip = false,
    skipLabel = 'Skip',
    onClaimed,
    onSkipped,
    onClose,
    preload = false,
  } = props;

  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [adState, setAdState] = useState<AdState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rewardedRef = useRef<any>(null);
  const rewardDataRef = useRef<{ type: string; amount: number } | null>(null);
  const tokenIssuedAtRef = useRef<string | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  const onCloseRef = useRef(onClose);
  const onClaimedRef = useRef(onClaimed);
  const onSkippedRef = useRef(onSkipped);

  useEffect(() => {
    onCloseRef.current = onClose;
    onClaimedRef.current = onClaimed;
    onSkippedRef.current = onSkipped;
  }, [onClose, onClaimed, onSkipped]);

  // Load ad when modal opens, or when preload is requested.
  // We do NOT gate on hasLoadedRef here because that flag can
  // block reloading between pre-read and post-read. Instead,
  // we always clean up the previous ad and load a fresh one.
  useEffect(() => {
    const shouldLoad = visible || preload;
    if (!shouldLoad) {
      return;
    }

    if (Platform.OS === 'web' || !adUnit || !userId) {
      return;
    }

    // If we already have a loaded ad for this slot, don't
    // recreate it just because `visible` toggled.
    if (rewardedRef.current && (rewardedRef.current as any)._adUnit === adUnit) {
      return;
    }

    let isActive = true;
    let unsubLoaded: (() => void) | null = null;
    let unsubEarned: (() => void) | null = null;
    let unsubClosed: (() => void) | null = null;

    setAdState('loading');
    setErrorMessage(null);
    rewardDataRef.current = null;

    if (__DEV__) {
      console.log('[RewardedAd] Loading ad...', { visible, preload });
    }

    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sdk = require('react-native-google-mobile-ads');
        const { RewardedAd: RealRewardedAd, RewardedAdEventType, AdEventType } = sdk;

        tokenIssuedAtRef.current = new Date().toISOString();
        const { custom_data } = await requestAdToken(adUnitName, sessionId);

        if (__DEV__) {
          console.log('[RewardedAd] requestAdToken result:', {
            adUnitName,
            sessionId,
            custom_data_length: custom_data?.length ?? 0,
            custom_data_preview: custom_data ? `${custom_data.slice(0, 20)}...` : 'EMPTY',
          });
        }

        const ssvOptions = {
          userId: userId.toString(),
          customData: custom_data,
        };

        if (__DEV__) {
          console.log('[RewardedAd] createForAdRequest SSV options:', {
            adUnit,
            userId: ssvOptions.userId,
            customData_length: ssvOptions.customData?.length ?? 0,
            customData_preview: ssvOptions.customData ? `${ssvOptions.customData.slice(0, 20)}...` : 'EMPTY',
          });
        }

        const ad = RealRewardedAd.createForAdRequest(adUnit, {
          serverSideVerificationOptions: ssvOptions,
        });
        (ad as any)._adUnit = adUnit;

        unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
          if (__DEV__) {
            console.log('[RewardedAd] Ad ready');
          }
          if (isActive) {
            setAdState('ready');
          }
        });

        unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward: { type: string; amount: number }) => {
          if (__DEV__) {
            console.log('[RewardedAd] Reward earned:', reward);
          }
          rewardDataRef.current = reward;
        });

        unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, async () => {
          if (__DEV__) {
            console.log('[RewardedAd] Ad closed');
          }

          if (unsubLoaded) unsubLoaded();
          if (unsubEarned) unsubEarned();
          if (unsubClosed) unsubClosed();

          rewardedRef.current = null;

          onCloseRef.current();

          if (rewardDataRef.current) {
            await handleRewardClaimed();
            rewardDataRef.current = null;
          } else {
            onSkippedRef.current?.();
          }
        });

        rewardedRef.current = ad;
        ad.load();

      } catch (err) {
        if (__DEV__) {
          console.error('[RewardedAd] Load failed:', err);
        }
        if (isActive) {
          setAdState('error');
          setErrorMessage(err instanceof Error ? err.message : 'Ad service unavailable');
        }
      }
    })();

    return () => {
      isActive = false;
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
      if (unsubLoaded) unsubLoaded();
      if (unsubEarned) unsubEarned();
      if (unsubClosed) unsubClosed();
      rewardedRef.current = null;
    };
  }, [preload, adUnit, userId, sessionId, adUnitName, onClaimed, onSkipped, onClose]);

  // Step 4-6: poll for the credit. This is the core of the
  // server-authoritative flow — the AdMob SDK has already
  // fired the SSV callback by now (or is about to), and the
  // server is the only authority on whether the credit
  // actually landed. We poll /recent-credits until it shows
  // up or 15s elapses.
  const handleRewardClaimed = useCallback(async () => {
    const since = tokenIssuedAtRef.current ?? new Date(Date.now() - 60_000).toISOString();
    const controller = new AbortController();
    pollAbortRef.current = controller;

    try {
      const credit = await pollRecentCredits(since, { signal: controller.signal });
      if (credit) {
        onClaimedRef.current({
          pointsCredited: credit.points_credited,
          newBalance: credit.new_balance,
        });
      } else {
        if (__DEV__) {
          console.log('[RewardedAd] pollRecentCredits returned null — credit may still be in flight');
        }
        onClaimedRef.current({ pointsCredited: 0, newBalance: 0, pending: true });
      }
    } catch (err) {
      if (__DEV__) {
        console.error('[RewardedAd] pollRecentCredits threw', err);
      }
      onClaimedRef.current({ pointsCredited: 0, newBalance: 0, pending: true });
    } finally {
      pollAbortRef.current = null;
    }
  }, [onClaimed]);

  const handleWatchAd = useCallback(() => {
    if (!rewardedRef.current || adState !== 'ready') {
      if (__DEV__) {
        console.warn('[RewardedAd] Cannot show ad - state:', adState);
      }
      return;
    }

    try {
      setAdState('showing');
      rewardedRef.current.show();

      if (__DEV__) {
        console.log('[RewardedAd] Ad showing');
      }
    } catch (err) {
      if (__DEV__) {
        console.error('[RewardedAd] Failed to show ad:', err);
      }
      setAdState('error');
      setErrorMessage('Failed to display ad');
    }
  }, [adState]);

  const handleSkip = useCallback(() => {
    onSkippedRef.current?.();
    onCloseRef.current();
  }, []);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setAdState('loading');
  }, []);

  // Don't render modal when not visible or when showing fullscreen ad
  if (!visible || adState === 'showing') {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={allowSkip ? handleSkip : undefined}>
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          {/* Eyebrow */}
          {eyebrow && (
            <Text style={[styles.eyebrow, { color: tokens.inkMuted }]}>
              {eyebrow}
            </Text>
          )}

          {/* Title */}
          <Text style={[styles.title, { color: tokens.ink }]}>{title}</Text>

          {/* Body */}
          {body && (
            <Text style={[styles.body, { color: tokens.inkMuted }]}>
              {body}
            </Text>
          )}

          {/* State-specific content */}
          {adState === 'loading' && (
            <View style={styles.content}>
              <ActivityIndicator size="large" color={tokens.mint} />
              <Text style={[styles.statusText, { color: tokens.inkMuted }]}>
                Loading your ad...
              </Text>
            </View>
          )}

          {adState === 'ready' && (
            <View style={styles.content}>
              <View style={[styles.iconContainer, { backgroundColor: tokens.mintSoft }]}>
                <Ionicons name="play-circle" size={48} color={tokens.mint} />
              </View>
              <Text style={[styles.statusText, { color: tokens.mint }]}>
                Your ad is ready!
              </Text>
            </View>
          )}

          {adState === 'error' && (
            <View style={styles.content}>
              <View style={[styles.iconContainer, { backgroundColor: tokens.signalSoft }]}>
                <Ionicons name="alert-circle" size={48} color={tokens.signal} />
              </View>
              <Text style={[styles.statusText, { color: tokens.signal }]}>
                {errorMessage || 'Ad temporarily unavailable'}
              </Text>
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            {/* Loading state - show disabled button */}
            {adState === 'loading' && (
              <View style={[styles.button, styles.primaryButton, { backgroundColor: tokens.inkMuted, opacity: 0.5 }]}>
                <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.buttonText}>Loading ad...</Text>
              </View>
            )}

            {/* Ready state - show enabled button */}
            {adState === 'ready' && (
              <Pressable
                onPress={handleWatchAd}
                style={({ pressed }) => [
                  styles.button,
                  styles.primaryButton,
                  { backgroundColor: tokens.mint, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Ionicons name="play" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.buttonText}>{claimLabel}</Text>
              </Pressable>
            )}

            {/* Error state - show retry button */}
            {adState === 'error' && (
              <Pressable
                onPress={handleRetry}
                style={({ pressed }) => [
                  styles.button,
                  styles.primaryButton,
                  { backgroundColor: tokens.mint, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Ionicons name="refresh" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.buttonText}>Try Again</Text>
              </Pressable>
            )}

            {/* Skip button - always available */}
            {allowSkip && (
              <Pressable
                onPress={handleSkip}
                style={({ pressed }) => [
                  styles.button,
                  styles.secondaryButton,
                  { borderColor: tokens.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.buttonText, { color: tokens.inkMuted }]}>{skipLabel}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  eyebrow: {
    fontFamily: 'SpaceGrotesk_500Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 20,
    marginBottom: 8,
  },
  body: {
    fontFamily: 'SpaceGrotesk_500Medium',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  content: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statusText: {
    fontFamily: 'SpaceGrotesk_500Medium',
    fontSize: 16,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  primaryButton: {
    backgroundColor: '#000',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_500Medium',
  },
});
