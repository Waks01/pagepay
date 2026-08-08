import { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type BannerNotification = {
  id: number;
  title: string;
  body: string;
  category: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
};

type Props = {
  notifications: BannerNotification[];
  onDismiss: (id: number) => void;
  onPress: (notification: BannerNotification) => void;
};

export default function BannerNotification({
  notifications,
  onDismiss,
  onPress,
}: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  if (notifications.length === 0) return null;

  const visible = notifications.slice(0, 2);

  return (
    <View style={styles.container} pointerEvents="box-none">
      {visible.map((notification, index) => (
        <BannerItem
          key={notification.id}
          notification={notification}
          tokens={tokens}
          index={index}
          onDismiss={onDismiss}
          onPress={onPress}
        />
      ))}
    </View>
  );
}

type BannerItemProps = {
  notification: BannerNotification;
  tokens: any;
  index: number;
  onDismiss: (id: number) => void;
  onPress: (notification: BannerNotification) => void;
};

function BannerItem({ notification, tokens, index, onDismiss, onPress }: BannerItemProps) {
  const [expanded, setExpanded] = useState(false);

  const categoryColor = getCategoryColor(notification.category);
  const categoryIcon = getCategoryIcon(notification.category);

  const handlePress = useCallback(() => {
    onPress(notification);
  }, [notification, onPress]);

  const handleDismiss = useCallback(() => {
    onDismiss(notification.id);
  }, [notification.id, onDismiss]);

  const handleAction = useCallback(() => {
    onPress(notification);
  }, [notification, onPress]);

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: tokens.card,
          borderColor: tokens.border,
          marginTop: index === 0 ? 0 : 8,
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handlePress}
        style={styles.bannerContent}
      >
        <View style={[styles.iconBadge, { backgroundColor: categoryColor + "20" }]}>
          <Ionicons name={categoryIcon} size={18} color={categoryColor} />
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: tokens.ink }]} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text
            style={[styles.body, { color: tokens.inkMuted }]}
            numberOfLines={expanded ? undefined : 2}
          >
            {notification.body}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleDismiss}
          style={styles.closeBtn}
          hitSlop={6}
        >
          <Ionicons name="close" size={16} color={tokens.inkMuted} />
        </TouchableOpacity>
      </TouchableOpacity>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: tokens.mint }]}
          onPress={handleAction}
        >
          <Text style={[styles.actionText, { color: tokens.mintText }]}>
            {getActionLabel(notification)}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.secondaryBtn, { borderColor: tokens.border }]}
          onPress={() => setExpanded((prev) => !prev)}
        >
          <Text style={[styles.actionText, { color: tokens.ink }]}>
            {expanded ? "Show Less" : "More"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function getCategoryIcon(category: string | null): keyof typeof Ionicons.glyphMap {
  switch (category) {
    case "study_reminders":
      return "school";
    case "task_alerts":
      return "clipboard";
    case "referral_bonuses":
      return "people";
    case "wallet_updates":
      return "wallet";
    case "ad_rewards":
      return "gift";
    case "subscriptions":
      return "star";
    default:
      return "notifications";
  }
}

function getCategoryColor(category: string | null): string {
  switch (category) {
    case "study_reminders":
      return "#007AFF";
    case "task_alerts":
      return "#FF9500";
    case "referral_bonuses":
      return "#34C759";
    case "wallet_updates":
      return "#FF2D55";
    case "ad_rewards":
      return "#AF52DE";
    default:
      return "#00C897";
  }
}

function getActionLabel(notification: BannerNotification): string {
  const service = (notification.data?.service as string | undefined) || "";
  if (service) {
    return `View ${service.replace("_", " ")}`;
  }
  if (notification.category === "wallet_updates") return "View Wallet";
  if (notification.category === "task_alerts") return "View Task";
  if (notification.category === "study_reminders") return "Study Now";
  return "View";
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  banner: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  bannerContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 10,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
  },
  body: {
    fontSize: 12,
    lineHeight: 16,
  },
  closeBtn: {
    padding: 4,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
