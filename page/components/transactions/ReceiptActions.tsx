import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";

import { apiFetch } from "@/src/shared/api/client";
import { PagePaySpinner } from "@/components/PagePaySpinner";

type ReceiptActionsProps = {
  transactionId: number;
  tokens: any;
};

export function ReceiptActions({ transactionId, tokens }: ReceiptActionsProps) {
  const [downloading, setDownloading] = useState<"pdf" | "image" | null>(null);

  const downloadReceipt = async (format: "pdf" | "image") => {
    try {
      setDownloading(format);

      // Request media library permissions for saving
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "Please grant media library permission to save receipts.",
        );
        return;
      }

      // Download from API
      const response = await apiFetch(
        `/api/v1/transactions/receipt/${transactionId}/${format}`,
      );

      if (!response.ok) {
        throw new Error("Failed to generate receipt");
      }

      const blob = await response.blob();
      const fileExtension = format === "pdf" ? "pdf" : "png";
      const fileName = `PagePay_Receipt_${transactionId}.${fileExtension}`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        const base64 = base64data.split(",")[1];

        // Save to file system
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        // Save to media library
        if (format === "image") {
          await MediaLibrary.saveToLibraryAsync(fileUri);
          Alert.alert("Success", "Receipt image saved to gallery!");
        } else {
          // For PDF, offer to share
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) {
            await Sharing.shareAsync(fileUri, {
              mimeType: "application/pdf",
              dialogTitle: "Share Receipt PDF",
            });
          } else {
            Alert.alert("Success", "Receipt PDF downloaded!");
          }
        }
      };
    } catch (error) {
      console.error("[ReceiptActions] Download error:", error);
      Alert.alert("Error", "Failed to download receipt. Please try again.");
    } finally {
      setDownloading(null);
    }
  };

  const shareReceipt = async (format: "pdf" | "image") => {
    try {
      setDownloading(format);

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(
          "Not Available",
          "Sharing is not available on this device.",
        );
        return;
      }

      // Download from API
      const response = await apiFetch(
        `/api/v1/transactions/receipt/${transactionId}/${format}`,
      );

      if (!response.ok) {
        throw new Error("Failed to generate receipt");
      }

      const blob = await response.blob();
      const fileExtension = format === "pdf" ? "pdf" : "png";
      const fileName = `PagePay_Receipt_${transactionId}.${fileExtension}`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        const base64 = base64data.split(",")[1];

        // Save to file system
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        // Share
        await Sharing.shareAsync(fileUri, {
          mimeType: format === "pdf" ? "application/pdf" : "image/png",
          dialogTitle: `Share Receipt ${format === "pdf" ? "PDF" : "Image"}`,
        });
      };
    } catch (error) {
      console.error("[ReceiptActions] Share error:", error);
      Alert.alert("Error", "Failed to share receipt. Please try again.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: tokens.ink }]}>Receipt Options</Text>

      <View style={styles.row}>
        {/* Download as Image */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
          onPress={() => downloadReceipt("image")}
          disabled={downloading !== null}
          activeOpacity={0.7}
        >
          {downloading === "image" ? (
            <PagePaySpinner size={24} />
          ) : (
            <>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: `${tokens.mint}20` },
                ]}
              >
                <Ionicons name="image-outline" size={22} color={tokens.mint} />
              </View>
              <Text style={[styles.buttonText, { color: tokens.ink }]}>
                Save as Image
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Download as PDF */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
          onPress={() => downloadReceipt("pdf")}
          disabled={downloading !== null}
          activeOpacity={0.7}
        >
          {downloading === "pdf" ? (
            <PagePaySpinner size={24} />
          ) : (
            <>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: `${tokens.accent}20` },
                ]}
              >
                <Ionicons
                  name="document-outline"
                  size={22}
                  color={tokens.accent}
                />
              </View>
              <Text style={[styles.buttonText, { color: tokens.ink }]}>
                Save as PDF
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        {/* Share as Image */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
          onPress={() => shareReceipt("image")}
          disabled={downloading !== null}
          activeOpacity={0.7}
        >
          {downloading === "image" ? (
            <PagePaySpinner size={24} />
          ) : (
            <>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: `${tokens.mint}20` },
                ]}
              >
                <Ionicons
                  name="share-social-outline"
                  size={22}
                  color={tokens.mint}
                />
              </View>
              <Text style={[styles.buttonText, { color: tokens.ink }]}>
                Share Image
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Share as PDF */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
          onPress={() => shareReceipt("pdf")}
          disabled={downloading !== null}
          activeOpacity={0.7}
        >
          {downloading === "pdf" ? (
            <PagePaySpinner size={24} />
          ) : (
            <>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: `${tokens.accent}20` },
                ]}
              >
                <Ionicons
                  name="share-social-outline"
                  size={22}
                  color={tokens.accent}
                />
              </View>
              <Text style={[styles.buttonText, { color: tokens.ink }]}>
                Share PDF
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    flex: 1,
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    minHeight: 100,
    justifyContent: "center",
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
});
