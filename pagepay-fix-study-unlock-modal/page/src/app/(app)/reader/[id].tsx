import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  AppState,
  AppStateStatus,
  Platform,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiFetch, API_URL } from "@/src/shared/api/client";
import { BodyRenderer } from "@/components/reader/BodyRenderer";
import {
  StudyPanel,
  useStudyHighlights,
  setStudyPendingSelection,
  setStudyFocusedHighlight,
  type SelectionState,
} from "@/components/reader/StudyPanel";
import { ShareAsImage } from "@/components/reader/ShareAsImage";
import { ReaderModeSwitcher } from "@/components/reader/ReaderModeSwitcher";
import { ListenMode } from "@/components/reader/ListenMode";
import { PremiumUpsellModal } from "@/components/PremiumUpsellModal";
import { SocialBar } from "@/components/SocialBar";
import { ShareSheet, type ShareTarget } from "@/components/ShareSheet";
import { CommentsSection } from "@/components/CommentsSection";
import {
  useWorkSocial,
  useLogWorkShare,
} from "@/src/features/works/hooks/use-works";
import { useStudyStore } from "@/src/shared/lib/studyStore";
import { usePreferences } from "@/src/shared/lib/preferences";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { SkeletonDetailPage } from "@/components/skeletons";
import { PagePaySpinner } from "@/components/PagePaySpinner";
import { useAudioPlayer } from "expo-audio";

