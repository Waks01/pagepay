import React from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const { width } = Dimensions.get("window");

type ReceiptPreviewModalProps = {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  imageUri: string;
  format: "pdf" | "image";
  action: "save" | "share";
  tokens: any;
};

export function ReceiptPreviewModal({
  visible,
  onClose,
  onConfirm,
  imageUri,
  format,
  action,
  tokens,
}: ReceiptPreviewModalProps) {
  const actionText = action === "save" ? "Save" : "Share";
  const formatText = format === "pdf" ? "PDF" : "Image";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: tokens.paper }]}>
        {/* Header */}
        <View
          style={[
            styles.header,
            { backgroundColor: tokens.card, borderBottomColor: tokens.border },
          ]}
        >
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.ink }]}>
            Preview Receipt
          </Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Preview */}
        <ScrollView
          contentContainerStyle={styles.previewContainer}
          showsVerticalScrollIndicator={false}
        >
          {format === "image" && imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          ) : (
            <View
              style={[
                styles.pdfPlaceholder,
                { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
            >
              <View
                style={[
                  styles.pdfIconCircle,
                  { backgroundColor: `${tokens.accent}20` },
                ]}
              >
                <Ionicons
                  name="document-text"
                  size={60}
                  color={tokens.accent}
                />
              </View>
              <Text style={[styles.pdfText, { color: tokens.ink }]}>
                PDF Receipt Ready
              </Text>
              <Text style={[styles.pdfSubtext, { color: tokens.inkMuted }]}>
                {action === "save"
                  ? 'Tap "Save PDF" to choose where to save'
                  : 'Tap "Share PDF" to send via any app'}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Action Buttons */}
        <View
          style={[
            styles.footer,
            { backgroundColor: tokens.card, borderTopColor: tokens.border },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.cancelButton,
              { backgroundColor: tokens.paper, borderColor: tokens.border },
            ]}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={[styles.cancelButtonText, { color: tokens.ink }]}>
              Cancel
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.confirmButton, { backgroundColor: tokens.mint }]}
            onPress={onConfirm}
            activeOpacity={0.7}
          >
            <Ionicons
              name={
                action === "save" ? "download-outline" : "share-social-outline"
              }
              size={20}
              color="#FFFFFF"
            />
            <Text style={styles.confirmButtonText}>
              {actionText} {formatText}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  previewContainer: {
    padding: 16,
    alignItems: "center",
  },
  previewImage: {
    width: width - 32,
    height: (width - 32) * 1.78, // 9:16 aspect ratio
    borderRadius: 12,
  },
  pdfPlaceholder: {
    width: width - 32,
    height: 400,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  pdfIconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  pdfText: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  pdfSubtext: {
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
  },
  cancelButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  confirmButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
