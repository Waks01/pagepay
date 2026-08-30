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
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library/legacy";

import { apiFetch } from "@/src/shared/api/client";
import { PagePaySpinner } from "@/components/PagePaySpinner";
import { ReceiptPreviewModal } from "@/components/transactions/ReceiptPreviewModal";

type ReceiptActionsProps = {
  transactionId: number;
  tokens: any;
};

export function ReceiptActions({ transactionId, tokens }: ReceiptActionsProps) {
  const [downloadingImage, setDownloadingImage] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [sharingImage, setSharingImage] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewUri, setPreviewUri] = useState("");
  const [previewFormat, setPreviewFormat] = useState<"pdf" | "image">("image");
  const [previewAction, setPreviewAction] = useState<"save" | "share">("save");

  const downloadReceipt = async (format: "pdf" | "image") => {
    try {
      if (format === "image") {
        setDownloadingImage(true);
      } else {
        setDownloadingPdf(true);
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

        // Show preview
        setPreviewUri(fileUri);
        setPreviewFormat(format);
        setPreviewAction("save");
        setShowPreview(true);

        if (format === "image") {
          setDownloadingImage(false);
        } else {
          setDownloadingPdf(false);
        }
      };
    } catch (error) {
      console.error("[ReceiptActions] Download error:", error);
      Alert.alert("Error", "Failed to download receipt. Please try again.");
      setDownloadingImage(false);
      setDownloadingPdf(false);
    }
  };

  const shareReceipt = async (format: "pdf" | "image") => {
    try {
      if (format === "image") {
        setSharingImage(true);
      } else {
        setSharingPdf(true);
      }

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(
          "Not Available",
          "Sharing is not available on this device.",
        );
        setSharingImage(false);
        setSharingPdf(false);
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

        // Show preview
        setPreviewUri(fileUri);
        setPreviewFormat(format);
        setPreviewAction("share");
        setShowPreview(true);

        if (format === "image") {
          setSharingImage(false);
        } else {
          setSharingPdf(false);
        }
      };
    } catch (error) {
      console.error("[ReceiptActions] Share error:", error);
      Alert.alert("Error", "Failed to share receipt. Please try again.");
      setSharingImage(false);
      setSharingPdf(false);
    }
  };

  const confirmAction = async () => {
    try {
      setShowPreview(false);

      if (previewAction === "save") {
        if (previewFormat === "image") {
          // Save image to gallery
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status !== "granted") {
            Alert.alert(
              "Permission Required",
              "Please grant media library permission to save receipts.",
            );
            return;
          }

          await MediaLibrary.saveToLibraryAsync(previewUri);
          Alert.alert("Success", "Receipt image saved to gallery!");
        } else {
          // For PDF, open share dialog (mobile doesn't have direct file save)
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) {
            await Sharing.shareAsync(previewUri, {
              mimeType: "application/pdf",
              dialogTitle: "Save Receipt PDF",
              UTI: "com.adobe.pdf",
            });
          } else {
            Alert.alert(
              "Not Available",
              "Sharing is not available on this device.",
            );
          }
        }
      } else {
        // Share action
        await Sharing.shareAsync(previewUri, {
          mimeType: previewFormat === "pdf" ? "application/pdf" : "image/png",
          dialogTitle: `Share Receipt ${previewFormat === "pdf" ? "PDF" : "Image"}`,
        });
      }
    } catch (error) {
      console.error("[ReceiptActions] Confirm error:", error);
      Alert.alert("Error", "Failed to complete action. Please try again.");
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
          disabled={downloadingImage}
          activeOpacity={0.7}
        >
          {downloadingImage ? (
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
          disabled={downloadingPdf}
          activeOpacity={0.7}
        >
          {downloadingPdf ? (
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
          disabled={sharingImage}
          activeOpacity={0.7}
        >
          {sharingImage ? (
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
          disabled={sharingPdf}
          activeOpacity={0.7}
        >
          {sharingPdf ? (
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

      {/* Preview Modal */}
      <ReceiptPreviewModal
        visible={showPreview}
        onClose={() => setShowPreview(false)}
        onConfirm={confirmAction}
        imageUri={previewUri}
        format={previewFormat}
        action={previewAction}
        tokens={tokens}
      />
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
