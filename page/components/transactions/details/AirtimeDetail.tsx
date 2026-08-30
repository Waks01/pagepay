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

interface AirtimeDetailProps {
  transaction: TransactionHistoryItem;
  tokens: any;
}

const NETWORK_MAP: Record<string, string> = {
  "1": "MTN",
  "2": "Glo",
  "3": "Airtel",
  "4": "9mobile",
};

export function AirtimeDetail({ transaction, tokens }: AirtimeDetailProps) {
  const metadata = (transaction.metadata || {}) as Record<string, any>;

  // Detect network from phone number prefix
  const getNetworkFromPhone = (phone: string): string => {
    if (!phone) return "Unknown Network";
    const prefix = phone.substring(0, 4);

    // MTN prefixes
    if (
      [
        "0803",
        "0806",
        "0703",
        "0706",
        "0813",
        "0816",
        "0810",
        "0814",
        "0903",
        "0906",
        "0913",
        "0916",
      ].includes(prefix)
    ) {
      return "MTN";
    }
    // Glo prefixes
    if (
      ["0805", "0807", "0705", "0815", "0811", "0905", "0915"].includes(prefix)
    ) {
      return "Glo";
    }
    // Airtel prefixes
    if (
      [
        "0802",
        "0808",
        "0708",
        "0812",
        "0701",
        "0902",
        "0907",
        "0901",
        "0904",
        "0912",
      ].includes(prefix)
    ) {
      return "Airtel";
    }
    // 9mobile prefixes
    if (["0809", "0817", "0818", "0909", "0908"].includes(prefix)) {
      return "9mobile";
    }

    return "Unknown Network";
  };

  const networkName = metadata.phone
    ? getNetworkFromPhone(metadata.phone)
    : "Unknown Network";

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
          TRANSACTION DETAILS
        </Text>

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
          icon="wifi-outline"
          label="Network"
          value={networkName}
          tokens={tokens}
        />

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
