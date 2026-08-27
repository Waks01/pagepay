import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

interface ShortfallModalProps {
  visible: boolean;
  shortfallSv: number;
  adsNeeded: number;
  onWatchAds: () => void;
  onCancel: () => void;
}

export function ShortfallModal({
  visible,
  shortfallSv,
  adsNeeded,
  onWatchAds,
  onCancel,
}: ShortfallModalProps) {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: tokens.paper }]}>
          <View style={[styles.iconContainer, { backgroundColor: tokens.signalSoft }]}>
            <Ionicons name="wallet-outline" size={48} color={tokens.signal} />
          </View>

          <Text style={[styles.title, { color: tokens.ink }]}>
            {t("sv_discount.shortfall_title")}
          </Text>

          <Text style={[styles.description, { color: tokens.inkMuted }]}>
            {t("sv_discount.shortfall_description", { sv: shortfallSv })}
          </Text>

          <View style={[styles.infoBox, { backgroundColor: tokens.paperSubtle }]}>
            <View style={styles.infoRow}>
              <Ionicons name="analytics-outline" size={20} color={tokens.mint} />
              <Text style={[styles.infoText, { color: tokens.ink }]}>
                {t("sv_discount.watch_ads_prompt", { ads: adsNeeded, sv: adsNeeded * 16 })}
              </Text>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton, { borderColor: tokens.border }]}
              onPress={onCancel}
            >
              <Text style={[styles.cancelButtonText, { color: tokens.ink }]}>
                {t("sv_discount.cancel")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.watchButton, { backgroundColor: tokens.mint }]}
              onPress={onWatchAds}
            >
              <Ionicons name="play-circle-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.watchButtonText, { color: tokens.mintText }]}>
                {t("sv_discount.watch_ads", { count: adsNeeded })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    width: "85%",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  description: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 20,
  },
  infoBox: {
    width: "100%",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  actions: {
    width: "100%",
    gap: 12,
  },
  button: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  watchButton: {
    // backgroundColor set via tokens
  },
  watchButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
});
