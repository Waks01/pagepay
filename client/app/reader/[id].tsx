import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, AppState, AppStateStatus, Platform, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch, API_URL } from '@/src/shared/api/client';
import { PLATFORM_ENV } from '@/src/shared/lib/ads';
import { RewardedAd } from '@/components/ads/RewardedAd';
import { NativeAdBanner } from '@/components/ads/NativeAdBanner';
import { BodyRenderer } from '@/components/reader/BodyRenderer';
import {
  StudyPanel,
  useStudyHighlights,
  setStudyPendingSelection,
  setStudyFocusedHighlight,
  type SelectionState,
} from '@/components/reader/StudyPanel';
import { ShareAsImage } from '@/components/reader/ShareAsImage';
import { ReaderModeSwitcher } from '@/components/reader/ReaderModeSwitcher';
import { ListenMode } from '@/components/reader/ListenMode';
import { PremiumUpsellModal } from '@/components/PremiumUpsellModal';
import { useStudyStore } from '@/src/shared/lib/studyStore';
import { usePreferences } from '@/src/shared/lib/preferences';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { SkeletonDetailPage } from '@/components/skeletons';

type ContentDetail = {
  id: number;
  title: string;
  content_type: string;
  category: string;
  author: string | null;
  body_text: string | null;
  estimated_read_minutes: number;
  is_sponsored: boolean;
  // Id of the parent work — set on sliced children, null on standalone.
  // The reader uses this to navigate back to the book detail screen
  // after finishing a slice.
  parent_work_id: number | null;
  // v3 reader sentinel contract version. 0 = plain text body
  // (pre-v3 slices). 1 = body_text contains v3 sentinels
  // ([[IMG:src|alt]], Caption: …, [TABLE START]…[TABLE END], [[EQ:…]]).
  // The reader uses this to decide whether to render via the
  // BodyRenderer sentinel parser or the legacy single-Text view.
  body_sentinels_version: number;
  // v3 §3.3 audio URL for Listen mode
  audio_url: string | null;
};

type ContinueReading = {
  slice_id: number | null;
  work_id: number | null;
  work_title: string | null;
  slice_title: string | null;
  slice_order: number;
  total_slices: number;
  percent_complete: number;
  has_in_progress: boolean;
  scroll_offset_px: number;
};

type SessionEndResponse = {
  requires_claim: boolean;
  pending_points: number;
  session_id: number;
  verified: boolean;
};

/**
 * Reader screen with a reward gate at both ends of the session.
 *
 * Flow:
 *   1. Mount → fetch content + progress (resume offset).
 *   2. PRE-READ GATE (ad #1): show RewardedAd. On claim →
 *      POST /session/start → unlock the timer + heartbeat.
 *      On skip → bounce to home (no session row created, no points).
 *   3. Active reading: heartbeat every 10s, scroll-track, visible
 *      timer ticks (1s) up to 60s, then the inline Finish button
 *      unlocks.
 *   4. Tap Finish → POST-READ GATE (ad #2): show RewardedAd FIRST.
 *      On claim → POST /session/end (stages pending_points) →
 *      auto-POST /session/claim (credits the wallet) → POST
 *      /progress/finish (advance the slice pointer) → navigate to
 *      the book detail.
 *      On skip → POST /session/end still fires (we advance the slice
 *      pointer), but /session/claim is skipped → user forfeits the
 *      staged points. Still navigates back to the book detail.
 *
 * Why ad #2 sits BEFORE /session/end: the user explicitly said the
 * second ad should gate the end-of-session, not sit after it. Putting
 * it first means the user's act of "finishing" is driven by watching
 * (or skipping) the ad, not by tapping Finish alone.
 *
 * Why we don't block skip on claiming: the user already did the read;
 * making them sit through a third modal to confirm forfeit would be
 * punitive. Skip forfeits the points but never stalls the flow.
 */
