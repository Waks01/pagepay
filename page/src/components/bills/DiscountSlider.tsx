import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
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
  const adsNeeded = Math.ceil(shortfallSv / 16);
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
            {t("sv_discount.save_amount", {
              amount: nairaSaved.toFixed(2),
              sv: selectedSv,
            })}
          </Text>
        )}
      </View>

      <CustomSlider
        value={(selectedSv / maxDiscountSv) * 100}
        onValueChange={(value) => handleSliderChange(value)}
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
          {t("sv_discount.max_discount", {
            sv: maxDiscountSv,
            percent: maxDiscountPercent,
          })}
        </Text>
      </View>

      {shortfallSv > 0 && (
        <View style={[styles.warning, { backgroundColor: tokens.signalSoft }]}>
          <Ionicons name="warning-outline" size={16} color={tokens.signal} />
          <Text style={[styles.warningText, { color: tokens.signal }]}>
            {t("sv_discount.insufficient_sv", {
              sv: shortfallSv,
              ads: adsNeeded,
            })}
          </Text>
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
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  saveAmount: {
    fontSize: 14,
    fontWeight: "700",
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
  warning: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    borderRadius: 8,
    marginTop: 8,
    gap: 6,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "500",
  },
});
