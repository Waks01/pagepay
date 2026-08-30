import { View, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";

import { apiFetch } from "@/src/shared/api/client";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PagePay } from "@/constants/theme";
import { StateBlock } from "@/components/StateBlock";
import { PageHeader } from "@/components/PageHeader";
import { TransactionDetailHeader } from "@/components/transactions/TransactionDetailHeader";
import { AirtimeDetail } from "@/components/transactions/details/AirtimeDetail";
import { DataDetail } from "@/components/transactions/details/DataDetail";
import { ElectricityDetail } from "@/components/transactions/details/ElectricityDetail";
import { DailyRewardDetail } from "@/components/transactions/details/DailyRewardDetail";
import { ReadingRewardDetail } from "@/components/transactions/details/ReadingRewardDetail";
import { ReceiptActions } from "@/components/transactions/ReceiptActions";
import { Skeleton } from "@/components/Skeleton";
import type { TransactionHistoryItem } from "@/src/shared/types/transaction";

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const {
    data: transaction,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["transaction", id],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/transactions/history?limit=100`);
      if (!response.ok) {
        throw new Error("Failed to load transaction");
      }
      const data = await response.json();
      const item = data.items.find(
        (t: TransactionHistoryItem) => t.id === parseInt(id),
      );
      if (!item) {
        throw new Error("Transaction not found");
      }
      return item as TransactionHistoryItem;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.paper }]}>
        <PageHeader title="Transaction Details" tokens={tokens} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Header skeleton */}
          <View
            style={[
              styles.headerSkeleton,
              {
                backgroundColor: tokens.card,
                borderBottomColor: tokens.border,
              },
            ]}
          >
            <Skeleton
              width={56}
              height={56}
              borderRadius={28}
              marginBottom={12}
            />
            <Skeleton width={120} height={28} marginBottom={8} />
            <Skeleton width={100} height={20} marginBottom={4} />
            <Skeleton width={80} height={16} />
          </View>

          {/* Details skeleton */}
          <View style={styles.detailsSkeleton}>
            <Skeleton width="100%" height={20} marginBottom={16} />
            <View style={{ gap: 12 }}>
              <Skeleton width="100%" height={60} borderRadius={12} />
              <Skeleton width="100%" height={60} borderRadius={12} />
              <Skeleton width="100%" height={60} borderRadius={12} />
              <Skeleton width="100%" height={60} borderRadius={12} />
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (error || !transaction) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.paper }]}>
        <PageHeader title="Transaction Details" tokens={tokens} />
        <StateBlock
          icon="alert-circle-outline"
          message="Transaction not found"
          onRetry={() => router.back()}
          tokens={tokens}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.paper }]}>
      <PageHeader title="Transaction Details" tokens={tokens} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <TransactionDetailHeader transaction={transaction} tokens={tokens} />

        {renderTransactionDetail(transaction, tokens)}

        {/* Receipt Actions */}
        {transaction.type === "bill" && transaction.status === "success" && (
          <View style={styles.receiptActions}>
            <ReceiptActions transactionId={transaction.id} tokens={tokens} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function renderTransactionDetail(
  transaction: TransactionHistoryItem,
  tokens: any,
) {
  if (transaction.type === "bill") {
    switch (transaction.subtype) {
      case "airtime":
        return <AirtimeDetail transaction={transaction} tokens={tokens} />;
      case "data":
        return <DataDetail transaction={transaction} tokens={tokens} />;
      case "electricity":
        return <ElectricityDetail transaction={transaction} tokens={tokens} />;
      case "tv":
      case "recharge_pin":
      case "betting":
      case "isp":
      case "education":
      case "sms":
        return <AirtimeDetail transaction={transaction} tokens={tokens} />;
      default:
        return <AirtimeDetail transaction={transaction} tokens={tokens} />;
    }
  }

  if (transaction.type === "daily_reward") {
    return <DailyRewardDetail transaction={transaction} tokens={tokens} />;
  }

  if (transaction.type === "reading_reward") {
    return <ReadingRewardDetail transaction={transaction} tokens={tokens} />;
  }

  return <AirtimeDetail transaction={transaction} tokens={tokens} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: {
    paddingBottom: 24,
  },
  receiptActions: {
    marginTop: 16,
  },
  headerSkeleton: {
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  detailsSkeleton: {
    padding: 16,
  },
});
