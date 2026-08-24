/**
 * ReceiptShareModal - Reusable component for sharing transaction receipts
 * Used across all bill purchase types (airtime, data, electricity, etc.)
 */

import { useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Share,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";

import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { apiFetch } from "@/src/shared/api/client";

type ReceiptData = {
  reference: string;
  service: string;
  amount: number;
  points_earned: number;
  date: string;
  phone?: string;
  network?: string;
  meter_number?: string;
  smartcard_number?: string;
  status: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  receipt: ReceiptData | null;
};

export function ReceiptShareModal({ visible, onClose, receipt }: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [sharing, setSharing] = useState(false);
  const viewRef = useState<View | null>(null)[0];

  if (!receipt) return null;

  const handleShare = async () => {
    setSharing(true);
    try {
      const message = formatReceiptText(receipt);

      if (Platform.OS === "ios" || Platform.OS === "android") {
        await Share.share({
          message,
          title: `PagePay Receipt - ${receipt.reference}`,
        });
      }
    } catch (error) {
      console.error("Share error:", error);
    } finally {
      setSharing(false);
    }
  };

  const handleDownloadPDF = async () => {
    setSharing(true);
    try {
      // Download PDF receipt from backend
      const response = await apiFetch(
        `/api/v1/bills/receipt/${receipt.reference}`,
      );

      if (!response.ok) {
        throw new Error("Failed to download PDF receipt");
      }

      const blob = await response.blob();
      const fileName = `PagePay_Receipt_${receipt.reference}.pdf`;

      // Convert blob to base64 for React Native
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const destPath = `${FileSystem.documentDirectory}${fileName}`;

        await FileSystem.writeAsStringAsync(destPath, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(destPath, {
            mimeType: "application/pdf",
            dialogTitle: "Save PDF Receipt",
          });
        }
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("PDF download error:", error);
      Alert.alert(
        "Download Failed",
        "Could not download PDF receipt. Please try again later.",
      );
    } finally {
      setSharing(false);
    }
  };

  const handleDownload = async () => {
    setSharing(true);
    try {
      // Capture receipt as image
      if (viewRef) {
        const uri = await captureRef(viewRef, {
          format: "png",
          quality: 1,
        });

        const fileName = `PagePay_Receipt_${receipt.reference}.png`;
        const destPath = `${FileSystem.documentDirectory}${fileName}`;

        await FileSystem.copyAsync({
          from: uri,
          to: destPath,
        });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(destPath, {
            mimeType: "image/png",
            dialogTitle: "Save Receipt",
          });
        }
      }
    } catch (error) {
      console.error("Download error:", error);
    } finally {
      setSharing(false);
    }
  };

  const formatReceiptText = (data: ReceiptData): string => {
    const lines = [
      "📱 PAGEPAY RECEIPT",
      "━━━━━━━━━━━━━━━━━━━━━━",
      "",
      `Service: ${data.service.toUpperCase().replace("_", " ")}`,
      `Amount: ₦${data.amount.toLocaleString()}`,
      `Points Earned: ${data.points_earned} pts`,
      `Reference: ${data.reference}`,
      `Date: ${new Date(data.date).toLocaleString()}`,
      `Status: ${data.status.toUpperCase()}`,
    ];

    if (data.phone) lines.push(`Phone: ${data.phone}`);
    if (data.network) lines.push(`Network: ${data.network.toUpperCase()}`);
    if (data.meter_number) lines.push(`Meter: ${data.meter_number}`);
    if (data.smartcard_number)
      lines.push(`Smartcard: ${data.smartcard_number}`);

    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("Thank you for using PagePay!");

    return lines.join("\n");
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: tokens.paper }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: tokens.ink }]}>Receipt</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={tokens.inkMuted} />
            </TouchableOpacity>
          </View>

          {/* Receipt Content */}
          <View
            ref={(ref) => viewRef as any}
            style={[
              styles.receiptCard,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <View style={styles.receiptHeader}>
              <View
                style={[
                  styles.successBadge,
                  { backgroundColor: tokens.mintSoft },
                ]}
              >
                <Ionicons
                  name="checkmark-circle"
                  size={48}
                  color={tokens.mint}
                />
              </View>
              <Text style={[styles.successText, { color: tokens.ink }]}>
                Transaction Successful
              </Text>
            </View>

            <View style={styles.receiptBody}>
              <ReceiptRow
                label="Service"
                value={receipt.service.toUpperCase().replace("_", " ")}
                tokens={tokens}
              />
              <ReceiptRow
                label="Amount"
                value={`₦${receipt.amount.toLocaleString()}`}
                valueColor={tokens.ink}
                tokens={tokens}
              />
              <ReceiptRow
                label="Points Earned"
                value={`${receipt.points_earned} pts`}
                valueColor={tokens.mint}
                tokens={tokens}
              />

              {receipt.phone && (
                <ReceiptRow
                  label="Phone"
                  value={receipt.phone}
                  tokens={tokens}
                />
              )}
              {receipt.network && (
                <ReceiptRow
                  label="Network"
                  value={receipt.network.toUpperCase()}
                  tokens={tokens}
                />
              )}
              {receipt.meter_number && (
                <ReceiptRow
                  label="Meter Number"
                  value={receipt.meter_number}
                  tokens={tokens}
                />
              )}
              {receipt.smartcard_number && (
                <ReceiptRow
                  label="Smartcard"
                  value={receipt.smartcard_number}
                  tokens={tokens}
                />
              )}

              <View
                style={[styles.divider, { backgroundColor: tokens.border }]}
              />

              <ReceiptRow
                label="Reference"
                value={receipt.reference}
                mono
                tokens={tokens}
              />
              <ReceiptRow
                label="Date"
                value={new Date(receipt.date).toLocaleString()}
                tokens={tokens}
              />
              <ReceiptRow
                label="Status"
                value={receipt.status.toUpperCase()}
                valueColor={
                  receipt.status === "success" ? tokens.mint : tokens.gold
                }
                tokens={tokens}
              />
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={handleShare}
              disabled={sharing}
              style={[
                styles.actionBtn,
                { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
            >
              <Ionicons name="share-outline" size={20} color={tokens.ink} />
              <Text style={[styles.actionText, { color: tokens.ink }]}>
                Share
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleDownload}
              disabled={sharing}
              style={[
                styles.actionBtn,
                { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
            >
              <Ionicons name="download-outline" size={20} color={tokens.ink} />
              <Text style={[styles.actionText, { color: tokens.ink }]}>
                Save Image
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleDownloadPDF}
              disabled={sharing}
              style={[styles.actionBtn, { backgroundColor: tokens.mint }]}
            >
              <Ionicons
                name="document-outline"
                size={20}
                color={tokens.mintText}
              />
              <Text style={[styles.actionText, { color: tokens.mintText }]}>
                PDF Receipt
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ReceiptRow({
  label,
  value,
  valueColor,
  mono,
  tokens,
}: {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
  tokens: any;
}) {
  return (
    <View style={styles.receiptRow}>
      <Text style={[styles.receiptLabel, { color: tokens.inkMuted }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.receiptValue,
          {
            color: valueColor || tokens.ink,
            fontFamily: mono ? "monospace" : "SpaceGrotesk_600SemiBold",
          },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    maxHeight: "90%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  closeBtn: {
    padding: 4,
  },
  receiptCard: {
    margin: 20,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  receiptHeader: {
    alignItems: "center",
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  successBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  successText: {
    fontSize: 16,
    fontWeight: "600",
  },
  receiptBody: {
    padding: 20,
    gap: 12,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  receiptLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  receiptValue: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    flex: 1,
    marginLeft: 12,
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
