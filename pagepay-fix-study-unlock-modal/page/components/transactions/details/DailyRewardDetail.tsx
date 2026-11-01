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
import {
  formatDateTime,
  formatDateOnly,
} from "@/src/shared/utils/dateFormatter";

interface DailyRewardDetailProps {
  transaction: TransactionHistoryItem;
  tokens: any;
}

export function DailyRewardDetail({
  transaction,
  tokens,
}: DailyRewardDetailProps) {
  const metadata = (transaction.metadata || {}) as Record<string, any>;

  const copyToClipboard = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied!", `${label} copied to clipboard`);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: tokens.paper }]}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Reward Icon/Emoji Section */}
      <View style={[styles.rewardHeader, { backgroundColor: tokens.card }]}>
        <View style={[styles.iconCircle, { backgroundColor: tokens.mintSoft }]}>
          <Text style={styles.iconEmoji}>{metadata.icon_emoji || "🎁"}</Text>
        </View>
        <Text style={[styles.rewardTitle, { color: tokens.ink }]}>
          {metadata.reward_title || "Daily Reward"}
        </Text>
        {metadata.reward_description && (
          <Text style={[styles.rewardDescription, { color: tokens.inkMuted }]}>
            {metadata.reward_description}
          </Text>
        )}
      </View>

      <View style={[styles.section, { backgroundColor: tokens.card }]}>
        <Text style={[styles.sectionTitle, { color: tokens.inkMuted }]}>
          REWARD DETAILS
        </Text>

        <DetailRow
          icon="flame-outline"
          label="Streak Day"
          value={`Day ${metadata.streak_day || 1}`}
          tokens={tokens}
          valueStyle={{ color: tokens.mint, fontWeight: "600" }}
        />

        {metadata.reward_type && (
          <DetailRow
            icon="pricetag-outline"
            label="Reward Type"
            value={
              metadata.reward_type.charAt(0).toUpperCase() +
              metadata.reward_type.slice(1)
            }
            tokens={tokens}
          />
        )}

        {metadata.reward_value && (
          <DetailRow
            icon="gift-outline"
            label="Reward Value"
            value={
              metadata.reward_type === "multiplier"
                ? `${metadata.reward_value}x`
                : `${metadata.reward_value} points`
            }
            tokens={tokens}
          />
        )}

        <DetailRow
          icon="star-outline"
          label="Points Earned"
          value={`${(metadata.points_earned || 0).toLocaleString()} SP`}
          tokens={tokens}
          valueStyle={{ color: tokens.mint, fontWeight: "600" }}
        />

        {metadata.claim_date && (
          <DetailRow
            icon="calendar-outline"
            label="Claim Date"
            value={formatDateOnly(metadata.claim_date)}
            tokens={tokens}
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
          icon="time-outline"
          label="Claimed At"
          value={formatDateTime(transaction.timestamp)}
          tokens={tokens}
        />

        <DetailRow
          icon="wallet-outline"
          label="Credited To"
          value="Service Credits"
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
            color: tokens.mint,
            fontWeight: "600",
          }}
        />
      </View>

      <View style={[styles.helpSection, { backgroundColor: tokens.mintSoft }]}>
        <Ionicons
          name="information-circle-outline"
          size={20}
          color={tokens.mint}
        />
        <Text style={[styles.helpText, { color: tokens.ink }]}>
          Daily rewards are credited to your Service Credits balance. Keep your
          streak going to unlock bigger rewards! 🔥
        </Text>
      </View>
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
  rewardHeader: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 16,
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 14,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  iconEmoji: {
    fontSize: 40,
  },
  rewardTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  rewardDescription: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
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
