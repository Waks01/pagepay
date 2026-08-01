import { useQuery } from "@tanstack/react-query";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { apiFetch } from "@/src/shared/api/client";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PagePay } from "@/constants/theme";

type PaymentHistoryItem = {
  id: number;
  tier: string;
  tier_name: string;
  amount_kobo: number;
  amount_naira: number;
  provider: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
};

export default function PaymentHistoryScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();

  const historyQ = useQuery({
    queryKey: ["payments", "history"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/payments/history");
      if (!res.ok) throw new Error("Failed to load payment history");
      return res.json() as Promise<PaymentHistoryItem[]>;
    },
  });

  const renderItem = ({ item }: { item: PaymentHistoryItem }) => {
    const statusColor =
      item.status === "success"
        ? tokens.mint
        : item.status === "pending"
          ? tokens.inkMuted
          : tokens.error;

    const statusIcon =
      item.status === "success"
        ? "checkmark-circle"
        : item.status === "pending"
          ? "time-outline"
          : "close-circle";

    const date = new Date(item.created_at);
    const dateStr = date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const timeStr = date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <View
        style={[
          styles.item,
          { backgroundColor: tokens.card, borderColor: tokens.border },
        ]}
      >
        <View style={styles.itemHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.itemTitle, { color: tokens.ink }]}>
              {item.tier_name}
            </Text>
            <Text style={[styles.itemDate, { color: tokens.inkMuted }]}>
              {dateStr} • {timeStr}
            </Text>
          </View>
          <View style={styles.itemRight}>
            <Text style={[styles.itemAmount, { color: tokens.ink }]}>
              ₦{item.amount_naira.toLocaleString()}
            </Text>
            <View style={styles.statusRow}>
              <Ionicons name={statusIcon} size={14} color={statusColor} />
              <Text style={[styles.statusText, { color: statusColor }]}>
                {item.status}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View
      style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}
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
          {t("premium.view_payment_history")}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Content */}
      {historyQ.isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={tokens.mint} />
        </View>
      ) : historyQ.error ? (
        <View style={styles.centerContainer}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={tokens.error}
          />
          <Text style={[styles.errorTitle, { color: tokens.ink }]}>
            {t("premium.load_error")}
          </Text>
          <Text style={[styles.errorText, { color: tokens.inkMuted }]}>
            {historyQ.error instanceof Error
              ? historyQ.error.message
              : t("premium.connection_error")}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => historyQ.refetch()}
          >
            <Text style={[styles.retryText, { color: tokens.mint }]}>
              {t("premium.retry")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : !historyQ.data || historyQ.data.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="receipt-outline" size={64} color={tokens.inkMuted} />
          <Text style={[styles.emptyTitle, { color: tokens.ink }]}>
            No Payment History
          </Text>
          <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
            Your payment transactions will appear here
          </Text>
        </View>
      ) : (
        <FlatList
          data={historyQ.data}
          renderItem={renderItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
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
  },
  list: {
    padding: 16,
    gap: 12,
  },
  item: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  itemDate: {
    fontSize: 12,
  },
  itemRight: {
    alignItems: "flex-end",
  },
  itemAmount: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "500",
    textTransform: "capitalize",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 12,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: "600",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
});
