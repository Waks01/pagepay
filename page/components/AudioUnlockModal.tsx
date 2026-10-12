import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { apiFetch } from "@/src/shared/api/client";
import { PagePay } from "@/constants/theme";
import { useCurrentUser } from "@/src/shared/lib/current-user";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PagePaySpinner } from "@/components/PagePaySpinner";

type Props = {
  visible: boolean;
  materialId: number;
  materialTitle: string;
  onClose: () => void;
  onUnlocked: () => void;
};

type AudioUnlockStatus = {
  unlocked: boolean;
  material_id: number;
  method: string | null;
  cost_sv: number;
};

type UnlockMethod = "sv" | "cashable";

type SheetProps = {
  materialId: number;
  materialTitle: string;
  status: AudioUnlockStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Service credit balance — the primary unlock wallet. */
  svBalance: number;
  /** Cashable (withdrawable) balance — the alternative wallet. */
  cashableBalance: number;
  onClose: () => void;
  onUnlocked: () => void;
};

/**
 * One-time audio unlock for a study material.
 *
 * Payment is service credits (SV), the spendable side of the wallet
 * split — cashable earnings are deliberately never a payment source
 * here. The price shown is the server's (`/audio-status` → `cost_sv`),
 * never a client-side guess, and the user's balance is checked before
 * the request so an unaffordable unlock is visible, not a surprise.
 * Backend rejections (402 insufficient SV) are surfaced verbatim.
 *
 * The sheet below mounts only while the modal is open, so its per-session
 * state (spinner, error) starts fresh on every open without an effect.
 */
