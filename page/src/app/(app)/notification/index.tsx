import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { apiFetch } from "@/src/shared/api/client";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import NotificationBell from "@/components/NotificationBell";
import { SkeletonPage } from "@/components/skeletons";
import { onNotification, offNotification } from "@/src/lib/socket";

type NotificationItem = {
  id: number;
  user_id: number;
  title: string;
  body: string;
  category: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
};

type NotificationsResponse = {
  notifications: NotificationItem[];
  unread_count: number;
};

export default function NotificationScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const router = useRouter();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const notificationsQ = useQuery({
    queryKey: ["notifications"],
    queryFn: async (): Promise<NotificationsResponse> => {
      const res = await apiFetch("/api/v1/notifications?limit=50");
      if (!res.ok) throw new Error(t("notifications_list.load_failed"));
      return res.json();
    },
  });

  useEffect(() => {
    const handler = (notification: any) => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    };
    onNotification(handler);
    return () => offNotification(handler);
  }, [qc]);

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      const res = await apiFetch(
        `/api/v1/notifications/${notificationId}/read`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(t("notifications_list.load_failed"));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/v1/notifications/read-all", {
        method: "POST",
      });
      if (!res.ok) throw new Error(t("notifications_list.load_failed"));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["notifications"] });
    setRefreshing(false);
  }, [qc]);

  const notifications = notificationsQ.data?.notifications ?? [];
  const unreadCount = notificationsQ.data?.unread_count ?? 0;

  const getCategoryIcon = (
    category: string | null,
  ): keyof typeof Ionicons.glyphMap => {
    switch (category) {
      case "study_reminders":
        return "school-outline";
      case "task_alerts":
        return "clipboard-outline";
      case "referral_bonuses":
        return "people-outline";
      case "wallet_updates":
        return "wallet-outline";
      case "ad_rewards":
        return "gift-outline";
      default:
        return "notifications-outline";
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
      default:
        return tokens.mint;
    }
  };

  const renderItem = ({ item }: { item: NotificationItem }) => {
    const icon = getCategoryIcon(item.category);
    const iconColor = getCategoryColor(item.category);
    const time = new Date(item.created_at).toLocaleString();

    return (
      <TouchableOpacity
        onPress={() => {
          router.push(`/notification/${item.id}`);
        }}
        activeOpacity={0.7}
        style={[
          styles.item,
          {
            backgroundColor: tokens.card,
            borderColor: tokens.border,
            opacity: item.read ? 0.7 : 1,
          },
        ]}
      >
        <View style={[styles.iconBadge, { backgroundColor: iconColor + "20" }]}>
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
        <View style={styles.itemBody}>
          <View style={styles.itemHeader}>
            <Text
              style={[styles.itemTitle, { color: tokens.ink }]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {!item.read && (
              <View
                style={[styles.unreadDot, { backgroundColor: tokens.mint }]}
              />
            )}
          </View>
          <Text
            style={[styles.itemBody, { color: tokens.inkMuted }]}
            numberOfLines={2}
          >
            {item.body}
          </Text>
          <Text style={[styles.itemTime, { color: tokens.inkMuted }]}>
            {time}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const ListEmpty = () => (
    <View style={styles.empty}>
      <Ionicons
        name="notifications-off-outline"
        size={48}
        color={tokens.inkMuted}
      />
      <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
        {t("notifications_list.empty_title", { defaultValue: "No notifications yet" })}
      </Text>
      <Text style={[styles.emptySub, { color: tokens.inkMuted }]}>
        {t("notifications_list.empty_subtitle", { defaultValue: "We'll notify you when something important happens" })}
      </Text>
    </View>
  );

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
        <View style={styles.headerRow}>
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.headerIcon}
          />
          <View style={styles.headerTitleArea}>
            <Text
              style={[
                styles.headerTitle,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {t("notifications_list.title", { defaultValue: "Notifications" })}
            </Text>
            <Text style={[styles.headerSubtitle, { color: tokens.inkMuted }]}>
              {unreadCount > 0
                ? t("notifications_list.unread_count", { count: unreadCount })
                : t("notifications_list.all_caught_up", { defaultValue: "All caught up" })}
            </Text>
          </View>
          <NotificationBell />
        </View>
      </View>

      {unreadCount > 0 && (
        <View style={[styles.markAllRow, { borderBottomColor: tokens.border }]}>
          <TouchableOpacity
            onPress={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            style={[
              styles.markAllBtn,
              { opacity: markAllReadMutation.isPending ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.markAllText, { color: tokens.mint }]}>
              {t("notifications_list.mark_all_read", { defaultValue: "Mark all read" })}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={notifications}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={
          notifications.length === 0 ? styles.emptyList : styles.list
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.mint}
          />
        }
        ListEmptyComponent={
          notificationsQ.isLoading ? (
            <SkeletonPage count={4} header={false} />
          ) : (
            ListEmpty
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  headerTitleArea: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
  },
  markAllRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-end",
  },
  markAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  markAllText: {
    fontSize: 12,
    fontWeight: "600",
  },
  list: {
    padding: 12,
    gap: 10,
  },
  emptyList: {
    flex: 1,
  },
  item: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  itemBody: {
    flex: 1,
    gap: 4,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  itemTime: {
    fontSize: 11,
    marginTop: 2,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
  },
  emptySub: {
    fontSize: 14,
    textAlign: "center",
  },
});
