import { useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { apiFetch } from "@/src/shared/api/client";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { handleNotificationTap } from "@/src/lib/notifications";

type NotificationDetail = {
  id: number;
  user_id: number;
  title: string;
  body: string;
  category: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
};

export default function NotificationDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const notificationId = parseInt(params.id);

  const notificationQ = useQuery({
    queryKey: ["notification", notificationId],
    queryFn: async (): Promise<NotificationDetail> => {
      const res = await apiFetch(`/api/v1/notifications/${notificationId}`);
      if (!res.ok) throw new Error(t("notifications_list.load_failed"));
      return res.json();
    },
    enabled: !!notificationId && !isNaN(notificationId),
  });

  const markReadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        `/api/v1/notifications/${notificationId}/read`,
        {
          method: "POST",
        },
      );
      if (!res.ok) throw new Error(t("notifications_list.generic_failed"));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notification", notificationId] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  // Mark as read when screen loads
  useEffect(() => {
    if (notificationQ.data && !notificationQ.data.read) {
      markReadMutation.mutate();
    }
  }, [notificationQ.data?.read]);

  const getCategoryIcon = (
    category: string | null,
  ): keyof typeof Ionicons.glyphMap => {
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
  };

  const getCategoryColor = (category: string | null): string => {
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
      case "subscriptions":
        return "#FFD700";
      default:
        return tokens.mint;
    }
  };

  const getCategoryLabel = (category: string | null): string => {
    const key = `notification_detail.categories.${category}` as const;
    return t(key, {
      defaultValue: t("notification_detail.categories.default"),
    });
  };

  const handleAction = () => {
    if (notificationQ.data) {
      const n = notificationQ.data;
      handleNotificationTap(
        {
          data: n.data ?? undefined,
          category: n.category,
        },
        { push: (path) => router.push(path as any), back: () => router.back() },
      );
    }
  };

  const notification = notificationQ.data;
  const icon = notification
    ? getCategoryIcon(notification.category)
    : "notifications";
  const iconColor = notification
    ? getCategoryColor(notification.category)
    : tokens.mint;
  const categoryLabel = notification
    ? getCategoryLabel(notification.category)
    : "";

  if (notificationQ.isLoading) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={{ flex: 1, backgroundColor: tokens.paper }}
      >
        <View style={styles.centerContainer}>
          <Text style={{ color: tokens.inkMuted }}>
            {t("notification_detail.loading")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (notificationQ.error || !notification) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={{ flex: 1, backgroundColor: tokens.paper }}
      >
        <View
          style={[
            styles.header,
            { backgroundColor: tokens.card, borderBottomColor: tokens.border },
          ]}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.ink }]}>
            {t("notification_detail.title")}
          </Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={tokens.error}
          />
          <Text style={[styles.errorTitle, { color: tokens.ink }]}>
            {t("notification_detail.not_found")}
          </Text>
          <Text style={[styles.errorText, { color: tokens.inkMuted }]}>
            {t("notification_detail.not_found_message")}
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.errorButton, { backgroundColor: tokens.mint }]}
          >
            <Text style={[styles.errorButtonText, { color: tokens.mintText }]}>
              {t("notification_detail.go_back")}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const formattedDate = new Date(notification.created_at).toLocaleString(
    undefined,
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  // Check if there's actionable data
  const hasAction =
    notification.data &&
    (notification.data.type === "payment_success" ||
      notification.data.type === "subscription_success" ||
      notification.data.type === "task_alert" ||
      notification.data.type === "referral_bonus");

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: tokens.paper }}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: tokens.card, borderBottomColor: tokens.border },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={tokens.ink} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: tokens.ink }]}>
          {t("notification_detail.title")}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Content */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Icon and Category */}
        <View style={styles.iconContainer}>
          <View
            style={[
              styles.iconBadge,
              {
                backgroundColor: iconColor + "20",
                borderColor: iconColor + "40",
              },
            ]}
          >
            <Ionicons name={icon} size={32} color={iconColor} />
          </View>
          <Text style={[styles.categoryLabel, { color: iconColor }]}>
            {categoryLabel}
          </Text>
        </View>

        {/* Main Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <Text style={[styles.title, { color: tokens.ink }]}>
            {notification.title}
          </Text>

          <Text style={[styles.body, { color: tokens.inkMuted }]}>
            {notification.body}
          </Text>

          <View style={[styles.divider, { backgroundColor: tokens.border }]} />

          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={16} color={tokens.inkMuted} />
            <Text style={[styles.metaText, { color: tokens.inkMuted }]}>
              {formattedDate}
            </Text>
          </View>

          {!notification.read && (
            <View style={styles.metaRow}>
              <Ionicons
                name="checkmark-circle-outline"
                size={16}
                color={tokens.mint}
              />
              <Text style={[styles.metaText, { color: tokens.mint }]}>
                {t("notification_detail.marked_read")}
              </Text>
            </View>
          )}
        </View>

        {/* Additional Data */}
        {notification.data && Object.keys(notification.data).length > 0 && (
          <View
            style={[
              styles.dataCard,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <Text style={[styles.dataTitle, { color: tokens.ink }]}>
              {t("notification_detail.additional_info")}
            </Text>
            {Object.entries(notification.data).map(([key, value]) => (
              <View key={key} style={styles.dataRow}>
                <Text style={[styles.dataKey, { color: tokens.inkMuted }]}>
                  {key.replace(/_/g, " ")}:
                </Text>
                <Text
                  style={[styles.dataValue, { color: tokens.ink }]}
                  numberOfLines={3}
                >
                  {String(value)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Action Button */}
        {hasAction && (
          <TouchableOpacity
            onPress={handleAction}
            style={[styles.actionButton, { backgroundColor: tokens.mint }]}
          >
            <Text
              style={[
                styles.actionButtonText,
                { color: tokens.mintText, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {t("notification_detail.view_details")}
            </Text>
            <Ionicons name="arrow-forward" size={18} color={tokens.mintText} />
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "SpaceGrotesk_700Bold",
    flex: 1,
    textAlign: "center",
  },
  scrollContent: {
    padding: 20,
    gap: 20,
  },
  iconContainer: {
    alignItems: "center",
    gap: 12,
  },
  iconBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  categoryLabel: {
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
    lineHeight: 28,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaText: {
    fontSize: 13,
  },
  dataCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  dataTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  dataRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  dataKey: {
    fontSize: 13,
    fontWeight: "500",
    textTransform: "capitalize",
    minWidth: 100,
  },
  dataValue: {
    fontSize: 13,
    flex: 1,
    fontFamily: "monospace",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 14,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  errorButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
    marginTop: 8,
  },
  errorButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
