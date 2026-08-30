import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { apiFetch } from "@/src/shared/api/client";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type Props = {
  visible: boolean;
  materialId: number;
  materialTitle: string;
  contentLength?: number;
  onClose: () => void;
  onUnlocked: () => void;
};

type AudioUnlockStatus = {
  unlocked: boolean;
  material_id: number;
  method: string | null;
  cost_sv: number;
};

const AVG_SV_PER_AD = 20;

export default function AudioUnlockModal({
  visible,
  materialId,
  materialTitle,
  contentLength = 0,
  onClose,
  onUnlocked,
}: Props) {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();

  const [adCount, setAdCount] = useState(1);
  const [unlocking, setUnlocking] = useState(false);

  const maxAds =
    contentLength > 0 ? Math.max(1, Math.ceil(contentLength / 500) + 2) : 5;
  const selectedCost = adCount * AVG_SV_PER_AD;

  const { data: status } = useQuery({
    queryKey: ["audio-unlock-status", materialId],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/v1/study/materials/${materialId}/audio-status`,
      );
      if (!res.ok)
        return {
          unlocked: false,
          material_id: materialId,
          cost_sv: 0,
        } as AudioUnlockStatus;
      return (await res.json()) as AudioUnlockStatus;
    },
    enabled: visible,
  });

  useEffect(() => {
    if (visible) {
      setAdCount(1);
      setUnlocking(false);
    }
  }, [visible]);

  const adjustAds = (delta: number) => {
    setAdCount((prev) => Math.max(1, Math.min(maxAds, prev + delta)));
  };

  const handleUnlock = async () => {
    setUnlocking(true);
    try {
      const res = await apiFetch(
        `/api/v1/study/materials/${materialId}/unlock-audio`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "sv" }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unlock failed" }));
        throw new Error(err.detail || "Unlock failed");
      }
      qc.invalidateQueries({ queryKey: ["audio-unlock-status"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      onUnlocked();
    } catch (error) {
      console.error("Audio unlock failed:", error);
    } finally {
      setUnlocking(false);
    }
  };

  if (!visible) return null;

  const alreadyUnlocked = status?.unlocked;

  return (
    <View style={[styles.overlay, StyleSheet.absoluteFill]}>
      <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
        <Animated.View
          entering={FadeInDown.duration(200)}
          style={[styles.card, { backgroundColor: tokens.paper }]}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: tokens.ink }]}>
                {t("study.audio_unlock.title", "Unlock Audio")}
              </Text>
              <Text
                style={[styles.subtitle, { color: tokens.inkMuted }]}
                numberOfLines={2}
              >
                {materialTitle}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={tokens.ink} />
            </Pressable>
          </View>

          {alreadyUnlocked ? (
            <View style={styles.unlockedBox}>
              <Ionicons name="checkmark-circle" size={48} color={tokens.mint} />
              <Text style={[styles.unlockedTitle, { color: tokens.ink }]}>
                {t("study.audio_unlock.unlocked_title", "Audio Unlocked")}
              </Text>
              <Text style={[styles.unlockedBody, { color: tokens.inkMuted }]}>
                {t(
                  "study.audio_unlock.unlocked_body",
                  "You can now listen to this material anytime.",
                )}
              </Text>
            </View>
          ) : (
            <>
              <ScrollView
                style={styles.body}
                contentContainerStyle={{ gap: 16 }}
              >
                <View
                  style={[
                    styles.costBox,
                    { backgroundColor: tokens.border + "33" },
                  ]}
                >
                  <Text style={[styles.costLabel, { color: tokens.inkMuted }]}>
                    {t("study.audio_unlock.cost_label", "Unlock cost")}
                  </Text>
                  <Text style={[styles.costValue, { color: tokens.ink }]}>
                    {selectedCost} sv
                  </Text>
                  <Text style={[styles.costSub, { color: tokens.inkMuted }]}>
                    {t("study.audio_unlock.cost_sub", "~{{count}} ads", {
                      count: adCount,
                    })}
                  </Text>
                </View>

                <View style={styles.stepperRow}>
                  <Pressable
                    onPress={() => adjustAds(-1)}
                    disabled={adCount <= 1}
                    style={({ pressed }) => [
                      styles.stepperBtn,
                      {
                        backgroundColor: tokens.border,
                        opacity: pressed || adCount <= 1 ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Ionicons name="remove" size={20} color={tokens.ink} />
                  </Pressable>
                  <View style={styles.stepperValueBox}>
                    <Text style={[styles.stepperValue, { color: tokens.ink }]}>
                      {adCount}
                    </Text>
                    <Text
                      style={[styles.stepperLabel, { color: tokens.inkMuted }]}
                    >
                      {t("study.audio_unlock.ads_label", "ads")}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => adjustAds(1)}
                    disabled={adCount >= maxAds}
                    style={({ pressed }) => [
                      styles.stepperBtn,
                      {
                        backgroundColor: tokens.border,
                        opacity: pressed || adCount >= maxAds ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Ionicons name="add" size={20} color={tokens.ink} />
                  </Pressable>
                </View>

                <Text style={[styles.hint, { color: tokens.inkMuted }]}>
                  {t(
                    "study.audio_unlock.hint",
                    "Watch rewarded ads or spend service credits to unlock audio permanently.",
                  )}
                </Text>
              </ScrollView>

              <Pressable
                onPress={handleUnlock}
                disabled={unlocking}
                style={({ pressed }) => [
                  styles.cta,
                  {
                    backgroundColor: tokens.mint,
                    opacity: pressed || unlocking ? 0.75 : 1,
                  },
                ]}
              >
                <Text style={styles.ctaText}>
                  {unlocking
                    ? t("study.audio_unlock.unlocking", "Unlocking...")
                    : t("study.audio_unlock.cta", "Unlock Audio")}
                </Text>
              </Pressable>
            </>
          )}
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    zIndex: 9999,
    elevation: 9999,
  },
  safeArea: {
    width: "100%",
  },
  card: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    maxHeight: 260,
  },
  costBox: {
    padding: 16,
    borderRadius: 16,
    gap: 4,
  },
  costLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  costValue: {
    fontSize: 28,
    fontWeight: "700",
  },
  costSub: {
    fontSize: 13,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValueBox: {
    alignItems: "center",
    gap: 2,
    minWidth: 80,
  },
  stepperValue: {
    fontSize: 22,
    fontWeight: "700",
  },
  stepperLabel: {
    fontSize: 12,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
  },
  cta: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  ctaText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  unlockedBox: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  unlockedTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  unlockedBody: {
    fontSize: 14,
    textAlign: "center",
  },
});
