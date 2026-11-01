import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import type { TransactionHistoryItem } from "@/src/shared/types/transaction";
import { formatDateTime } from "@/src/shared/utils/dateFormatter";

interface SubscriptionDetailProps {
  transaction: TransactionHistoryItem;
  tokens: any;
}

export function SubscriptionDetail({
  transaction,
  tokens,
}: SubscriptionDetailProps) {
  const metadata = (transaction.metadata || {}) as Record<string, any>;
  const isWalletDeposit = transaction.subtype === "wallet_deposit";
  const isPremiumMonthly = transaction.subtype === "premium_monthly";
  const isPremiumYearly = transaction.subtype === "premium_yearly";

  const copyToClipboard = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied!", `${label} copied to clipboard`);
  };

  const getTierDisplayName = () => {
    if (isWalletDeposit) return "Wallet Deposit";
    if (isPremiumMonthly) return "Premium Monthly";
    if (isPremiumYearly) return "Premium Yearly";
    return transaction.subtype || "Payment";
  };

  const getProviderDisplayName = () => {
    if (metadata.provider === "paystack") return "Paystack";
    if (metadata.provider === "flutterwave") return "Flutterwave";
    return metadata.provider || "Payment Provider";
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: tokens.paper }]}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Payment Type Section */}
      <View style={[styles.section, { backgroundColor: tokens.card }]}>
        <Text style={[styles.sectionTitle, { color: tokens.inkMuted }]}>
          PAYMENT DETAILS
        </Text>

        <DetailRow
          icon={isWalletDeposit ? "wallet-outline" : "star-outline"}
          label="Payment Type"
          value={getTierDisplayName()}
          tokens={tokens}
          valueStyle={{ fontWeight: "600" }}
        />

        <DetailRow
          icon="cash-outline"
          label="Amount"
          value={`₦${(transaction.amount / 100).toLocaleString("en-NG", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
          tokens={tokens}
          valueStyle={{ color: tokens.mint, fontWeight: "600" }}
        />

        <DetailRow
          icon="card-outline"
          label="Payment Provider"
          value={getProviderDisplayName()}
          tokens={tokens}
        />

        {transaction.reference && (
          <DetailRow
            icon="document-text-outline"
            label="Reference"
            value={transaction.reference}
            tokens={tokens}
            onPress={() =>
              copyToClipboard(transaction.reference!, "Reference")
            }
          />
        )}

        <DetailRow
          icon="information-circle-outline"
          label="Status"
          value={
            transaction.status.charAt(0).toUpperCase() +
            transaction.status.slice(1)
          }
          tokens={tokens}
          valueStyle={{
            color:
              transaction.status === "success"
                ? tokens.mint
                : transaction.status === "failed"
                  ? tokens.error
                  : tokens.warning,
            fontWeight: "600",
          }}
        />

        {metadata.webhook_confirmed !== undefined && (
          <DetailRow
            icon={
              metadata.webhook_confirmed
                ? "checkmark-circle-outline"
                : "alert-circle-outline"
            }
            label="Webhook Confirmed"
            value={metadata.webhook_confirmed ? "Yes" : "No"}
            tokens={tokens}
            valueStyle={{
              color: metadata.webhook_confirmed ? tokens.mint : tokens.warning,
            }}
          />
        )}
      </View>

      {/* Transaction Timeline */}
      <View style={[styles.section, { backgroundColor: tokens.card }]}>
        <Text style={[styles.sectionTitle, { color: tokens.inkMuted }]}>
          TRANSACTION TIMELINE
        </Text>

        <DetailRow
          icon="calendar-outline"
          label="Initiated At"
          value={formatDateTime(transaction.timestamp)}
          tokens={tokens}
        />

        {metadata.confirmed_at && (
          <DetailRow
            icon="checkmark-done-outline"
            label="Confirmed At"
            value={formatDateTime(metadata.confirmed_at)}
            tokens={tokens}
          />
        )}
      </View>

      {/* Additional Metadata */}
      {metadata.payment_metadata && (
        <View style={[styles.section, { backgroundColor: tokens.card }]}>
          <Text style={[styles.sectionTitle, { color: tokens.inkMuted }]}>
            ADDITIONAL INFORMATION
          </Text>

          {metadata.payment_metadata.channel && (
            <DetailRow
              icon="swap-horizontal-outline"
              label="Payment Channel"
              value={
                metadata.payment_metadata.channel.charAt(0).toUpperCase() +
                metadata.payment_metadata.channel.slice(1)
              }
              tokens={tokens}
            />
          )}

          {metadata.payment_metadata.card_type && (
            <DetailRow
              icon="card-outline"
              label="Card Type"
              value={metadata.payment_metadata.card_type.toUpperCase()}
              tokens={tokens}
            />
          )}

          {metadata.payment_metadata.bank && (
            <DetailRow
              icon="business-outline"
              label="Bank"
              value={metadata.payment_metadata.bank}
              tokens={tokens}
            />
          )}

          {metadata.payment_metadata.last4 && (
            <DetailRow
              icon="card-outline"
              label="Card Last 4"
              value={`**** ${metadata.payment_metadata.last4}`}
              tokens={tokens}
            />
          )}

          {metadata.payment_metadata.authorization_code && (
            <DetailRow
              icon="key-outline"
              label="Authorization Code"
              value={metadata.payment_metadata.authorization_code}
              tokens={tokens}
              onPress={() =>
                copyToClipboard(
                  metadata.payment_metadata.authorization_code,
                  "Authorization Code",
                )
              }
            />
          )}
        </View>
      )}

      {/* Help Section */}
      <View style={[styles.helpSection, { backgroundColor: tokens.card }]}>
        <Ionicons
          name="information-circle-outline"
          size={20}
          color={tokens.inkMuted}
        />
        <Text style={[styles.helpText, { color: tokens.inkMuted }]}>
          {isWalletDeposit
            ? "This deposit has been added to your cashable wallet balance."
            : "Your premium subscription gives you access to exclusive features and benefits."}
        </Text>
      </View>
    </ScrollView>
  );
}

interface DetailRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tokens: any;
  onPress?: () => void;
  valueStyle?: any;
}

function DetailRow({
  icon,
  label,
  value,
  tokens,
  onPress,
  valueStyle,
}: DetailRowProps) {
  const content = (
    <View style={styles.detailRow}>
      <View style={styles.detailLeft}>
        <Ionicons name={icon} size={20} color={tokens.inkMuted} />
        <Text style={[styles.detailLabel, { color: tokens.inkMuted }]}>
          {label}
        </Text>
      </View>
      <View style={styles.detailRight}>
        <Text style={[styles.detailValue, { color: tokens.ink }, valueStyle]}>
          {value}
        </Text>
        {onPress && (
          <Ionicons name="copy-outline" size={16} color={tokens.mint} />
        )}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    gap: 16,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  detailLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  detailRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
  },
  helpSection: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    borderRadius: 12,
  },
  helpText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
