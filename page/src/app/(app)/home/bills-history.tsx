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
import { PageHeader } from "@/components/PageHeader";

type BillTransactionItem = {
  id: number;
  service: string;
  provider: string;
  phone: string | null;
  meter_number: string | null;
  smartcard_number: string | null;
  amount_naira: number;
  commission_naira: number;
  points_earned: number;
  reference: string;
  status: string;
  external_ref: string | null;
  error_message: string | null;
  created_at: string;
};

const SERVICE_ICONS: Record<string, string> = {
  airtime: "call-outline",
  data: "wifi-outline",
  electricity: "flash-outline",
  tv: "tv-outline",
  recharge_pin: "card-outline",
  betting: "logo-bitbucket",
  isp: "globe-outline",
  education: "school-outline",
  sms: "chatbubbles-outline",
};

const SERVICE_COLORS: Record<string, string> = {
  airtime: "#0E7C66",
  data: "#2563EB",
  electricity: "#F59E0B",
  tv: "#7C3AED",
  recharge_pin: "#059669",
  betting: "#DC2626",
  isp: "#0891B2",
  education: "#4F46E5",
  sms: "#DB2777",
};

export default function BillsHistoryScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();

  const historyQ = useQuery({
    queryKey: ["bills", "history"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/bills/history");
      if (!res.ok) throw new Error(t("bills.history.load_failed"));
      return res.json() as Promise<{ items: BillTransactionItem[]; total: number; page: number; limit: number }>;
    },
  });

  const renderItem = ({ item }: { item: BillTransactionItem }) => {
    const icon = SERVICE_ICONS[item.service] || "receipt-outline";
    const color = SERVICE_COLORS[item.service] || tokens.inkMuted;
    const statusColor =
      item.status === "success"
        ? tokens.mint
        : item.status === "pending"
          ? tokens.inkMuted
          : tokens.error;

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

    const serviceLabel = item.service
      .replace("_", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    return (
      <View
        style={[
          styles.item,
          { backgroundColor: tokens.card, borderColor: tokens.border },
        ]}
      >
        <View style={styles.itemLeft}>
          <View style={[styles.iconCircle, { backgroundColor: color + "20" }]}>
            <Ionicons name={icon as any} size={20} color={color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.itemTitle, { color: tokens.ink }]}>
              {serviceLabel}
            </Text>
            <Text style={[styles.itemDate, { color: tokens.inkMuted }]}>
              {dateStr} • {timeStr}
            </Text>
            {item.phone && (
              <Text style={[styles.itemDetail, { color: tokens.inkMuted }]}>
                {item.phone}
              </Text>
            )}
            {item.meter_number && (
              <Text style={[styles.itemDetail, { color: tokens.inkMuted }]}>
                Meter: {item.meter_number}
              </Text>
            )}
            {item.smartcard_number && (
              <Text style={[styles.itemDetail, { color: tokens.inkMuted }]}>
                Smartcard: {item.smartcard_number}
              </Text>
            )}
            {item.error_message && (
              <Text style={[styles.itemError, { color: tokens.error }]}>
                {item.error_message}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.itemRight}>
          <Text style={[styles.itemAmount, { color: tokens.ink }]}>
            ₦{item.amount_naira.toLocaleString()}
          </Text>
          {item.points_earned > 0 && (
            <Text style={[styles.itemPoints, { color: tokens.mint }]}>
              +{item.points_earned} pts
            </Text>
          )}
          <View style={styles.statusRow}>
            <Ionicons
              name={
                item.status === "success"
                  ? "checkmark-circle"
                  : item.status === "pending"
                    ? "time-outline"
                    : "close-circle"
              }
              size={14}
              color={statusColor}
            />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {item.status}
            </Text>
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
      <PageHeader
        title={t("bills.history.title")}
        showBack
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        tokens={tokens}
      />

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
            {t("bills.history.load_error")}
          </Text>
          <Text style={[styles.errorText, { color: tokens.inkMuted }]}>
            {historyQ.error instanceof Error
              ? historyQ.error.message
              : t("common.connection_error")}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => historyQ.refetch()}
          >
            <Text style={[styles.retryText, { color: tokens.mint }]}>
              {t("common.retry")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : !historyQ.data || historyQ.data.items.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="receipt-outline" size={64} color={tokens.inkMuted} />
          <Text style={[styles.emptyTitle, { color: tokens.ink }]}>
            {t("bills.history.empty_title")}
          </Text>
          <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
            {t("bills.history.empty_text")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={historyQ.data.items}
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
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  itemLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    flex: 1,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  itemDate: {
    fontSize: 12,
    marginBottom: 2,
  },
  itemDetail: {
    fontSize: 12,
    marginBottom: 2,
  },
  itemError: {
    fontSize: 12,
    marginTop: 4,
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
  itemPoints: {
    fontSize: 13,
    fontWeight: "600",
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
