/**
 * BulkAirtimeModal - Modal for purchasing airtime for multiple recipients
 * Allows up to 50 recipients per transaction
 */

import { useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";

import { apiFetch } from "@/src/shared/api/client";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type BulkRecipient = {
  phone: string;
  amount: number;
};

type BulkPurchaseResult = {
  phone: string;
  amount: number;
  success: boolean;
  reference?: string;
  error?: string;
  points_earned?: number;
};

type BulkPurchaseResponse = {
  total_successful: number;
  total_failed: number;
  total_amount: number;
  total_refunded: number;
  total_points_earned: number;
  results: BulkPurchaseResult[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSuccess: (result: BulkPurchaseResponse) => void;
};

export function BulkAirtimeModal({ visible, onClose, onSuccess }: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [network, setNetwork] = useState("mtn");
  const [recipients, setRecipients] = useState<BulkRecipient[]>([
    { phone: "", amount: 100 },
  ]);

  const bulkPurchaseMutation = useMutation({
    mutationFn: async (data: {
      network: string;
      recipients: BulkRecipient[];
    }): Promise<BulkPurchaseResponse> => {
      const response = await apiFetch("/api/v1/bills/airtime/bulk", {
        method: "POST",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Bulk purchase failed");
      }

      return response.json();
    },
    onSuccess: (result) => {
      onSuccess(result);
      onClose();
      resetForm();
    },
    onError: (error: any) => {
      Alert.alert("Purchase Failed", error.message);
    },
  });

  const resetForm = () => {
    setNetwork("mtn");
    setRecipients([{ phone: "", amount: 100 }]);
  };

  const addRecipient = () => {
    if (recipients.length < 50) {
      setRecipients([...recipients, { phone: "", amount: 100 }]);
    }
  };

  const removeRecipient = (index: number) => {
    if (recipients.length > 1) {
      setRecipients(recipients.filter((_, i) => i !== index));
    }
  };

  const updateRecipient = (
    index: number,
    field: keyof BulkRecipient,
    value: string | number,
  ) => {
    const updated = [...recipients];
    updated[index] = { ...updated[index], [field]: value };
    setRecipients(updated);
  };

  const validateForm = () => {
    // Check for empty phones
    const emptyPhones = recipients.filter((r) => !r.phone.trim());
    if (emptyPhones.length > 0) {
      Alert.alert("Validation Error", "Please fill in all phone numbers");
      return false;
    }

    // Check phone number format
    const invalidPhones = recipients.filter(
      (r) => !/^0[789][01]\d{8}$/.test(r.phone.trim()),
    );
    if (invalidPhones.length > 0) {
      Alert.alert(
        "Validation Error",
        "Please enter valid Nigerian phone numbers (11 digits starting with 070, 080, 081, 090, 091)",
      );
      return false;
    }

    // Check amounts
    const invalidAmounts = recipients.filter(
      (r) => r.amount < 50 || r.amount > 50000,
    );
    if (invalidAmounts.length > 0) {
      Alert.alert("Validation Error", "Amount must be between ₦50 and ₦50,000");
      return false;
    }

    return true;
  };

  const handlePurchase = () => {
    if (!validateForm()) return;

    const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0);

    Alert.alert(
      "Confirm Bulk Purchase",
      `Purchase airtime for ${recipients.length} recipients?\n\nTotal: ₦${totalAmount.toLocaleString()}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Purchase",
          onPress: () => bulkPurchaseMutation.mutate({ network, recipients }),
        },
      ],
    );
  };

  const totalAmount = recipients.reduce((sum, r) => sum + (r.amount || 0), 0);

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
              Bulk Airtime Purchase
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={tokens.inkMuted} />
            </TouchableOpacity>
          </View>

          {/* Network Selection */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
              Network
            </Text>
            <View
              style={[
                styles.networkDropdown,
                { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
            >
              <TouchableOpacity
                style={styles.networkSelector}
                onPress={() => {
                  // Simple network selection
                  const networks = ["mtn", "airtel", "glo", "9mobile"];
                  const currentIndex = networks.indexOf(network);
                  const nextIndex = (currentIndex + 1) % networks.length;
                  setNetwork(networks[nextIndex]);
                }}
              >
                <Text style={[styles.networkText, { color: tokens.ink }]}>
                  {network.toUpperCase()}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={tokens.inkMuted}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Recipients List */}
          <View style={[styles.section, { flex: 1 }]}>
            <View style={styles.recipientsHeader}>
              <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                Recipients ({recipients.length}/50)
              </Text>
              <TouchableOpacity
                onPress={addRecipient}
                disabled={recipients.length >= 50}
                style={[
                  styles.addBtn,
                  {
                    backgroundColor:
                      recipients.length >= 50
                        ? tokens.cardSecondary
                        : tokens.mint,
                  },
                ]}
              >
                <Ionicons
                  name="add"
                  size={16}
                  color={
                    recipients.length >= 50 ? tokens.inkMuted : tokens.mintText
                  }
                />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.recipientsList}
              showsVerticalScrollIndicator={false}
            >
              {recipients.map((recipient, index) => (
                <View
                  key={index}
                  style={[
                    styles.recipientRow,
                    {
                      backgroundColor: tokens.card,
                      borderColor: tokens.border,
                    },
                  ]}
                >
                  <View style={styles.recipientContent}>
                    <View style={styles.inputGroup}>
                      <Text
                        style={[styles.inputLabel, { color: tokens.inkMuted }]}
                      >
                        Phone Number
                      </Text>
                      <TextInput
                        style={[
                          styles.phoneInput,
                          {
                            backgroundColor: tokens.cardSecondary,
                            color: tokens.ink,
                            borderColor: tokens.border,
                          },
                        ]}
                        value={recipient.phone}
                        onChangeText={(text) =>
                          updateRecipient(index, "phone", text)
                        }
                        placeholder="08012345678"
                        placeholderTextColor={tokens.inkMuted}
                        keyboardType="phone-pad"
                        maxLength={11}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text
                        style={[styles.inputLabel, { color: tokens.inkMuted }]}
                      >
                        Amount
                      </Text>
                      <TextInput
                        style={[
                          styles.amountInput,
                          {
                            backgroundColor: tokens.cardSecondary,
                            color: tokens.ink,
                            borderColor: tokens.border,
                          },
                        ]}
                        value={recipient.amount.toString()}
                        onChangeText={(text) =>
                          updateRecipient(index, "amount", parseInt(text) || 0)
                        }
                        placeholder="100"
                        placeholderTextColor={tokens.inkMuted}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>

                  {recipients.length > 1 && (
                    <TouchableOpacity
                      onPress={() => removeRecipient(index)}
                      style={styles.removeBtn}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={18}
                        color={tokens.error}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>

          {/* Summary & Purchase */}
          <View style={styles.footer}>
            <View
              style={[
                styles.summary,
                { backgroundColor: tokens.cardSecondary },
              ]}
            >
              <Text style={[styles.summaryText, { color: tokens.ink }]}>
                Total: ₦{totalAmount.toLocaleString()} for {recipients.length}{" "}
                recipient{recipients.length !== 1 ? "s" : ""}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handlePurchase}
              disabled={
                bulkPurchaseMutation.isPending || recipients.length === 0
              }
              style={[
                styles.purchaseBtn,
                {
                  backgroundColor: bulkPurchaseMutation.isPending
                    ? tokens.cardSecondary
                    : tokens.mint,
                },
              ]}
            >
              <Text
                style={[styles.purchaseBtnText, { color: tokens.mintText }]}
              >
                {bulkPurchaseMutation.isPending
                  ? "Processing..."
                  : "Purchase Airtime"}
              </Text>
            </TouchableOpacity>
          </View>
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
    height: "90%",
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
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 12,
  },
  networkDropdown: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  networkSelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  networkText: {
    fontSize: 16,
    fontWeight: "600",
  },
  recipientsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  recipientsList: {
    flex: 1,
  },
  recipientRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  recipientContent: {
    flex: 1,
    flexDirection: "row",
    gap: 12,
  },
  inputGroup: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  phoneInput: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    fontSize: 14,
  },
  amountInput: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    fontSize: 14,
    minWidth: 80,
  },
  removeBtn: {
    padding: 8,
    marginLeft: 8,
  },
  footer: {
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#E5E5E5",
  },
  summary: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: "center",
  },
  summaryText: {
    fontSize: 14,
    fontWeight: "500",
  },
  purchaseBtn: {
    height: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  purchaseBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
