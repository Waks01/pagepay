import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { CustomSlider } from "./CustomSlider";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

interface DiscountSliderProps {
  productPriceKobo: number;
  userServiceCreditBalance: number;
  maxDiscountPercent?: number;
  onDiscountChange: (svAmount: number) => void;
}

export function DiscountSlider({
  productPriceKobo,
  userServiceCreditBalance,
  maxDiscountPercent = 25,
  onDiscountChange,
}: DiscountSliderProps) {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const maxDiscountSv = Math.ceil(
    (productPriceKobo / 10) * (maxDiscountPercent / 100),
  );
  const [selectedSv, setSelectedSv] = useState(0);

  const handleSliderChange = (value: number) => {
    const svAmount = Math.round((value / 100) * maxDiscountSv);
    setSelectedSv(svAmount);
    onDiscountChange(svAmount);
  };

  const shortfallSv = Math.max(0, selectedSv - userServiceCreditBalance);
  const nairaSaved = (selectedSv * 10) / 100;

  if (maxDiscountSv === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: tokens.paperSubtle }]}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: tokens.ink }]}>
          {t("sv_discount.slider_label", { percent: maxDiscountPercent })}
        </Text>
        {selectedSv > 0 && (
          <Text style={[styles.saveAmount, { color: tokens.mint }]}>
            Save ₦{nairaSaved.toFixed(2)}
          </Text>
        )}
      </View>

      <CustomSlider
        value={(selectedSv / maxDiscountSv) * 100}
        onValueChange={handleSliderChange}
        minimumValue={0}
        maximumValue={100}
        step={1}
        style={styles.slider}
        minimumTrackTintColor={tokens.mint}
        maximumTrackTintColor={tokens.border}
        thumbTintColor={tokens.mint}
      />

      <View style={styles.info}>
        <Text style={[styles.infoText, { color: tokens.inkMuted }]}>
          Max: {maxDiscountSv} SV ({maxDiscountPercent}%)
        </Text>
      </View>

      {shortfallSv > 0 && (
        <View
          style={[styles.shortfall, { backgroundColor: tokens.signalSoft }]}
        >
          <View style={styles.shortfallContent}>
            <Ionicons name="warning-outline" size={16} color={tokens.signal} />
            <Text style={[styles.shortfallText, { color: tokens.signal }]}>
              Need {shortfallSv} more SV
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 12,
    marginVertical: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    flexWrap: "wrap",
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
    minWidth: 120,
  },
  saveAmount: {
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 0,
  },
  slider: {
    width: "100%",
    height: 40,
  },
  info: {
    marginTop: 4,
  },
  infoText: {
    fontSize: 12,
  },
  shortfall: {
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    gap: 8,
  },
  shortfallContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  shortfallText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "500",
  },
});