type ContentDetail = {
  id: number;
  title: string;
  content_type: string;
  category: string;
  author: string | null;
  body_text: string | null;
  estimated_read_minutes: number;
  is_sponsored: boolean;
  parent_work_id: number | null;
  body_sentinels_version: number;
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
  session_id: number;
  verified: boolean;
  bonus_eligible: boolean;
  slice_bonus_credited: number;
  new_balance: number;
};

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { t } = useTranslation();
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const workIdRef = useRef<number | null>(null);
  const workId = content?.parent_work_id ?? Number(id);

  useEffect(() => {
    if (content?.parent_work_id) {
      workIdRef.current = content.parent_work_id;
    }
  }, [content]);

  const socialQuery = useWorkSocial(workId);
  const logShare = useLogWorkShare(workId);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);

  const onSharePress = useCallback(() => setShareSheetOpen(true), []);
  const onShareTarget = useCallback(
    (_target: ShareTarget) => {
      logShare.mutate("other", { onError: () => undefined });
    },
    [logShare],
  );

  const appState = useRef(AppState.currentState);
  const heartbeatRef = useRef<number | null>(null);
  const scrollCount = useRef(0);
  const sessionIdRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const lastSavedOffset = useRef(0);
  const finishFiredRef = useRef(false);
  const finishedManuallyRef = useRef(false);
  const [finishing, setFinishing] = useState(false);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/auth/me");
      if (!res.ok) throw new Error("Failed to load profile");
      return (await res.json()) as {
        id: number;
        service_credit_balance: number;
        cashable_balance: number;
        points_balance: number;
        is_premium?: boolean;
      };
    },
  });

  const readerMode = usePreferences((s) => s.readerMode);
  const isStudyMode = readerMode === "study";
  const isReadMode = readerMode === "read" || !isStudyMode;

  const [resumeSliceOrder, setResumeSliceOrder] = useState<number | null>(null);
  const isFirstUnit = resumeSliceOrder === null ? true : resumeSliceOrder === 0;
  const isPremium = Boolean(
    (user as { is_premium?: boolean } | undefined)?.is_premium,
  );

  const [paywallOpen, setPaywallOpen] = useState(false);

  const studyLoad = useStudyStore((s) => s.load);
  const studyAddHighlight = useStudyStore((s) => s.addHighlight);
  const studySetHighlightColor = useStudyStore((s) => s.setHighlightColor);
  useEffect(() => {
    void studyLoad();
  }, [studyLoad]);

  const unitHighlights = useStudyHighlights(Number(id));

  const [pendingShare, setPendingShare] = useState<{
    highlightId: string;
  } | null>(null);
  const shareHighlight = pendingShare
    ? (unitHighlights.find((h) => h.id === pendingShare.highlightId) ?? null)
    : null;

  const onLongPressSegment = useCallback(
    (bodyStart: number, localSel: { start: number; end: number }) => {
      const text = content?.body_text ?? "";
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
    setElapsedSeconds(0);
    setSessionId(null);
    sessionIdRef.current = null;
    finishFiredRef.current = false;
    finishedManuallyRef.current = false;
    setFinishing(false);

    (async () => {
      try {
        const r = await apiFetch("/api/v1/progress/continue");
        if (!r.ok) return;
        const ct = r.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) return;
        const data = (await r.json()) as ContinueReading;
        const sliceIdNum = Number(id);
        if (
          data.has_in_progress &&
          data.slice_id === sliceIdNum &&
          data.scroll_offset_px > 0
        ) {
          setTimeout(() => {
            scrollRef.current?.scrollTo({
              y: data.scroll_offset_px,
              animated: false,
            });
          }, 250);
        }
        if (
          data.has_in_progress &&
          data.work_id &&
          data.slice_id === sliceIdNum
        ) {
          await apiFetch(`/api/v1/progress/start?work_id=${data.work_id}`, {
            method: "POST",
          });
        }
        setResumeSliceOrder(data.slice_order);
      } catch (e) {
        console.warn("Resume check failed", e);
      }
    })();

    (async () => {
      try {
        await startSession();
      } catch (e) {
        console.error("Initial session start failed", e);
      }
    })();
    return () => {
      mounted = false;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (sessionIdRef.current && !finishedManuallyRef.current) {
        endSession(sessionIdRef.current);
      }
    };
  }, [id]);

  useEffect(() => {
    if (!sessionIdRef.current) {
      if (__DEV__) {
        console.log("[Reader] Timer gated", {
          hasSession: Boolean(sessionIdRef.current),
          now: new Date().toISOString(),
        });
      }
      return;
    }

    if (__DEV__) {
      console.log("[Reader] Timer + heartbeat starting", {
        sessionId: sessionIdRef.current,
        elapsedSeconds,
        now: new Date().toISOString(),
      });
    }

    heartbeatRef.current = setInterval(() => {
      sendHeartbeat();
    }, 10000);

    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => (s < 60 ? s + 1 : s));
    }, 1000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionId, elapsedSeconds]);

  const sendHeartbeat = async () => {
    if (!sessionIdRef.current) return;
    try {
      const res = await apiFetch("/api/v1/session/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          scroll_events: scrollCount.current,
          app_state: appState.current === "active" ? "active" : "background",
        }),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        return;
      }
      const json = await res.json();
      setPaused(json.paused);
    } catch (e) {
      console.error("Heartbeat failed", e);
    }
    scrollCount.current = 0;
  };

  const startSession = async () => {
    if (__DEV__) {
      console.log("[Reader] startSession requesting", {
        contentId: Number(id),
        now: new Date().toISOString(),
      });
    }
    const res = await apiFetch("/api/v1/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content_id: Number(id) }),
    });
    const json = await res.json();
    setSessionId(json.session_id);
    sessionIdRef.current = json.session_id;
    if (__DEV__) {
      console.log("[Reader] startSession success", {
        sessionId: json.session_id,
        response: json,
        now: new Date().toISOString(),
      });
    }
  };

  const endSession = async (
    sid: number,
  ): Promise<SessionEndResponse | null> => {
    console.log("[Reader] endSession called for session ID:", sid);
    try {
      finishedManuallyRef.current = true;
      console.log("[Reader] Calling /session/end...");
      const res = await apiFetch("/api/v1/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid }),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        const body = await res.text();
        console.error(
          `End session: non-JSON response (${res.status}) from /session/end: ${body.slice(0, 200)}`,
        );
        return null;
      }
      return (await res.json()) as SessionEndResponse;
    } catch (e) {
      console.error("End session failed", e);
      return null;
    }
  };

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        appState.current = nextState;
        if (nextState === "active" && sessionIdRef.current) {
          sendHeartbeat();
        }
      },
    );
    return () => subscription.remove();
  }, []);

  const handleScroll = (e: {
    nativeEvent: {
      contentOffset: { y: number };
      contentSize: { height: number };
      layoutMeasurement: { height: number };
    };
  }) => {
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
        apiFetch("/api/v1/progress/bookmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slice_id: Number(id),
            scroll_offset_px: Math.floor(offset),
          }),
        }).catch(() => {});
      }, 500);
    };
  })();

  const triggerFinish = async () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    heartbeatRef.current = null;
    timerRef.current = null;

    if (__DEV__) {
      console.log("[Reader] triggerFinish", {
        hasSession: Boolean(sessionIdRef.current),
        elapsedSeconds,
        now: new Date().toISOString(),
      });
    }

    if (sessionIdRef.current) {
      finishedManuallyRef.current = true;
      await endSession(sessionIdRef.current);
      try {
        await apiFetch(`/api/v1/progress/finish?slice_id=${Number(id)}`, {
          method: "POST",
        });
      } catch (e) {
        console.warn("Progress finish failed", e);
      }

      if (workId) {
        queryClient.invalidateQueries({ queryKey: ['book', workId, 'resume'] });
        router.replace(`/book/${workId}`);
      } else {
        router.back();
      }
    } else {
      finishedManuallyRef.current = true;
      if (workId) {
        router.replace(`/book/${workId}`);
      } else {
        router.back();
      }
    }
  };

  const onFinishTap = async () => {
    if (finishFiredRef.current) return;
    finishFiredRef.current = true;
    // Flip the button into its loading state immediately — the user gets
    // visual confirmation the tap registered even before the post-read ad
    // modal renders on top of the screen.
    setFinishing(true);
    await triggerFinish();
  };

  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
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
        <Text style={{ color: tokens.ink }}>
          {t("reader.content_not_found")}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: tokens.paper }]}
      testID="reader-screen"
    >
      <View style={[styles.header, { borderBottomColor: tokens.border }]}>
        <Text style={[styles.title, { color: tokens.ink }]}>
          {content.title}
        </Text>
        <Text style={[styles.meta, { color: tokens.inkMuted }]}>
          {content.author || t("reader.unknown_author")} •{" "}
          {t("reader.min_read", { minutes: content.estimated_read_minutes })}
        </Text>
        <View style={styles.timerRow}>
          <Text
            style={[
              styles.status,
              { color: tokens.mint },
              paused && { color: tokens.signal },
            ]}
          >
            {sessionId
              ? paused
                ? t("reader.paused")
                : t("reader.active")
              : t("reader.waiting")}
          </Text>
          {isPremium && (
            <View
              style={{
                backgroundColor: tokens.mint,
                borderRadius: 12,
                paddingHorizontal: 8,
                paddingVertical: 2,
                flexDirection: "row",
                alignItems: "center",
                gap: 2,
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  color: tokens.mintText,
                  fontFamily: "SpaceGrotesk_700Bold",
                }}
              >
                2x
              </Text>
            </View>
          )}
          <Text style={[styles.timerText, { color: tokens.ink }]}>
            {formatTime(elapsedSeconds)}
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        onScroll={handleScroll}
        scrollEventThrottle={200}
      >
        {isStudyMode && (
          <StudyPanel
            unitId={Number(id)}
            onHighlight={(entry) => {
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

        {readerMode === "listen" && (
          <ListenMode
            unitId={Number(id)}
            audioUrl={
              content.audio_url ? `${API_URL}${content.audio_url}` : null
            }
            isFirstUnit={isFirstUnit}
            isPremium={isPremium}
            onUpgrade={() => setPaywallOpen(true)}
          />
        )}

        {readerMode !== "listen" && (
          <BodyRenderer
            bodyText={content.body_text || ""}
            bodySentinelsVersion={content.body_sentinels_version}
            inkColor={tokens.ink}
            inkMutedColor={tokens.inkMuted}
            emptyMessage={t("reader.no_content")}
            highlights={isStudyMode ? unitHighlights : []}
            onLongPress={isStudyMode ? onLongPressSegment : undefined}
            onHighlightPress={isStudyMode ? onHighlightPressSegment : undefined}
            renderAfter={(idx, seg) => {
              if (!isReadMode) return null;
            }}
          />
        )}

        {readerMode !== "listen" && (
          <View style={styles.endFooter}>
            <View
              style={[styles.endDivider, { backgroundColor: tokens.border }]}
            />
            {elapsedSeconds >= 60 ? (
              <>
                <Text style={[styles.endLabel, { color: tokens.inkMuted }]}>
                  {t("reader.end_label_reached")}
                </Text>
                <Pressable
                  onPress={onFinishTap}
                  disabled={!sessionId || finishFiredRef.current}
                  accessibilityRole="button"
                  accessibilityLabel={t("reader.finish_claim")}
                  accessibilityState={{
                    disabled: !sessionId || finishFiredRef.current,
                    busy: finishing,
                  }}
                  style={({ pressed }) => [
                    styles.finishBtn,
                    { backgroundColor: tokens.mint },
                    (!sessionId || finishFiredRef.current) && {
                      backgroundColor: tokens.border,
                    },
                    pressed &&
                      !finishFiredRef.current && {
                        opacity: 0.85,
                        transform: [{ scale: 0.98 }],
                      },
                  ]}
                >
                  {finishing ? (
                    <View style={styles.finishBtnContent}>
                      <View style={styles.finishBtnSpinner}>
                        <PagePaySpinner size={18} />
                      </View>
                      <Text style={styles.finishBtnText}>
                        {t("reader.finishing")}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.finishBtnText}>
                      {t("reader.finish_claim")}
                    </Text>
                  )}
                </Pressable>
              </>
            ) : (
              <Text style={[styles.endLabel, { color: tokens.inkMuted }]}>
                {t("reader.end_label_reading")}
              </Text>
            )}
          </View>
        )}

        {content ? (
          <View
            style={[
              styles.socialCard,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <SocialBar
              workId={workId}
              initialLikes={socialQuery.data?.likes_count ?? 0}
              initialComments={socialQuery.data?.comments_count ?? 0}
              isInitiallyLiked={socialQuery.data?.is_liked ?? false}
              onSharePress={onSharePress}
            />
          </View>
        ) : null}

        {content ? <CommentsSection workId={workId} /> : null}

        <View style={{ height: 40 }} />
      </ScrollView>

      {content ? (
        <ShareSheet
          visible={shareSheetOpen}
          workId={workId}
          title={content.title}
          onShare={onShareTarget}
          onClose={() => setShareSheetOpen(false)}
        />
      ) : null}

      <ReaderModeSwitcher
        isFirstUnit={isFirstUnit}
        isPremium={isPremium}
        onLockedListenTapped={() => setPaywallOpen(true)}
      />

      {isStudyMode && (
        <ShareAsImage
          highlight={shareHighlight}
          bodyText={content.body_text || ""}
          workTitle={content.title}
          workAuthor={content.author}
          onDone={() => setPendingShare(null)}
          onError={() => setPendingShare(null)}
        />
      )}

      <PremiumUpsellModal
        visible={paywallOpen}
        title={t("premium.title", "Go Premium")}
        body={t(
          "premium.body",
          "Unlock premium for ad-free reading, double your points, and get unlimited AI study material.",
        )}
        cta={t("premium.upgrade", "Upgrade to Premium")}
        onClose={() => setPaywallOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { padding: 16, borderBottomWidth: 1 },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 4 },
  meta: { fontSize: 13, marginBottom: 8 },
  timerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  status: { fontSize: 13, fontWeight: "500" },
  paused: {},
  timerText: {
    fontSize: 15,
    fontWeight: "600",
    fontVariant: Platform.OS === "ios" ? ["tabular-nums"] : undefined,
  },
  scroll: { flex: 1, padding: 16 },
  body: { fontSize: 17, lineHeight: 26 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalBox: { padding: 24, borderRadius: 12, width: "100%", gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: "bold" },
  modalText: { fontSize: 14 },
  endFooter: {
    marginTop: 32,
    alignItems: "center",
    gap: 12,
  },
  endDivider: { width: 48, height: 2, borderRadius: 1 },
  endLabel: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  finishBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    minWidth: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  finishBtnDisabled: {},
  finishBtnContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  finishBtnSpinner: {
    width: 18,
    height: 18,
  },
  finishBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  socialCard: {
    marginTop: 24,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
});
