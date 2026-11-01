import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TransactionHistoryItem } from "@/src/shared/types/transaction";

interface TransactionDetailHeaderProps {
  transaction: TransactionHistoryItem;
  tokens: any;
}

export function TransactionDetailHeader({
  transaction,
  tokens,
}: TransactionDetailHeaderProps) {
  const isDebit = transaction.amount < 0;
  const statusColor = getStatusColor(transaction.status, tokens);
  const statusIcon = getStatusIcon(transaction.status);

  const formatAmount = () => {
    const absAmount = Math.abs(transaction.amount);

    if (transaction.unit === "NGN") {
      // amount is already in naira for bills, no division needed
      return `₦${absAmount.toLocaleString("en-NG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }

    if (transaction.unit === "SP") {
      return `${absAmount.toLocaleString()} SP`;
    }

    return `$${(absAmount / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  return (
    <View
      style={[
        styles.header,
        { backgroundColor: tokens.card, borderBottomColor: tokens.border },
      ]}
    >
      <View
        style={[styles.iconContainer, { backgroundColor: statusColor + "20" }]}
      >
        <Ionicons name={statusIcon as any} size={48} color={statusColor} />
      </View>

      <Text style={[styles.title, { color: tokens.ink }]}>
        {transaction.description}
      </Text>

      <Text
        style={[styles.amount, { color: isDebit ? tokens.error : tokens.mint }]}
      >
        {isDebit ? "-" : "+"}
        {formatAmount()}
      </Text>

      <View
        style={[styles.statusBadge, { backgroundColor: statusColor + "20" }]}
      >
        <Text style={[styles.statusText, { color: statusColor }]}>
          {transaction.status.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

function getStatusColor(status: string, tokens: any): string {
  switch (status) {
    case "success":
      return tokens.mint || "#0E7C66";
    case "failed":
      return tokens.error || "#DC2626";
    case "pending":
      return tokens.inkMuted || "#6B7280";
    default:
      return tokens.inkMuted || "#6B7280";
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case "success":
      return "checkmark-circle";
    case "failed":
      return "close-circle";
    case "pending":
      return "time-outline";
    default:
      return "help-circle-outline";
  }
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "SpaceGrotesk_700Bold",
    marginBottom: 6,
    textAlign: "center",
  },
  amount: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
    marginBottom: 8,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
});
