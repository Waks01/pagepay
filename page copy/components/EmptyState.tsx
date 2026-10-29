import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PagePay } from "@/constants/theme";

type EmptyStateProps = {
  iconName: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
};

export function EmptyState({
  iconName,
  title,
  subtitle,
  ctaLabel,
  onCta,
}: EmptyStateProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: tokens.mintSoft || "#E8F5E9" },
        ]}
      >
        <Ionicons name={iconName as any} size={36} color={tokens.mint} />
      </View>
      <Text style={[styles.title, { color: tokens.ink }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
          {subtitle}
        </Text>
      ) : null}
      {ctaLabel && onCta ? (
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: tokens.mint }]}
          onPress={onCta}
        >
          <Text style={[styles.ctaText, { color: tokens.mintText }]}>
            {ctaLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontFamily: "SpaceGrotesk_700Bold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  cta: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 4,
  },
  ctaText: {
    fontSize: 14,
    fontFamily: "SpaceGrotesk_700Bold",
  },
});
