/**
 * StudyAudioPlayer — floating audio controller for the material reader.
 *
 * Rendered above the reader content once a TTS URL exists. Uses expo-audio
 * for playback and exposes seek, skip ±15s, scrub, and speed controls.
 */

import { useState, useCallback, useEffect } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { AudioStatus, AudioPlayer } from "expo-audio";

import { CustomSlider } from "@/src/components/bills/CustomSlider";
import { Fonts, PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];
const SKIP_SECONDS = 15;

type Props = {
  title: string;
  player: AudioPlayer;
  status: AudioStatus;
};

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function StudyAudioPlayer({ title, player, status }: Props) {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [speedOpen, setSpeedOpen] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  /** Non-null while the user drags the scrubber, so live ticks don't fight it. */
  const [scrubValue, setScrubValue] = useState<number | null>(null);

  const duration = status.duration && status.duration > 0 ? status.duration : 0;
  const currentTime = status.currentTime ?? 0;
  const playing = status.playing;
  const isBuffering = status.isLoaded === false;

  // Display value: the in-flight scrub value, else the live position.
  const sliderValue = scrubValue ?? currentTime;

  // Drop any stale scrub override when the track restarts.
  useEffect(() => {
    if (status.didJustFinish) {
      setScrubValue(null);
    }
  }, [status.didJustFinish]);

  const togglePlay = useCallback(() => {
    if (playing) {
      player.pause();
      return;
    }
    // Track has ended: rewind so the next press starts a fresh pass
    // instead of silently doing nothing at the end position.
    if (status.didJustFinish) {
      setScrubValue(null);
      void player.seekTo(0);
    }
    void player.play();
  }, [player, playing, status.didJustFinish]);

  const toggleMute = useCallback(() => {
    player.muted = !player.muted;
  }, [player]);

  const skipBy = useCallback(
    (delta: number) => {
      const base = scrubValue ?? currentTime;
      const next = Math.max(0, Math.min(duration || base, base + delta));
      setScrubValue(null);
      void player.seekTo(next);
    },
    [currentTime, duration, player, scrubValue],
  );

  const onScrubChange = useCallback((value: number) => {
    setScrubValue(value);
  }, []);

  const onScrubComplete = useCallback(
    (value: number) => {
      setScrubValue(null);
      void player.seekTo(Math.max(0, Math.min(duration || value, value)));
    },
    [duration, player],
  );

  const pickSpeed = useCallback(
    (rate: number) => {
      setSpeed(rate);
      setSpeedOpen(false);
      try {
        player.setPlaybackRate(rate);
      } catch {
        try {
          player.playbackRate = rate;
        } catch {
          /* ignore unsupported platforms */
        }
      }
    },
    [player],
  );

  const remaining = Math.max(0, duration - (scrubValue ?? currentTime));

  return (
    <>
      <View
        style={[
          styles.container,
          { backgroundColor: tokens.card, borderColor: tokens.border },
        ]}
      >
        {/* ── Title row ── */}
        <View style={styles.topRow}>
          <TouchableOpacity
            onPress={toggleMute}
            style={[styles.iconWrap, { backgroundColor: tokens.mintSoft }]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={
              status.mute ? t("study.audio_player.unmute") : t("study.audio_player.mute")
            }
          >
            <Ionicons
              name={status.mute ? "volume-mute" : "volume-medium"}
              size={17}
              color={tokens.mint}
            />
          </TouchableOpacity>
          <View style={styles.info}>
            <Text
              style={[styles.title, { color: tokens.ink }]}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text style={[styles.sub, { color: tokens.inkMuted }]}>
              {isBuffering
                ? t("study.audio_player.loading")
                : duration > 0
                  ? t("study.audio_player.remaining", {
                      time: fmtTime(remaining),
                    })
                  : t("study.audio_player.audio")}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setSpeedOpen((v) => !v)}
            style={[styles.speedPill, { backgroundColor: tokens.mintSoft }]}
            hitSlop={6}
          >
            <Text style={[styles.speedPillText, { color: tokens.mint }]}>
              {speed.toFixed(2).replace(/\.?0+$/, "")}x
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Scrubber ── */}
        <View style={styles.trackWrap}>
          <CustomSlider
            value={sliderValue}
            onValueChange={onScrubChange}
            onSlidingComplete={onScrubComplete}
            minimumValue={0}
            maximumValue={Math.max(1, duration)}
            step={0.1}
            minimumTrackTintColor={tokens.mint}
            maximumTrackTintColor={tokens.border}
            thumbTintColor={tokens.mint}
            disabled={isBuffering}
          />
          <View style={styles.times}>
            <Text style={[styles.time, { color: tokens.inkMuted }]}>
              {fmtTime(sliderValue)}
            </Text>
            <Text style={[styles.time, { color: tokens.inkMuted }]}>
              {fmtTime(duration)}
            </Text>
          </View>
        </View>

        {/* ── Controls ── */}
        <View style={styles.controls}>
          <TouchableOpacity
            onPress={() => skipBy(-SKIP_SECONDS)}
            style={styles.sideBtn}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t("study.audio_player.skip_back", {
              seconds: SKIP_SECONDS,
            })}
          >
            <Ionicons name="play-back" size={24} color={tokens.ink} />
            <Text style={[styles.skipLabel, { color: tokens.ink }]}>
              {SKIP_SECONDS}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={togglePlay}
            activeOpacity={0.85}
            style={[
              styles.playBtn,
              {
                backgroundColor: tokens.mint,
                shadowColor: tokens.mint,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={playing ? t("study.audio_player.pause") : t("study.audio_player.play")}
          >
            <Ionicons
              name={playing ? "pause" : "play"}
              size={26}
              color={tokens.mintText}
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => skipBy(SKIP_SECONDS)}
            style={styles.sideBtn}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t("study.audio_player.skip_forward", {
              seconds: SKIP_SECONDS,
            })}
          >
            <Ionicons name="play-forward" size={24} color={tokens.ink} />
            <Text style={[styles.skipLabel, { color: tokens.ink }]}>
              {SKIP_SECONDS}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Speed menu ── */}
      <Modal
        visible={speedOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSpeedOpen(false)}
      >
        <Pressable
          style={styles.menuBackdrop}
          onPress={() => setSpeedOpen(false)}
        >
          <View
            style={[
              styles.menu,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <Text style={[styles.menuTitle, { color: tokens.inkFaint }]}>
              {t("study.audio_player.playback_speed")}
            </Text>
            {SPEEDS.map((rate) => (
              <TouchableOpacity
                key={rate}
                onPress={() => pickSpeed(rate)}
                style={[
                  styles.menuItem,
                  rate === speed && { backgroundColor: tokens.mintSoft },
                ]}
              >
                <Text
                  style={[
                    styles.menuItemText,
                    { color: rate === speed ? tokens.mint : tokens.ink },
                  ]}
                >
                  {rate.toFixed(2).replace(/\.?0+$/, "")}x
                </Text>
                {rate === speed && (
                  <Ionicons name="checkmark" size={16} color={tokens.mint} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
    shadowColor: "#0E1116",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: Fonts.editorialSemiBold as string,
    fontSize: 13,
    letterSpacing: -0.1,
  },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    fontWeight: "500",
    marginTop: 1,
  },
  speedPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  speedPillText: {
    fontFamily: Fonts.editorialSemiBold as string,
    fontSize: 12,
  },
  trackWrap: { marginBottom: 2 },
  times: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  time: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
  },
  sideBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  skipLabel: {
    position: "absolute",
    fontFamily: Fonts.editorialSemiBold as string,
    fontSize: 8,
  },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(14,17,22,0.5)",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 96,
  },
  menu: {
    width: 168,
    borderRadius: 14,
    borderWidth: 1,
    padding: 6,
  },
  menuTitle: {
    fontFamily: Fonts.editorialSemiBold as string,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
  },
  menuItemText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: "500",
  },
});
