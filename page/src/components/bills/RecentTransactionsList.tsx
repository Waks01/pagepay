/**
 * RecentTransactionsList - Reusable component for showing recent purchases
 * Allows quick retry of previous transactions
 */

import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { PagePay } from "@/constants/theme";
import { formatDateTime } from "@/src/shared/utils/dateFormatter";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type Transaction = {
  id: number;
  service: string;
  phone?: string;
  network?: string;
  amount_naira: number;
  points_earned: number;
  created_at: string;
  status: string;
};

type Props = {
  transactions: Transaction[];
  onRetry: (tx: Transaction) => void;
  onDispute?: (tx: Transaction) => void;
};

export function RecentTransactionsList({
  transactions,
  onRetry,
  onDispute,
}: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  if (transactions.length === 0) return null;

  const formatTimeAgo = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDateTime(iso, { includeTime: false });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: tokens.ink }]}>
          Recent Transactions
        </Text>
      </View>

      <View style={styles.list}>
        {transactions.map((tx) => (
          <View
            key={tx.id}
            style={[
              styles.txCard,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <View style={styles.txLeft}>
              <View
                style={[styles.txIcon, { backgroundColor: tokens.mintSoft }]}
              >
                <Ionicons
                  name={getServiceIcon(tx.service)}
                  size={18}
                  color={tokens.mint}
                />
              </View>

              <View style={styles.txInfo}>
                <Text style={[styles.txService, { color: tokens.ink }]}>
                  {tx.service.toUpperCase().replace("_", " ")}
                </Text>
                <Text
                  style={[styles.txDetails, { color: tokens.inkMuted }]}
                  numberOfLines={1}
                >
                  {tx.phone || "Unknown"} · {getRelativeTime(tx.created_at)}
                </Text>
              </View>
            </View>

            <View style={styles.txRight}>
              <Text style={[styles.txAmount, { color: tokens.ink }]}>
                ₦{tx.amount_naira.toLocaleString()}
              </Text>

              <View style={styles.txActions}>
                <TouchableOpacity
                  onPress={() => onRetry(tx)}
                  style={styles.actionBtn}
                >
                  <Ionicons name="repeat" size={14} color={tokens.mint} />
                  <Text style={[styles.actionText, { color: tokens.mint }]}>
                    Retry
                  </Text>
                </TouchableOpacity>

                {onDispute && tx.status === "success" && (
                  <TouchableOpacity
                    onPress={() => onDispute(tx)}
                    style={styles.actionBtn}
                  >
                    <Ionicons
                      name="warning-outline"
                      size={14}
                      color={tokens.signal}
                    />
                    <Text style={[styles.actionText, { color: tokens.signal }]}>
                      Issue?
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function getServiceIcon(service: string): any {
  const icons: Record<string, any> = {
    airtime: "phone-portrait-outline",
    data: "wifi-outline",
    electricity: "flash-outline",
    tv: "tv-outline",
    recharge_pin: "card-outline",
    betting: "logo-bitcoin",
    isp: "globe-outline",
    education: "school-outline",
    sms: "chatbubbles-outline",
  };
  return icons[service] || "receipt-outline";
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  viewAll: {
    fontSize: 13,
    fontWeight: "600",
  },
  list: {
    gap: 8,
  },
  txCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  txLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  txInfo: {
    flex: 1,
  },
  txService: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 2,
  },
  txDetails: {
    fontSize: 11,
  },
  txRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  txAmount: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  txActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  actionText: {
    fontSize: 11,
    fontWeight: "500",
  },
});
