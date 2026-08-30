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

interface ElectricityDetailProps {
  transaction: TransactionHistoryItem;
  tokens: any;
}

export function ElectricityDetail({ transaction, tokens }: ElectricityDetailProps) {
  const metadata = (transaction.metadata || {}) as Record<string, any>;

  const copyToClipboard = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied!", `${label} copied to clipboard`);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-NG", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (
    amount: number | undefined,
    isKobo: boolean = false,
  ) => {
    if (!amount && amount !== 0) return "N/A";
    const actualAmount = isKobo ? amount / 100 : amount;
    return `₦${actualAmount.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: tokens.paper }]}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={[styles.section, { backgroundColor: tokens.card }]}>
        <Text style={[styles.sectionTitle, { color: tokens.inkMuted }]}>
          ELECTRICITY PURCHASE DETAILS
        </Text>

        {metadata.disco_name && (
          <DetailRow
            icon="flash-outline"
            label="Disco"
            value={metadata.disco_name}
            tokens={tokens}
          />
        )}

        {metadata.customer_name && (
          <DetailRow
            icon="person-outline"
            label="Customer Name"
            value={metadata.customer_name}
            tokens={tokens}
          />
        )}

        {metadata.meter_number && (
          <DetailRow
            icon="speedometer-outline"
            label="Meter Number"
            value={metadata.meter_number}
            tokens={tokens}
            onPress={() => copyToClipboard(metadata.meter_number, "Meter number")}
          />
        )}

        {metadata.meter_type && (
          <DetailRow
            icon="options-outline"
            label="Meter Type"
            value={metadata.meter_type.charAt(0).toUpperCase() + metadata.meter_type.slice(1)}
            tokens={tokens}
          />
        )}

        {metadata.token && (
          <DetailRow
            icon="key-outline"
            label="Token"
            value={metadata.token}
            tokens={tokens}
            onPress={() => copyToClipboard(metadata.token, "Token")}
            valueStyle={{ fontFamily: "monospace", fontSize: 14 }}
          />
        )}

        {metadata.units && (
          <DetailRow
            icon="battery-charging-outline"
            label="Units"
            value={metadata.units}
            tokens={tokens}
          />
        )}

        {metadata.phone && (
          <DetailRow
            icon="call-outline"
            label="Phone Number"
            value={metadata.phone}
            tokens={tokens}
            onPress={() => copyToClipboard(metadata.phone, "Phone number")}
          />
        )}

        <DetailRow
          icon="cash-outline"
          label="Amount Paid"
          value={formatCurrency(metadata.amount_naira, false)}
          tokens={tokens}
        />

        {metadata.commission_naira !== undefined && (
          <DetailRow
            icon="trending-up-outline"
            label="Commission"
            value={formatCurrency(metadata.commission_naira, true)}
            tokens={tokens}
          />
        )}

        {metadata.discount && (
          <DetailRow
            icon="pricetag-outline"
            label="Discount"
            value={`${metadata.discount}%`}
            tokens={tokens}
          />
        )}

        {metadata.points_earned !== undefined && (
          <DetailRow
            icon="star-outline"
            label="Points Earned"
            value={`${(metadata.points_earned || 0).toLocaleString()} SP`}
            tokens={tokens}
            valueStyle={{ color: tokens.mint, fontWeight: "600" }}
          />
        )}
      </View>

      <View style={[styles.section, { backgroundColor: tokens.card }]}>
        <Text style={[styles.sectionTitle, { color: tokens.inkMuted }]}>
          TRANSACTION INFORMATION
        </Text>

        {transaction.reference && (
          <DetailRow
            icon="document-text-outline"
            label="Reference"
            value={transaction.reference}
            tokens={tokens}
            onPress={() => copyToClipboard(transaction.reference!, "Reference")}
          />
        )}

        <DetailRow
          icon="calendar-outline"
          label="Date & Time"
          value={formatDate(transaction.timestamp)}
          tokens={tokens}
        />

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
              transaction.status === "success" ? tokens.mint : tokens.error,
            fontWeight: "600",
          }}
        />

        {metadata.external_ref && (
          <DetailRow
            icon="pricetag-outline"
            label="Provider Reference"
            value={metadata.external_ref}
            tokens={tokens}
            onPress={() =>
              copyToClipboard(metadata.external_ref, "Provider reference")
            }
          />
        )}

        {metadata.error_message && (
          <DetailRow
            icon="alert-circle-outline"
            label="Error"
            value={metadata.error_message}
            tokens={tokens}
            valueStyle={{ color: tokens.error }}
          />
        )}
      </View>

      {transaction.reference && (
        <View
          style={[
            styles.helpSection,
            { backgroundColor: tokens.inkMuted + "15" },
          ]}
        >
          <Ionicons
            name="help-circle-outline"
            size={20}
            color={tokens.inkMuted}
          />
          <Text style={[styles.helpText, { color: tokens.inkMuted }]}>
            Need help with this transaction? Contact support with reference:{" "}
            {transaction.reference}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

interface DetailRowProps {
  icon: string;
  label: string;
  value: string;
  tokens: any;
  valueStyle?: any;
  onPress?: () => void;
}

function DetailRow({
  icon,
  label,
  value,
  tokens,
  valueStyle,
  onPress,
}: DetailRowProps) {
  return (
    <TouchableOpacity
      style={[styles.detailRow, { borderBottomColor: tokens.border }]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={styles.detailRowLeft}>
        <Ionicons name={icon as any} size={20} color={tokens.inkMuted} />
        <Text style={[styles.detailLabel, { color: tokens.ink }]}>{label}</Text>
      </View>
      <View style={styles.detailRowRight}>
        <Text style={[styles.detailValue, { color: tokens.ink }, valueStyle]}>
          {value}
        </Text>
        {onPress && (
          <Ionicons
            name="copy-outline"
            size={16}
            color={tokens.inkMuted}
            style={{ marginLeft: 8 }}
          />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 24,
  },
  section: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 12,
    marginTop: 8,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  detailRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  detailLabel: {
    fontSize: 15,
    marginLeft: 12,
  },
  detailRowRight: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    justifyContent: "flex-end",
  },
  detailValue: {
    fontSize: 15,
    fontWeight: "500",
    textAlign: "right",
  },
  helpSection: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    margin: 16,
    borderRadius: 12,
  },
  helpText: {
    fontSize: 13,
    marginLeft: 12,
    flex: 1,
    lineHeight: 18,
  },
});
