import React from "react";
import { TouchableOpacity, Text, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type VTUServiceCardProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  earn: string;
  onPress?: () => void;
};

const ICON_BG: Record<string, string> = {
  "phone-portrait-outline": "#dbeafe",
  "wifi-outline": "#dcfce7",
  "flash-outline": "#fef3c7",
  "tv-outline": "#fce7f3",
  "card-outline": "#e0e7ff",
  "logo-bitcoin": "#f3e8ff",
  "school-outline": "#ffedd5",
  "send-outline": "#ffe4e6",
};

export const VTUServiceCard = React.memo(function VTUServiceCard({
  icon,
  label,
  earn,
  onPress,
}: VTUServiceCardProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.card,
        { backgroundColor: tokens.card, borderColor: tokens.border },
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: ICON_BG[icon] || "#f3f4f6" },
        ]}
      >
        <Ionicons name={icon} size={24} color={tokens.mint} />
      </View>
      <Text style={[styles.name, { color: tokens.ink }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.earnBadge, { backgroundColor: tokens.mintSoft }]}>
        <Text style={[styles.earnText, { color: tokens.mint }]}>
          Earn {earn}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    width: 140,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    gap: 10,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  earnBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  earnText: {
    fontSize: 11,
    fontWeight: "700",
  },
});
