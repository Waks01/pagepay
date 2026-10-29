import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
  requestNotificationPermissionsAsync,
} from "expo-audio";

import { PageHeader } from "@/components/PageHeader";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import {
  EDUCATION_LEVELS,
  createAudioBatches,
  fetchAudioBatches,
  fetchAudioTopics,
  generateNextAudioEpisode,
  quoteAudioNarration,
  saveAudioPosition,
  type AudioEpisode,
  type EducationLevel,
} from "@/src/features/study/api";
import { downloadEpisodeAudio } from "@/src/features/study/audio-download";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatMinutes(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} min`;
}

/**
 * The player for the episode that is currently loaded.
 *
 * It is mounted with `key={episode.id}`, so every episode gets a fresh
 * player. Swapping the source on a live player leaves `isLoaded`
 * reading the *previous* episode's value for one render, and the
 * play/seek then lands on the old audio. A fresh mount removes that
 * race entirely.
 */
function EpisodePlayer({
  episode,
  title,
  tokens,
  onFinished,
}: {
  episode: AudioEpisode;
  title: string;
  tokens: (typeof PagePay)["light"];
  onFinished: () => void;
}) {
  const player = useAudioPlayer(episode.audio_url, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);

  // Take over the lock screen. Without this Android cuts the audio
  // after about three minutes and the lock screen shows nothing.
  useEffect(() => {
    if (!status.isLoaded) return;
    try {
      player.setActiveForLockScreen(true, {
        title: `Episode ${episode.episode_index + 1}`,
        artist: "PagePay",
        albumTitle: title,
      });
    } catch (error) {
      if (__DEV__) console.error("[podcast] lock screen:", error);
    }
  }, [status.isLoaded, player, episode.episode_index, title]);

  // Resume where the student got to, then play.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!status.isLoaded || startedRef.current) return;
    startedRef.current = true;
    const resumeAt = episode.position_seconds ?? 0;
    if (resumeAt > 1) {
      void player.seekTo(resumeAt).catch(() => undefined);
    }
    player.play();
  }, [status.isLoaded, player, episode.position_seconds]);

  // Remember the place, so closing the app and coming back does not
  // lose it.
  const lastSavedRef = useRef(0);
  useEffect(() => {
    if (!status.playing) return;
    const now = Date.now();
    if (now - lastSavedRef.current < 8000) return;
    lastSavedRef.current = now;
    void saveAudioPosition(episode.id, {
      position_seconds: status.currentTime ?? 0,
    }).catch(() => undefined);
  }, [status.playing, status.currentTime, episode.id]);

  // Move on when this episode ends.
  useEffect(() => {
    if (!status.didJustFinish) return;
    void saveAudioPosition(episode.id, {
      position_seconds: 0,
      completed: true,
    }).catch(() => undefined);
    onFinished();
  }, [status.didJustFinish, episode.id, onFinished]);

  const toggle = useCallback(() => {
    if (status.playing) {
      player.pause();
    } else {
      if (status.didJustFinish) void player.seekTo(0);
      player.play();
    }
  }, [status.playing, status.didJustFinish, player]);

  return (
    <View
      style={[
        styles.playerCard,
        { backgroundColor: tokens.card, borderColor: tokens.border },
      ]}
    >
      <Pressable
        onPress={toggle}
        style={[styles.playerButton, { backgroundColor: tokens.mint }]}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "Pause" : "Play"}
      >
        <Ionicons
          name={status.playing ? "pause" : "play"}
          size={20}
          color={tokens.mintText}
        />
      </Pressable>
      <View style={styles.playerInfo}>
        <Text style={[styles.playerTitle, { color: tokens.ink }]}>
          Episode {episode.episode_index + 1}
        </Text>
        <Text style={[styles.playerMeta, { color: tokens.inkMuted }]}>
          {formatTime(status.currentTime)} /{" "}
          {formatTime(status.duration || episode.actual_duration_seconds || 0)}
        </Text>
      </View>
      <Pressable
        onPress={() => {
          void player.seekTo(Math.max(0, (status.currentTime ?? 0) - 15));
        }}
        hitSlop={8}
        style={styles.playerSkip}
        accessibilityRole="button"
        accessibilityLabel="Back 15 seconds"
      >
        <Ionicons name="play-back" size={20} color={tokens.inkMuted} />
      </Pressable>
      <Pressable
        onPress={() => {
          void player.seekTo((status.currentTime ?? 0) + 15);
        }}
        hitSlop={8}
        style={styles.playerSkip}
        accessibilityRole="button"
        accessibilityLabel="Forward 15 seconds"
      >
        <Ionicons name="play-forward" size={20} color={tokens.inkMuted} />
      </Pressable>
    </View>
  );
}

export default function PodcastScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const materialId = Number(id);
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const queryClient = useQueryClient();

  const [level, setLevel] = useState<EducationLevel>("primary");
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [activeEpisodeId, setActiveEpisodeId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const topicsQ = useQuery({
    queryKey: ["study", "audio", "topics", materialId],
    queryFn: () => fetchAudioTopics(materialId),
  });

  const batchesQ = useQuery({
    queryKey: ["study", "audio", "batches", materialId],
    queryFn: () => fetchAudioBatches(materialId),
  });

  const episodes = useMemo(
    () => batchesQ.data?.episodes ?? [],
    [batchesQ.data],
  );

  const readyEpisodes = useMemo(
    () => episodes.filter((e) => e.status === "ready" && e.audio_url),
    [episodes],
  );

  const activeEpisode = useMemo(
    () => episodes.find((e) => e.id === activeEpisodeId) ?? null,
    [episodes, activeEpisodeId],
  );

  // The audio session has to allow background playback and the OS has
  // to know which player owns the lock screen, or the audio is cut
  // after about three minutes on Android and the lock screen shows
  // nothing at all.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: "doNotMix",
        });
        if (cancelled) return;
        if (Platform.OS === "android") {
          // The media notification is what carries the playback
          // controls on Android. Without the permission there is no
          // notification, so there are no controls in the shade.
          await requestNotificationPermissionsAsync().catch(() => null);
        }
      } catch (error) {
        if (__DEV__) console.error("[podcast] audio mode:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const playEpisode = useCallback(
    (episode: AudioEpisode) => {
      if (!episode.audio_url) return;
      setActiveEpisodeId(episode.id);
    },
    [],
  );

  /** Move to the next ready episode when one finishes. */
  const handleFinished = useCallback(() => {
    setActiveEpisodeId((currentId) => {
      if (currentId === null) return currentId;
      const index = readyEpisodes.findIndex((e) => e.id === currentId);
      const next = readyEpisodes[index + 1];
      return next ? next.id : currentId;
    });
  }, [readyEpisodes]);

  const toggleTopic = useCallback((topicIndex: number) => {
    setSelected((current) =>
      current.includes(topicIndex)
        ? current.filter((i) => i !== topicIndex)
        : [...current, topicIndex],
    );
  }, []);

  const toggleAll = useCallback(() => {
    const all = (topicsQ.data?.topics ?? []).map((t) => t.topic_index);
    setSelected((current) =>
      current.length === all.length ? [] : all,
    );
  }, [topicsQ.data]);

  const quoteQ = useQuery({
    queryKey: ["study", "audio", "quote", materialId, level, selected],
    queryFn: () =>
      quoteAudioNarration(materialId, {
        topic_indexes: selected.length ? selected : [],
        level,
      }),
    enabled: selected.length > 0,
  });

  const startGeneration = useCallback(async () => {
    if (!selected.length) return;
    setBusy(true);
    setGenerationError(null);
    try {
      const result = await createAudioBatches(materialId, {
        topic_indexes: selected,
        level,
      });
      if (!result.ok) {
        throw new Error(result.detail || "Could not start generation.");
      }
      await queryClient.invalidateQueries({
        queryKey: ["study", "audio", "batches", materialId],
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not start generation.";
      setGenerationError(message);
      Alert.alert("Could not start", message);
    } finally {
      setBusy(false);
    }
  }, [materialId, selected, level, queryClient]);

  /**
   * Drive the generation queue.
   *
   * The server holds the queue in Postgres and the client pulls it
   * forward one episode at a time, because Render's free tier cannot
   * be relied on to run in-process background tasks. Each episode is
   * an AI script plus a speech synthesis, so this takes a while — the
   * progress line tells the student what is happening.
   */
  const driveGeneration = useCallback(async () => {
    setGenerating(true);
    setGenerationError(null);
    try {
      for (let round = 0; round < 60; round += 1) {
        const result = await generateNextAudioEpisode(materialId);
        if (result.error) {
          setGenerationError(
            result.refunded
              ? "That episode could not be made. You have not been charged for it."
              : "That episode could not be made.",
          );
          break;
        }
        if (!result.processed) break;
        await queryClient.invalidateQueries({
          queryKey: ["study", "audio", "batches", materialId],
        });
        if (!result.remaining) break;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Generation stopped.";
      setGenerationError(message);
    } finally {
      setGenerating(false);
      await queryClient.invalidateQueries({
        queryKey: ["study", "audio", "batches", materialId],
      });
    }
  }, [materialId, queryClient]);

  const downloadEpisode = useCallback(
    async (episode: AudioEpisode) => {
      if (!episode.audio_url) return;
      setDownloadingId(episode.id);
      const outcome = await downloadEpisodeAudio(
        episode.audio_url,
        `pagepay-${episode.topic_index + 1}-${episode.episode_index + 1}`,
      );
      setDownloadingId(null);
      Alert.alert(
        outcome.ok ? "Saved" : "Could not save",
        outcome.message,
      );
    },
    [],
  );

  const topics = topicsQ.data?.topics ?? [];
  const hasQueued = episodes.some(
    (e) => e.status === "queued" || e.status === "generating",
  );

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{ flex: 1, backgroundColor: tokens.paper }}
    >
      <PageHeader
        title="Podcast"
        subtitle={topicsQ.data?.title}
        showBack
        onBack={() => router.back()}
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        tokens={tokens}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ── Level ─────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: tokens.inkMuted }]}>
          EXPLAIN IT TO ME AT
        </Text>
        <View style={styles.levelRow}>
          {EDUCATION_LEVELS.map((option) => {
            const active = option.value === level;
            return (
              <Pressable
                key={option.value}
                onPress={() => setLevel(option.value)}
                style={[
                  styles.levelChip,
                  {
                    backgroundColor: active ? tokens.mint : tokens.card,
                    borderColor: active ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.levelChipText,
                    { color: active ? tokens.mintText : tokens.ink },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.levelBlurb, { color: tokens.inkMuted }]}>
          {EDUCATION_LEVELS.find((o) => o.value === level)?.blurb}
        </Text>

        {/* ── Topics ─────────────────────────────────────────────── */}
        {topics.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionLabel, { color: tokens.inkMuted }]}>
                TOPICS TO NARRATE
              </Text>
              <Pressable onPress={toggleAll} hitSlop={8}>
                <Text style={[styles.linkText, { color: tokens.mint }]}>
                  {selected.length === topics.length ? "Clear" : "Select all"}
                </Text>
              </Pressable>
            </View>

            {topics.map((topic) => {
              const checked = selected.includes(topic.topic_index);
              return (
                <Pressable
                  key={topic.topic_index}
                  onPress={() => toggleTopic(topic.topic_index)}
                  style={[
                    styles.topicRow,
                    {
                      backgroundColor: checked ? tokens.mintFaint : tokens.card,
                      borderColor: checked ? tokens.mint : tokens.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={checked ? "checkbox" : "square-outline"}
                    size={20}
                    color={checked ? tokens.mint : tokens.inkFaint}
                  />
                  <View style={styles.topicText}>
                    <Text style={[styles.topicName, { color: tokens.ink }]}>
                      {topic.topic_name}
                    </Text>
                    <Text
                      style={[styles.topicMeta, { color: tokens.inkMuted }]}
                    >
                      {topic.episodes} episode{topic.episodes === 1 ? "" : "s"} ·{" "}
                      {formatMinutes(topic.estimated_seconds)}
                    </Text>
                  </View>
                  <Text style={[styles.topicCost, { color: tokens.inkMuted }]}>
                    {topic.cost_sv} sv
                  </Text>
                </Pressable>
              );
            })}

            {quoteQ.data && (
              <View
                style={[
                  styles.quoteCard,
                  { backgroundColor: tokens.cardSecondary, borderColor: tokens.border },
                ]}
              >
                <Text style={[styles.quoteLine, { color: tokens.ink }]}>
                  {quoteQ.data.episode_count} episode
                  {quoteQ.data.episode_count === 1 ? "" : "s"} ·{" "}
                  {formatMinutes(quoteQ.data.estimated_seconds)}
                </Text>
                <Text style={[styles.quoteLine, { color: tokens.inkMuted }]}>
                  Cost {quoteQ.data.total_cost_sv} sv · Balance{" "}
                  {quoteQ.data.balance_sv} sv
                </Text>
                <Pressable
                  onPress={startGeneration}
                  disabled={busy || generating}
                  style={[
                    styles.primaryBtn,
                    {
                      backgroundColor: tokens.mint,
                      opacity: busy || generating ? 0.5 : 1,
                    },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={tokens.mintText} />
                  ) : (
                    <Text style={[styles.primaryBtnText, { color: tokens.mintText }]}>
                      Generate narration
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
          </>
        )}

        {/* ── Episodes ──────────────────────────────────────────── */}
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionLabel, { color: tokens.inkMuted }]}>
            EPISODES
          </Text>
          {hasQueued && !generating && (
            <Pressable onPress={driveGeneration} hitSlop={8}>
              <Text style={[styles.linkText, { color: tokens.mint }]}>
                Continue generating
              </Text>
            </Pressable>
          )}
        </View>

        {generating && (
          <View
            style={[
              styles.noticeCard,
              { backgroundColor: tokens.mintSoft, borderColor: tokens.border },
            ]}
          >
            <ActivityIndicator color={tokens.mint} />
            <Text style={[styles.noticeText, { color: tokens.ink }]}>
              Making your narration. This takes a minute per episode — keep
              the app open.
            </Text>
          </View>
        )}

        {generationError && (
          <View
            style={[
              styles.noticeCard,
              { backgroundColor: tokens.signalSoft, borderColor: tokens.border },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={18} color={tokens.signal} />
            <Text style={[styles.noticeText, { color: tokens.ink }]}>
              {generationError}
            </Text>
          </View>
        )}

        {episodes.length === 0 && !generating && (
          <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
            No episodes yet. Pick the topics you want to hear and generate them
            above.
          </Text>
        )}

        {episodes.map((episode) => {
          const isActive = episode.id === activeEpisodeId;
          const playable = episode.status === "ready" && !!episode.audio_url;
          return (
            <View
              key={episode.id}
              style={[
                styles.episodeRow,
                {
                  backgroundColor: isActive ? tokens.mintFaint : tokens.card,
                  borderColor: isActive ? tokens.mint : tokens.border,
                },
              ]}
            >
              <Pressable
                onPress={() => playable && playEpisode(episode)}
                disabled={!playable}
                style={styles.episodeMain}
              >
                <View
                  style={[styles.episodeIcon, { backgroundColor: tokens.mintSoft }]}
                >
                  <Ionicons
                    name={
                      episode.status === "failed"
                        ? "close"
                        : episode.status === "ready"
                          ? "play"
                          : "hourglass-outline"
                    }
                    size={18}
                    color={
                      episode.status === "failed" ? tokens.signal : tokens.mint
                    }
                  />
                </View>
                <View style={styles.episodeText}>
                  <Text style={[styles.episodeTitle, { color: tokens.ink }]}>
                    Episode {episode.episode_index + 1}
                    {episode.total_episodes > 1
                      ? ` of ${episode.total_episodes}`
                      : ""}
                    {episode.refunded_at ? " · refunded" : ""}
                  </Text>
                  <Text
                    style={[styles.episodeMeta, { color: tokens.inkMuted }]}
                  >
                    {episode.status === "failed"
                      ? episode.error_message || "Could not be made"
                      : episode.status === "ready"
                        ? formatMinutes(
                            episode.actual_duration_seconds ||
                              episode.estimated_seconds,
                          )
                        : episode.status === "generating"
                          ? "Making it now…"
                          : "Waiting to be made"}
                  </Text>
                </View>
              </Pressable>
              {playable && (
                <Pressable
                  onPress={() => downloadEpisode(episode)}
                  hitSlop={8}
                  style={styles.episodeAction}
                >
                  {downloadingId === episode.id ? (
                    <ActivityIndicator size="small" color={tokens.mint} />
                  ) : (
                    <Ionicons
                      name="download-outline"
                      size={20}
                      color={tokens.inkMuted}
                    />
                  )}
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* ── Player dock ────────────────────────────────────────── */}
      {activeEpisode && activeEpisode.audio_url && (
        <View style={styles.playerDock} pointerEvents="box-none">
          <EpisodePlayer
            key={activeEpisode.id}
            episode={activeEpisode}
            title={topicsQ.data?.title ?? "My study material"}
            tokens={tokens}
            onFinished={handleFinished}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 150,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 22,
    marginBottom: 8,
  },
  linkText: {
    fontSize: 13,
    fontWeight: "600",
  },
  levelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  levelChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  levelChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  levelBlurb: {
    fontSize: 13,
    marginTop: 8,
  },
  topicRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  topicText: {
    flex: 1,
  },
  topicName: {
    fontSize: 15,
    fontWeight: "600",
  },
  topicMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  topicCost: {
    fontSize: 13,
    fontWeight: "600",
  },
  quoteCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  quoteLine: {
    fontSize: 14,
    marginBottom: 4,
  },
  primaryBtn: {
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  noticeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 4,
  },
  episodeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  episodeMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  episodeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  episodeText: {
    flex: 1,
  },
  episodeTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  episodeMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  episodeAction: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  playerDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  playerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  playerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  playerInfo: {
    flex: 1,
  },
  playerTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  playerMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  playerSkip: {
    padding: 6,
  },
});
