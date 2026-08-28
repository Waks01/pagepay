import { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import { apiFetch } from "@/src/shared/api/client";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { useCurrentUser, useCurrentUserStore } from "@/src/shared/lib/current-user";
import { PagePay } from "@/constants/theme";
import { StateBlock } from "@/components/StateBlock";
import { PageHeader } from "@/components/PageHeader";

type TransactionHistoryItem = {
  id: number;
  type: "bill" | "payment" | "payout" | "daily_reward" | "study" | "ad" | "bonus" | "streak_freeze" | "audio_unlock";
  subtype: string | null;
  status: string;
  amount: number;
  unit: "NGN" | "SP" | "USD";
  description: string;
  reference: string | null;
  timestamp: string;
  ledger: string | null;
  metadata: Record<string, unknown> | null;
};

export default function TransactionHistoryScreen() {
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { t } = useTranslation();
  const qc = useQueryClient();
  const user = useCurrentUser();

  const historyQuery = useQuery({
    queryKey: ["transactions", "history"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/transactions/history?limit=50");
      if (!res.ok) throw new Error("Failed to load transaction history");
      const data = await res.json();
      return data as {
        items: TransactionHistoryItem[];
        total: number;
        page: number;
        limit: number;
      };
    },
    staleTime: 60 * 1000,
  });

  useFocusEffect(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: ["transactions", "history"] });
    }, [qc])
  );

  const onRefresh = useCallback(async () => {
    await Promise.all([
      useCurrentUserStore.getState().refresh(),
      historyQuery.refetch(),
    ]);
  }, [historyQuery]);

  const items = historyQuery.data?.items ?? [];

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "bill":
        return "receipt-outline";
      case "payment":
        return "wallet-outline";
      case "payout":
        return "arrow-up-circle-outline";
      case "daily_reward":
        return "gift-outline";
      case "study":
        return "book-outline";
      case "ad":
        return "play-circle-outline";
      case "bonus":
        return "star-outline";
      case "streak_freeze":
        return "snow-outline";
      case "audio_unlock":
        return "headset-outline";
      default:
        return "ellipse-outline";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "bill":
        return tokens.signal;
      case "payment":
        return tokens.mint;
      case "payout":
        return tokens.inkMuted;
      case "daily_reward":
        return "#FFD700";
      case "study":
        return tokens.accent;
      case "ad":
        return "#8B5CF6";
      case "bonus":
        return "#F59E0B";
      case "streak_freeze":
        return "#06B6D4";
      case "audio_unlock":
        return "#EC4899";
      default:
        return tokens.inkMuted;
    }
  };

  const formatAmount = (item: TransactionHistoryItem) => {
    const prefix = item.amount > 0 ? "+" : "";
    const suffix = item.unit === "NGN" ? (item.type === "payout" || item.type === "bill" ? `₦${Math.abs(item.amount)}` : `${prefix}₦${item.amount}`) : `${prefix}${item.amount} ${item.unit}`;
    return suffix;
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.paper }]}>
      <PageHeader
        title={t("transactions.title", { defaultValue: "Transaction History" })}
        showBack
        tokens={tokens}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={historyQuery.isFetching}
            onRefresh={onRefresh}
            tintColor={tokens.mint}
          />
        }
      >
        {historyQuery.isLoading ? (
          <View style={{ gap: 12 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <View key={i} style={{ height: 72, borderRadius: 12, backgroundColor: tokens.card }} />
            ))}
          </View>
        ) : historyQuery.isError ? (
          <StateBlock
            message={t("transactions.load_error", { defaultValue: "Failed to load transaction history" })}
            onRetry={() => historyQuery.refetch()}
            tokens={tokens}
          />
        ) : items.length === 0 ? (
          <StateBlock
            message={t("transactions.empty", { defaultValue: "No transactions yet" })}
            tokens={tokens}
            variant="empty"
          />
        ) : (
          <View style={{ gap: 8 }}>
            {items.map((item) => (
              <TouchableOpacity
                key={`${item.type}-${item.id}`}
                style={[
                  styles.row,
                  { backgroundColor: tokens.card, borderColor: tokens.border },
                ]}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: `${getTypeColor(item.type)}20` },
                  ]}
                >
                  <Ionicons
                    name={getTypeIcon(item.type) as any}
                    size={20}
                    color={getTypeColor(item.type)}
                  />
                </View>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text
                    style={[styles.description, { color: tokens.ink }]}
                    numberOfLines={1}
                  >
                    {item.description}
                  </Text>
                  <Text style={[styles.meta, { color: tokens.inkMuted }]}>
                    {item.type === "bill" && item.subtype
                      ? item.subtype.toUpperCase()
                      : item.subtype || item.type}
                    {item.reference ? ` • ${item.reference.slice(0, 12)}...` : ""}
                  </Text>
                  <Text style={[styles.date, { color: tokens.inkMuted }]}>
                    {new Date(item.timestamp).toLocaleString()}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text
                    style={[
                      styles.amount,
                      {
                        color:
                          item.type === "bill" || item.type === "payout" || item.type === "study" || item.type === "audio_unlock" || item.type === "streak_freeze"
                            ? tokens.signal
                            : tokens.mint,
                      },
                    ]}
                  >
                    {item.type === "bill" || item.type === "payout" || item.type === "study" || item.type === "audio_unlock" || item.type === "streak_freeze"
                      ? formatAmount(item)
                      : formatAmount(item)}
                  </Text>
                  <Text style={[styles.unit, { color: tokens.inkMuted }]}>
                    {item.unit}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    padding: 16,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  description: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  meta: {
    fontSize: 12,
    marginBottom: 2,
  },
  date: {
    fontSize: 11,
  },
  amount: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  unit: {
    fontSize: 10,
    marginTop: 2,
  },
});
