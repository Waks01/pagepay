/**
 * DisputeModal - Modal for reporting transaction disputes
 * Allows users to report failed VTU transactions for auto-refund
 */

import { useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/src/shared/api/client";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type DisputeReason = {
  id: string;
  title: string;
  description: string;
};

const DISPUTE_REASONS: DisputeReason[] = [
  {
    id: "not_delivered",
    title: "Not Delivered",
    description: "Airtime/data was not received on the phone number",
  },
  {
    id: "partial_delivery",
    title: "Partial Delivery",
    description: "Received less than the purchased amount",
  },
  {
    id: "wrong_network",
    title: "Wrong Network",
    description: "Purchased for the wrong network",
  },
  {
    id: "network_error",
    title: "Network Error",
    description: "Transaction failed due to network issues",
  },
  {
    id: "other",
    title: "Other Issue",
    description: "Other transaction-related problems",
  },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  transactionReference: string;
  transactionDetails?: {
    service: string;
    amount: number;
    phone?: string;
    date: string;
  };
};

export function DisputeModal({
  visible,
  onClose,
  transactionReference,
  transactionDetails,
}: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const queryClient = useQueryClient();

  const [selectedReason, setSelectedReason] = useState<string>("");
  const [description, setDescription] = useState("");

  const disputeMutation = useMutation({
    mutationFn: async (data: {
      transaction_reference: string;
      reason: string;
      description: string;
    }) => {
      const response = await apiFetch("/api/v1/bills/disputes", {
        method: "POST",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to submit dispute");
      }

      return response.json();
    },
    onSuccess: () => {
      Alert.alert(
        "Dispute Submitted",
        "Your dispute has been submitted successfully. We'll review it within 24 hours and process any eligible refunds automatically.",
        [{ text: "OK" }],
      );
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["disputes"] });
      onClose();
      resetForm();
    },
    onError: (error: any) => {
      Alert.alert("Submission Failed", error.message);
    },
  });

  const resetForm = () => {
    setSelectedReason("");
    setDescription("");
  };

  const handleSubmit = () => {
    if (!selectedReason) {
      Alert.alert("Please Select", "Please select a reason for the dispute");
      return;
    }

    if (selectedReason === "other" && !description.trim()) {
      Alert.alert(
        "Description Required",
        "Please describe the issue you encountered",
      );
      return;
    }

    const reasonData = DISPUTE_REASONS.find((r) => r.id === selectedReason);
    const finalDescription =
      selectedReason === "other"
        ? description.trim()
        : reasonData?.description || "";

    Alert.alert(
      "Submit Dispute",
      "Are you sure you want to submit this dispute? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: () =>
            disputeMutation.mutate({
              transaction_reference: transactionReference,
              reason: selectedReason,
              description: finalDescription,
            }),
        },
      ],
    );
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
            <Text style={[styles.title, { color: tokens.ink }]}>
              Report Issue
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={tokens.inkMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Transaction Details */}
            {transactionDetails && (
              <View
                style={[
                  styles.transactionCard,
                  {
                    backgroundColor: tokens.cardSecondary,
                    borderColor: tokens.border,
                  },
                ]}
              >
                <View style={styles.transactionHeader}>
                  <Ionicons
                    name="receipt-outline"
                    size={20}
                    color={tokens.inkMuted}
                  />
                  <Text
                    style={[styles.transactionTitle, { color: tokens.ink }]}
                  >
                    Transaction Details
                  </Text>
                </View>

                <View style={styles.transactionDetails}>
                  <View style={styles.detailRow}>
                    <Text
                      style={[styles.detailLabel, { color: tokens.inkMuted }]}
                    >
                      Service:
                    </Text>
                    <Text style={[styles.detailValue, { color: tokens.ink }]}>
                      {transactionDetails?.service?.toUpperCase() || "AIRTIME"}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text
                      style={[styles.detailLabel, { color: tokens.inkMuted }]}
                    >
                      Amount:
                    </Text>
                    <Text style={[styles.detailValue, { color: tokens.ink }]}>
                      {transactionDetails?.amount
                        ? `₦${transactionDetails.amount.toLocaleString()}`
                        : "N/A"}
                    </Text>
                  </View>

                  {transactionDetails.phone && (
                    <View style={styles.detailRow}>
                      <Text
                        style={[styles.detailLabel, { color: tokens.inkMuted }]}
                      >
                        Phone:
                      </Text>
                      <Text style={[styles.detailValue, { color: tokens.ink }]}>
                        {transactionDetails.phone}
                      </Text>
                    </View>
                  )}

                  <View style={styles.detailRow}>
                    <Text
                      style={[styles.detailLabel, { color: tokens.inkMuted }]}
                    >
                      Reference:
                    </Text>
                    <Text style={[styles.detailValue, { color: tokens.ink }]}>
                      {transactionReference}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Dispute Reasons */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                What went wrong?
              </Text>

              {DISPUTE_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.id}
                  onPress={() => setSelectedReason(reason.id)}
                  style={[
                    styles.reasonOption,
                    {
                      backgroundColor:
                        selectedReason === reason.id
                          ? tokens.mintSoft
                          : tokens.card,
                      borderColor:
                        selectedReason === reason.id
                          ? tokens.mint
                          : tokens.border,
                    },
                  ]}
                >
                  <View style={styles.reasonContent}>
                    <Text style={[styles.reasonTitle, { color: tokens.ink }]}>
                      {reason.title}
                    </Text>
                    <Text
                      style={[
                        styles.reasonDescription,
                        { color: tokens.inkMuted },
                      ]}
                    >
                      {reason.description}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.radioButton,
                      {
                        borderColor:
                          selectedReason === reason.id
                            ? tokens.mint
                            : tokens.border,
                        backgroundColor:
                          selectedReason === reason.id
                            ? tokens.mint
                            : "transparent",
                      },
                    ]}
                  >
                    {selectedReason === reason.id && (
                      <Ionicons
                        name="checkmark"
                        size={12}
                        color={tokens.mintText}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Additional Description for "Other" */}
            {selectedReason === "other" && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                  Describe the Issue
                </Text>
                <TextInput
                  style={[
                    styles.descriptionInput,
                    {
                      backgroundColor: tokens.card,
                      borderColor: tokens.border,
                      color: tokens.ink,
                    },
                  ]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Please describe what happened with your transaction..."
                  placeholderTextColor={tokens.inkMuted}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                />
                <Text
                  style={[styles.characterCount, { color: tokens.inkMuted }]}
                >
                  {description.length}/500 characters
                </Text>
              </View>
            )}

            {/* Info Banner */}
            <View
              style={[styles.infoBanner, { backgroundColor: tokens.blueSoft }]}
            >
              <Ionicons
                name="information-circle-outline"
                size={20}
                color={tokens.blue}
              />
              <View style={styles.infoContent}>
                <Text style={[styles.infoTitle, { color: tokens.blue }]}>
                  Auto-Refund Process
                </Text>
                <Text style={[styles.infoText, { color: tokens.blue }]}>
                  Eligible disputes are automatically refunded within 24 hours.
                  You'll receive a notification when the refund is processed.
                </Text>
              </View>
            </View>
          </ScrollView>

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={disputeMutation.isPending || !selectedReason}
            style={[
              styles.submitBtn,
              {
                backgroundColor:
                  !selectedReason || disputeMutation.isPending
                    ? tokens.cardSecondary
                    : tokens.mint,
              },
            ]}
          >
            <Text style={[styles.submitBtnText, { color: tokens.mintText }]}>
              {disputeMutation.isPending ? "Submitting..." : "Submit Dispute"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    height: "85%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  closeBtn: {
    padding: 4,
  },
  transactionCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  transactionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  transactionTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginLeft: 8,
  },
  transactionDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    fontSize: 14,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "500",
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 12,
  },
  reasonOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 12,
  },
  reasonContent: {
    flex: 1,
  },
  reasonTitle: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  reasonDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  descriptionInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    textAlignVertical: "top",
    minHeight: 100,
  },
  characterCount: {
    fontSize: 12,
    textAlign: "right",
    marginTop: 4,
  },
  infoBanner: {
    flexDirection: "row",
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  infoContent: {
    flex: 1,
    marginLeft: 8,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  infoText: {
    fontSize: 12,
    lineHeight: 16,
  },
  submitBtn: {
    height: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