export default function AudioUnlockModal({
  visible,
  materialId,
  materialTitle,
  onClose,
  onUnlocked,
}: Props) {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const currentUser = useCurrentUser();

  const statusQ = useQuery({
    queryKey: ["audio-unlock-status", materialId],
    queryFn: async (): Promise<AudioUnlockStatus> => {
      const res = await apiFetch(
        `/api/v1/study/materials/${materialId}/audio-status`,
      );
      if (!res.ok) throw new Error("Failed to load audio status");
      return res.json();
    },
    enabled: visible && materialId > 0,
  });

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
        <Animated.View
          entering={FadeInDown.duration(200)}
          style={[styles.card, { backgroundColor: tokens.paper }]}
        >
          <UnlockSheet
            key={materialId}
            materialId={materialId}
            materialTitle={materialTitle}
            status={statusQ.data}
            isLoading={statusQ.isLoading}
            isError={statusQ.isError}
            svBalance={currentUser?.service_credit_balance ?? 0}
            cashableBalance={currentUser?.cashable_balance ?? 0}
            onClose={onClose}
            onUnlocked={onUnlocked}
          />
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

function UnlockSheet({
  materialId,
  materialTitle,
  status,
  isLoading,
  isError,
  svBalance,
  cashableBalance,
  onClose,
  onUnlocked,
}: SheetProps) {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();

  // Mounted only while the modal is open, so every open starts clean.
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  // SV is the primary wallet; the choice sticks across opens so a user
  // who prefers spending earnings isn't re-prompted every unlock.
  const [method, setMethod] = useState<UnlockMethod>("sv");

  const alreadyUnlocked = status?.unlocked === true;
  const cost = status?.cost_sv ?? 0;
  const wallets: { key: UnlockMethod; unit: string; balance: number }[] = [
    { key: "sv", unit: "sv", balance: svBalance },
    { key: "cashable", unit: "pts", balance: cashableBalance },
  ];
  const canPay = (balance: number) => cost > 0 && balance >= cost;
  const anyAffordable = wallets.some((w) => canPay(w.balance));
  const shortfall = Math.max(0, cost - (method === "sv" ? svBalance : cashableBalance));

  const handleUnlock = async () => {
    setUnlocking(true);
    setUnlockError(null);
    try {
      const res = await apiFetch(
        `/api/v1/study/materials/${materialId}/unlock-audio`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unlock failed" }));
        const detail =
          err.detail || `Could not unlock audio (error ${res.status}).`;
        setUnlockError(detail);
        Alert.alert(
          t("study.audio_unlock.error_title", "Unlock Failed"),
          detail,
        );
        return;
      }
      qc.invalidateQueries({ queryKey: ["audio-unlock-status"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      onUnlocked();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unlock failed";
      setUnlockError(message);
      Alert.alert(t("study.audio_unlock.error_title", "Unlock Failed"), message);
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <>
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
      ) : isLoading ? (
        <View style={styles.loadingBox}>
          <PagePaySpinner size={22} />
          <Text style={[styles.loadingText, { color: tokens.inkMuted }]}>
            {t("common.loading", "Loading…")}
          </Text>
        </View>
      ) : isError ? (
        <View style={styles.loadingBox}>
          <Ionicons name="alert-circle-outline" size={36} color={tokens.signal} />
          <Text style={[styles.loadingText, { color: tokens.inkMuted }]}>
            {t(
              "study.audio_unlock.status_error",
              "Could not load the unlock price. Close and try again.",
            )}
          </Text>
        </View>
      ) : (
        <>
          <ScrollView style={styles.body} contentContainerStyle={{ gap: 16 }}>
            <View style={[styles.costBox, { backgroundColor: tokens.border + "33" }]}>
              <Text style={[styles.costLabel, { color: tokens.inkMuted }]}>
                {t("study.audio_unlock.cost_label", "Unlock cost")}
              </Text>
              <Text style={[styles.costValue, { color: tokens.ink }]}>
                {cost} sv
              </Text>
              <Text style={[styles.costSub, { color: tokens.inkMuted }]}>
                {t("study.audio_unlock.once", "One-time · listen forever")}
              </Text>
            </View>

            <View style={styles.walletList}>
              {wallets.map((wallet) => {
                const affordable = canPay(wallet.balance);
                const selected = method === wallet.key;
                return (
                  <Pressable
                    key={wallet.key}
                    onPress={() => setMethod(wallet.key)}
                    disabled={!affordable || unlocking}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: !affordable }}
                    style={[
                      styles.walletRow,
                      {
                        borderColor: selected ? tokens.mint : tokens.border,
                        backgroundColor: selected ? tokens.mintSoft : tokens.card,
                        opacity: !affordable ? 0.55 : 1,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.radio,
                        { borderColor: selected ? tokens.mint : tokens.border },
                      ]}
                    >
                      {selected && (
                        <View style={[styles.radioDot, { backgroundColor: tokens.mint }]} />
                      )}
                    </View>
                    <View style={styles.walletInfo}>
                      <Text style={[styles.walletLabel, { color: tokens.ink }]}>
                        {t(
                          wallet.key === "sv"
                            ? "study.audio_unlock.wallet_sv"
                            : "study.audio_unlock.wallet_cashable",
                          wallet.key === "sv" ? "Service credits" : "Cashable points",
                        )}
                      </Text>
                      <Text style={[styles.walletBalance, { color: tokens.inkMuted }]}>
                        {affordable
                          ? `${wallet.balance} ${wallet.unit}`
                          : t("study.audio_unlock.need_more", {
                              count: cost - wallet.balance,
                              defaultValue: "Need {{count}} more",
                            })}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {!anyAffordable && (
              <View
                style={[styles.shortfallBox, { borderColor: tokens.signal + "55" }]}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={16}
                  color={tokens.signal}
                />
                <Text style={[styles.shortfallText, { color: tokens.inkMuted }]}>
                  {t("study.audio_unlock.shortfall", {
                    count: shortfall,
                    defaultValue:
                      "You need {{count}} more. Score 80%+ on quizzes to earn more.",
                  })}
                </Text>
              </View>
            )}

            <Text style={[styles.hint, { color: tokens.inkMuted }]}>
              {t(
                "study.audio_unlock.hint",
                "Unlock instantly with service credits or cashable points. Audio is generated once and yours forever.",
              )}
            </Text>
          </ScrollView>

          <Pressable
            onPress={handleUnlock}
            disabled={unlocking || !anyAffordable}
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: tokens.mint,
                opacity: pressed || unlocking || !anyAffordable ? 0.6 : 1,
              },
            ]}
          >
            <Text style={styles.ctaText}>
              {unlocking
                ? t("study.audio_unlock.unlocking", "Unlocking…")
                : anyAffordable
                  ? t("study.audio_unlock.cta", "Unlock for {{cost}} {{unit}}", {
                      cost,
                      unit: method === "sv" ? "sv" : "pts",
                    })
                  : t("study.audio_unlock.cta_short", "Not enough balance")}
            </Text>
          </Pressable>

          {!!unlockError && (
            <Pressable onPress={() => setUnlockError(null)} style={styles.secondaryCta}>
              <Text style={[styles.secondaryCtaText, { color: tokens.signal }]}>
                {t("common.dismiss", "Dismiss")}
              </Text>
            </Pressable>
          )}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
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
  loadingBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 20,
  },
  loadingText: {
    fontSize: 13,
    textAlign: "center",
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
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  balanceLabel: {
    fontSize: 13,
  },
  balanceValue: {
    fontSize: 15,
    fontWeight: "700",
  },
  walletList: {
    gap: 8,
  },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
  },
  walletInfo: {
    flex: 1,
    gap: 2,
  },
  walletLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  walletBalance: {
    fontSize: 12,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  shortfallBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  shortfallText: {
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
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
  secondaryCta: {
    alignItems: "center",
    paddingVertical: 8,
  },
  secondaryCtaText: {
    fontSize: 13,
    fontWeight: "600",
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