export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // Invalidate ['me'] after every ad credit so the home chip + wallet
  // tab reflect the new points balance immediately. Without this, the
  // user would have to pull-to-refresh to see points land.
  const queryClient = useQueryClient();
  // Theme tokens — the reader is meant to feel like the rest of the app,
  // not a hardcoded white slab. Keeping the surface paper-toned in both
  // schemes so reading doesn't feel like a separate app.
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { t } = useTranslation();
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [adUnit, setAdUnit] = useState('');
  // Pre-read gate: unlocks the session timer.
  const [preReadOpen, setPreReadOpen] = useState(true);
  // Post-read gate: sits BEFORE /session/end, not after. The user has
  // read for the 1-minute floor — now they watch (or skip) a second ad
  // to "fire" the end-of-session sequence. The server still recalculates
  // and stages pending_points inside /session/end; the auto-claim after
  // /session/end closes the loop without surfacing a third modal.
  const [postReadAdOpen, setPostReadAdOpen] = useState(false);
  const [preloadPostRead, setPreloadPostRead] = useState(false);

  // Fetch native ad unit for in-content placement
  const [nativeAdUnit, setNativeAdUnit] = useState('');

  const appState = useRef(AppState.currentState);
  const heartbeatRef = useRef<number | null>(null);
  const scrollCount = useRef(0);
  const sessionIdRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const lastSavedOffset = useRef(0);
  // Single one-shot latch for the inline Finish button so a double-tap
  // can't fire `triggerFinish` twice. Reset whenever the slice id changes.
  const finishFiredRef = useRef(false);
  // One-shot latch for the screen-unmount cleanup. After the user has
  // manually finished (or the post-finish modal has surfaced), the cleanup
  // MUST NOT call `endSession` again — that double-fires /session/end,
  // extends the session's end_time server-side, and reopens the post-finish
  // modal on a screen the user has already navigated away from (causing
  // the visible flicker back to Home).
  const finishedManuallyRef = useRef(false);

  // Fetch current user for userId (required for SSV)
  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) throw new Error('Failed to load profile');
      return (await res.json()) as { id: number; points_balance: number; is_premium?: boolean };
    },
  });

  // v3 reader modes (v3 §3.4). The user picks Read/Study/Listen
  // from a segmented control pinned to the bottom of the reader.
  // The default is 'read' from the preferences store.
  const readerMode = usePreferences((s) => s.readerMode);
  const isStudyMode = readerMode === 'study';
  // In study mode, native ads are suppressed — the user is here
  // to study, not to be sold to. v3 §3.2 calls this out as part
  // of the contract with the user.
  const isReadMode = readerMode === 'read' || !isStudyMode;

  // v3 §3.4 — Listen mode is gated. The first unit of any work
  // is free for everyone; beyond that, only Premium users can
  // listen. We derive `isFirstUnit` from the resume payload
  // (`slice_order === 0` is the first unit). `isPremium` is read
  // off the `me` query.
  const [resumeSliceOrder, setResumeSliceOrder] = useState<number | null>(null);
  const isFirstUnit =
    resumeSliceOrder === null
      ? true // Default to true until resume loads to avoid flickery paywalls
      : resumeSliceOrder === 0;
  const isPremium = Boolean((user as { is_premium?: boolean } | undefined)?.is_premium);

  // v3 §3.4 — paywall modal for locked Listen taps.
  const [paywallOpen, setPaywallOpen] = useState(false);

  // Bootstrap the local study store on mount.
  const studyLoad = useStudyStore((s) => s.load);
  const studyAddHighlight = useStudyStore((s) => s.addHighlight);
  const studySetHighlightColor = useStudyStore((s) => s.setHighlightColor);
  useEffect(() => {
    void studyLoad();
  }, [studyLoad]);

  // The current unit's highlights for the reader.
  const unitHighlights = useStudyHighlights(Number(id));

  // Selection state for the share card.
  const [pendingShare, setPendingShare] = useState<{
    highlightId: string;
  } | null>(null);
  const shareHighlight = pendingShare
    ? unitHighlights.find((h) => h.id === pendingShare.highlightId) ?? null
    : null;

  // v3 §3.2 — long-press handler.
  const onLongPressSegment = useCallback(
    (bodyStart: number, localSel: { start: number; end: number }) => {
      const text = content?.body_text ?? '';
      const sel: SelectionState = {
        start: bodyStart + localSel.start,
        end: bodyStart + localSel.end,
        text: text.slice(bodyStart + localSel.start, bodyStart + localSel.end),
      };
      setStudyPendingSelection(sel);
    },
    [content?.body_text],
  );

  const onHighlightPressSegment = useCallback((highlightId: string) => {
    setStudyFocusedHighlight(highlightId);
  }, []);

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
      const platform = Platform.OS;
      const rewardedKey = platform === 'android' ? 'rewarded_android' : 'rewarded_ios';
      const nativeKey = platform === 'android' ? 'in_feed_android' : 'in_feed_ios';
      setAdUnit(adConfig[rewardedKey] || '');
      setNativeAdUnit(adConfig[nativeKey] || '');
    }
  }, [adConfig]);

  // Load content + resume metadata once on mount. Session creation is
  // deferred until the user clears the pre-read gate.
  useEffect(() => {
    let mounted = true;

    const loadContent = async () => {
      const res = await apiFetch(`/api/v1/content/${id}`);
      const data = (await res.json()) as ContentDetail;
      if (mounted) {
        setContent(data);
        setLoading(false);
      }
    };

    loadContent();
    finishFiredRef.current = false;
    finishedManuallyRef.current = false;

    // Pick up an existing in-progress work so we can restore scroll offset.
    (async () => {
      try {
        const r = await apiFetch('/api/v1/progress/continue');
        if (!r.ok) return;
        const ct = r.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) return;
        const data = (await r.json()) as ContinueReading;
        const sliceIdNum = Number(id);
        if (data.has_in_progress && data.slice_id === sliceIdNum && data.scroll_offset_px > 0) {
          // Defer until the ScrollView is mounted.
          setTimeout(() => {
            scrollRef.current?.scrollTo({ y: data.scroll_offset_px, animated: false });
          }, 250);
        }
        if (data.has_in_progress && data.work_id && data.slice_id === sliceIdNum) {
          // Ensure tracking row exists (idempotent).
          await apiFetch(`/api/v1/progress/start?work_id=${data.work_id}`, { method: 'POST' });
        }
        // v3 §3.4 — the reader mode switcher needs to know whether
        // this is the first slice of the work to gate the Listen
        // mode. We read it off the resume payload (0-indexed).
        setResumeSliceOrder(data.slice_order);
      } catch (e) {
        console.warn('Resume check failed', e);
      }
    })();

    // Start the session immediately so that the pre-read ad can be linked
    // to this session via session_id.
    (async () => {
      try {
        await startSession();
      } catch (e) {
        console.error('Initial session start failed', e);
      }
    })();

    return () => {
      mounted = false;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      // Only auto-end the session on screen teardown if the user has NOT
      // already finished manually. The manual path (Finish & claim, Skip,
      // no-claim advance) handles /session/end itself — the cleanup must
      // not fire it again or we get:
      //   - a duplicate /session/end (server extends end_time silently),
      //   - a duplicate /progress/finish (when the second response hits
      //     the no-claim branch),
      //   - and worst, the catch block in `endSession`'s
      //     router.replace('/(tabs)') firing on a slow network response,
      //     which is the visible flicker back to Home that the user
      //     reported.
      if (sessionIdRef.current && !finishedManuallyRef.current) {
        endSession(sessionIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Heartbeat + elapsed timer start AFTER the pre-read gate clears.
  useEffect(() => {
    if (!sessionId || preReadOpen) return;

    heartbeatRef.current = setInterval(() => {
      sendHeartbeat();
    }, 10000);

    timerRef.current = setInterval(() => {
      // Pause the visible timer at the 1-minute mark. The reader is
      // meant to keep reading or tap Finish — the timer stopping
      // signals "1 minute done, your reward is ready." We don't kill
      // the heartbeat interval; the server keeps tracking real elapsed
      // time and re-claims when the user finishes.
      setElapsedSeconds((s) => (s < 60 ? s + 1 : s));
    }, 1000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionId, preReadOpen]);

  const sendHeartbeat = async () => {
    if (!sessionIdRef.current) return;
    try {
      const res = await apiFetch('/api/v1/session/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          scroll_events: scrollCount.current,
          app_state: appState.current === 'active' ? 'active' : 'background',
        }),
      });
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        return;
      }
      const json = await res.json();
      setPaused(json.paused);
    } catch (e) {
      console.error('Heartbeat failed', e);
    }
    scrollCount.current = 0;
  };

  const startSession = async () => {
    const res = await apiFetch('/api/v1/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_id: Number(id) }),
    });
    const json = await res.json();
    setSessionId(json.session_id);
    sessionIdRef.current = json.session_id;
  };

  const endSession = async (sid: number): Promise<SessionEndResponse | null> => {
    console.log('[Reader] endSession called for session ID:', sid);
    try {
      finishedManuallyRef.current = true;
      console.log('[Reader] Calling /session/end...');
      const res = await apiFetch('/api/v1/session/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      });
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        const body = await res.text();
        console.error(
          `End session: non-JSON response (${res.status}) from /session/end: ${body.slice(0, 200)}`,
        );
        return null;
      }
      return (await res.json()) as SessionEndResponse;
    } catch (e) {
      console.error('End session failed', e);
      return null;
    }
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      appState.current = nextState;
      if (nextState === 'active' && sessionIdRef.current) {
        sendHeartbeat();
      }
    });
    return () => subscription.remove();
  }, []);

  // The Finish button is inline at the end of the slice body now — it
  // doesn't need to react to scroll position or elapsed time. The user
  // taps it whenever they feel done. Anti-cheat on the server (verified
  // duration + scroll events) decides whether points are credited.
  const handleScroll = (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    scrollCount.current += 1;
    const y = e.nativeEvent.contentOffset.y;
    if (Math.abs(y - lastSavedOffset.current) >= 300) {
      lastSavedOffset.current = y;
      saveBookmarkDebounced(y);
    }
  };

  const saveBookmarkDebounced = (() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    return (offset: number) => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        apiFetch('/api/v1/progress/bookmark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slice_id: Number(id), scroll_offset_px: Math.floor(offset) }),
        }).catch(() => {});
      }, 500);
    };
  })();

  /**
   * Tear down the active heartbeat and surface the post-read ad modal.
   * The modal sits BEFORE /session/end now — the user watches (or skips)
   * the ad, then the close-out sequence runs end → auto-claim → progress
   * → navigate. endSession is called from the modal's onClaimed / onSkipped,
   * not from here.
   */
  const triggerFinish = async () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    heartbeatRef.current = null;
    timerRef.current = null;

    if (sessionIdRef.current) {
      // Mark manually-finished as soon as the post-read modal opens.
      // The user is committed to closing the session; if the reader
      // unmounts before they tap Claim/Skip, cleanup must NOT fire
      // /session/end a second time. endSession re-sets the latch (no-op)
      // when it finally runs from the modal handler.
      finishedManuallyRef.current = true;
      // Open the post-read gate. The handler will call endSession.
      setPostReadAdOpen(true);
    } else {
      // No active session — just return home so the user isn't stuck.
      finishedManuallyRef.current = true;
      router.replace('/(tabs)');
    }
  };

  // User taps the inline Finish button at the end of the slice. One-shot
  // via finishFiredRef — a double-tap can't fire twice.
  const onFinishTap = async () => {
    if (finishFiredRef.current) return;
    finishFiredRef.current = true;
    await triggerFinish();
  };

  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Pre-read gate handlers.
  const onPreReadClaimed = async (_info: {
    pointsCredited: number;
    newBalance: number;
    pending?: boolean;
  }) => {
    queryClient.invalidateQueries({ queryKey: ['me'] });
    queryClient.invalidateQueries({ queryKey: ['wallet'] });
    setPreloadPostRead(true);
  };

  const onPreReadSkipped = () => {
    setPreReadOpen(false);
    router.replace('/(tabs)');
  };

  // Post-read gate handlers.
  const onPostReadAdClaimed = async (_info: {
    pointsCredited: number;
    newBalance: number;
    pending?: boolean;
  }) => {
    console.log('[Reader] Post-read ad claimed, closing modal and ending session...');
    setPostReadAdOpen(false);
    finishFiredRef.current = false;
    queryClient.invalidateQueries({ queryKey: ['me'] });
    queryClient.invalidateQueries({ queryKey: ['wallet'] });

    if (!sessionIdRef.current) {
      router.replace('/(tabs)');
      return;
    }

    const endRes = await endSession(sessionIdRef.current);

    if (endRes?.requires_claim) {
      try {
        await apiFetch('/api/v1/session/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionIdRef.current }),
        });
        queryClient.invalidateQueries({ queryKey: ['me'] });
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
      } catch (e) {
        console.warn('Session claim failed', e);
        router.back();
        return;
      }
    }

    try {
      await apiFetch(`/api/v1/progress/finish?slice_id=${Number(id)}`, { method: 'POST' });
    } catch (e) {
      console.warn('Progress finish failed', e);
    }
    router.back();
  };

  const onPostReadAdSkipped = async () => {
    console.log('[Reader] Post-read ad skipped, closing modal and ending session...');
    setPostReadAdOpen(false);
    finishFiredRef.current = false;

    if (!sessionIdRef.current) {
      router.replace('/(tabs)');
      return;
    }

    const endRes = await endSession(sessionIdRef.current);
    if (endRes?.requires_claim && endRes.pending_points > 0) {
      try {
        await apiFetch('/api/v1/session/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionIdRef.current }),
        });
        queryClient.invalidateQueries({ queryKey: ['me'] });
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
      } catch (e) {
        console.warn('Session claim failed', e);
      }
    }

    try {
      await apiFetch(`/api/v1/progress/finish?slice_id=${Number(id)}`, { method: 'POST' });
    } catch (e) {
      console.warn('Progress finish failed', e);
    }
    router.back();
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: tokens.paper }]}>
        <SkeletonDetailPage />
      </View>
    );
  }

  if (!content) {
    return (
      <View style={[styles.center, { backgroundColor: tokens.paper }]}>
        <Text style={{ color: tokens.ink }}>{t('reader.content_not_found')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.paper }]} testID="reader-screen">
      <View style={[styles.header, { borderBottomColor: tokens.border }]}>
        <Text style={[styles.title, { color: tokens.ink }]}>{content.title}</Text>
        <Text style={[styles.meta, { color: tokens.inkMuted }]}>
          {content.author || t('reader.unknown_author')} • {t('reader.min_read', { minutes: content.estimated_read_minutes })}
        </Text>
        <View style={styles.timerRow}>
          <Text style={[styles.status, { color: tokens.mint }, paused && { color: tokens.signal }]}>
            {sessionId ? (paused ? t('reader.paused') : t('reader.active')) : t('reader.waiting')}
          </Text>
          <Text style={[styles.timerText, { color: tokens.ink }]}>{formatTime(elapsedSeconds)}</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        onScroll={handleScroll}
        scrollEventThrottle={200}
      >
        {/* v3 §3.2 — Study mode panel. Renders the unit's note,
            the sync status pill, the color picker sheet, and the
            focused-highlight menu. It does NOT render the body;
            the body is rendered by BodyRenderer below, with
            highlights projected onto it. We mount the panel
            whenever the user is in Study mode; the panel itself
            is cheap when there are no highlights or notes. */}
        {isStudyMode && (
          <StudyPanel
            unitId={Number(id)}
            onHighlight={(entry) => {
              // Two cases hit this handler:
              //   (a) New highlight from a long-press selection
              //       (id not in unitHighlights). The store's
              //       addHighlight is idempotent on id, so a
              //       re-emit with a different color is silently
              //       dropped. To change color, we route through
              //       the store's setHighlightColor.
              //   (b) Update from the focused-highlight color
              //       menu (id IS in unitHighlights, color may
              //       differ). We need to update the entry's
              //       color.
              const existing = unitHighlights.find((h) => h.id === entry.id);
              if (!existing) {
                studyAddHighlight(Number(id), entry);
                return;
              }
              if (existing.color !== entry.color) {
                studySetHighlightColor(Number(id), entry.id, entry.color);
              }
            }}
            onShareHighlight={(entry) => {
              setPendingShare({ highlightId: entry.id });
            }}
          />
        )}

        {/* v3 §3.3 — Listen mode player. Shows audio playback controls
            instead of the body text. The first unit is free for everyone;
            units 2+ require premium. The audio URL comes from the content
            detail response (points to /api/v1/content/audio/{unit_id}.mp3).
            If no audio is available yet (TTS not generated), the component
            shows a fallback message. */}
        {readerMode === 'listen' && (
          <ListenMode
            unitId={Number(id)}
            audioUrl={content.audio_url ? `${API_URL}${content.audio_url}` : null}
            isFirstUnit={isFirstUnit}
            isPremium={isPremium}
            onUpgrade={() => setPaywallOpen(true)}
          />
        )}

        {/* Body rendering.
            - Pre-v3 (body_sentinels_version === 0, every existing
              slice today): BodyRenderer falls back to a single
              <Text> with the raw body. We additionally inject
              native ads every ~400 chars via the renderAfter hook.
            - v3+ (sentinels present): the parser splits the body
              into typed segments (text/image/table/equation) and
              the dispatcher renders each. We inject ads every 3rd
              text segment. This is a rough character-count proxy
              — close enough to the old cadence to be invisible to
              the user.
            - v3 Study mode: the body's TextSegments receive the
              unit's highlights as a tint list, and a long-press
              handler that pushes the user's selection up to
              StudyPanel's color picker. Native ad injection is
              suppressed in study mode.
            - v3 Listen mode: body is hidden entirely — the user
              listens to the audio narration, not reads the text.
              The BodyRenderer doesn't mount. */}
        {readerMode !== 'listen' && (
          <BodyRenderer
            bodyText={content.body_text || ''}
            bodySentinelsVersion={content.body_sentinels_version}
            inkColor={tokens.ink}
            inkMutedColor={tokens.inkMuted}
            emptyMessage={t('reader.no_content')}
            highlights={isStudyMode ? unitHighlights : []}
            onLongPress={isStudyMode ? onLongPressSegment : undefined}
            onHighlightPress={isStudyMode ? onHighlightPressSegment : undefined}
            renderAfter={(idx, seg) => {
              if (!isReadMode) return null;
              if (!nativeAdUnit || !sessionId) return null;
              if (
                content.body_sentinels_version >= 1 &&
                (seg.kind !== 'text' || (idx % 3) !== 0)
              ) {
                return null;
              }
            return (
              <View style={styles.adSlot}>
                <NativeAdBanner adUnit={nativeAdUnit} sessionId={sessionId} />
              </View>
            );
          }}
        />
        )}

        {/* Inline end-of-slice footer. The Finish button only appears once
            1 minute has elapsed on the session timer (the "1 minute" gate
            that fires the reward prompt). Before that, the user is meant
            to keep reading — we show only a subtle hint at the bottom.
            In Listen mode, the footer is hidden — the audio player has
            its own UI and the session timer still runs in the background. */}
        {readerMode !== 'listen' && (
          <View style={styles.endFooter}>
            <View style={[styles.endDivider, { backgroundColor: tokens.border }]} />
          {elapsedSeconds >= 60 ? (
            <>
              <Text style={[styles.endLabel, { color: tokens.inkMuted }]}>
                {t('reader.end_label_reached')}
              </Text>
              <TouchableOpacity
                onPress={onFinishTap}
                disabled={!sessionId || finishFiredRef.current}
                accessibilityRole="button"
                accessibilityLabel={t('reader.finish_claim')}
                activeOpacity={0.85}
                style={[
                  styles.finishBtn,
                  { backgroundColor: tokens.mint },
                  (!sessionId || finishFiredRef.current) && {
                    backgroundColor: tokens.border,
                  },
                ]}
              >
                <Text style={styles.finishBtnText}>
                  {finishFiredRef.current ? t('reader.finishing') : t('reader.finish_claim')}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={[styles.endLabel, { color: tokens.inkMuted }]}>
              {t('reader.end_label_reading')}
            </Text>
          )}
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* v3 §3.4 — Reader mode switcher (Read / Study / Listen).
          Pinned below the scroll so it's always reachable. */}
      <ReaderModeSwitcher
        isFirstUnit={isFirstUnit}
        isPremium={isPremium}
        onLockedListenTapped={() => setPaywallOpen(true)}
      />

      <RewardedAd
        visible={preReadOpen}
        adUnit={adUnit}
        adUnitName={Platform.OS === 'android' ? 'rewarded_android' : 'rewarded_ios'}
        userId={user?.id ?? 0}
        sessionId={sessionId ?? undefined}
        title={t('reader.ad_pre_title')}
        eyebrow={t('reader.ad_pre_eyebrow')}
        body={t('reader.ad_pre_body')}
        claimLabel={t('reader.ad_pre_claim')}
        allowSkip
        skipLabel={t('reader.ad_pre_skip')}
        onClaimed={onPreReadClaimed}
        onSkipped={onPreReadSkipped}
        onClose={() => setPreReadOpen(false)}
      />

      {/* Post-read gate (the second ad). Sits BEFORE /session/end: the
          user watched the timer run for 1 min, tapped Finish, and now
          this ad is the close-out. Watching → SSV → credit lands
          (verified by polling /ads/recent-credits) → end → progress →
          navigate. Skipping → end (still advances the slice
          pointer) but no credit is filed, so the user forfeits the
          pending points. Either path returns them to the book detail. */}
      <RewardedAd
        visible={postReadAdOpen}
        adUnit={adUnit}
        adUnitName={Platform.OS === 'android' ? 'rewarded_android' : 'rewarded_ios'}
        userId={user?.id ?? 0}
        sessionId={sessionId ?? undefined}
        title={t('reader.ad_post_title')}
        eyebrow={t('reader.ad_post_eyebrow')}
        body={t('reader.ad_post_body')}
        claimLabel={t('reader.ad_post_claim')}
        allowSkip
        skipLabel={t('reader.ad_pre_skip')}
        onClaimed={onPostReadAdClaimed}
        onSkipped={onPostReadAdSkipped}
        onClose={() => setPreloadPostRead(false)}
        preload={preloadPostRead}
      />

      {/* v3 §3.2 — Share-as-image for highlights. Renders an
          off-screen 1080×1080 card and shares it via expo-sharing.
          `shareHighlight` is non-null only when the user just
          tapped "Share" on a highlight; the component self-dismisses
          by setting `pendingShare` to null in `onDone`. */}
      {isStudyMode && (
        <ShareAsImage
          highlight={shareHighlight}
          bodyText={content.body_text || ''}
          workTitle={content.title}
          workAuthor={content.author}
          onDone={() => setPendingShare(null)}
          onError={() => setPendingShare(null)}
        />
      )}

      {/* v3 §3.4 — Premium upsell modal for locked Listen mode.
          Triggered when a free user taps the Listen segment on the
          mode switcher for unit 2+, or taps "See Premium" in the
          locked ListenMode component. */}
      <PremiumUpsellModal
        visible={paywallOpen}
        title={t('premium.title', 'Go Premium')}
        body={t('premium.body', 'Unlock premium for ad-free reading, double your points, and get unlimited AI study material.')}
        cta={t('premium.upgrade', 'Upgrade to Premium')}
        onClose={() => setPaywallOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 16, borderBottomWidth: 1 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  meta: { fontSize: 13, marginBottom: 8 },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  status: { fontSize: 13, fontWeight: '500' },
  paused: {},
  timerText: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: Platform.OS === 'ios' ? ['tabular-nums'] : undefined,
  },
  scroll: { flex: 1, padding: 16 },
  body: { fontSize: 17, lineHeight: 26 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: { padding: 24, borderRadius: 12, width: '100%', gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  modalText: { fontSize: 14 },
  // Ad insertion slot. Vertical margin matches the old chunking loop
  // so the layout looks the same as the pre-renderer reader.
  adSlot: { marginVertical: 20 },
  // Inline end-of-slice footer. Sits in document flow at the natural end
  // of the body, so it never overlays any other content.
  endFooter: {
    marginTop: 32,
    alignItems: 'center',
    gap: 12,
  },
  endDivider: { width: 48, height: 2, borderRadius: 1 },
  endLabel: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  finishBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    minWidth: 220,
    alignItems: 'center',
  },
  finishBtnDisabled: {},
  finishBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});