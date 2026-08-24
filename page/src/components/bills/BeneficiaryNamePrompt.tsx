/**
 * BeneficiaryNamePrompt - Reusable modal for naming beneficiaries
 * Used when saving a new beneficiary after a successful purchase
 */

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Modal,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type Props = {
  visible: boolean;
  phone: string;
  network: string;
  onSave: (name: string) => void;
  onCancel: () => void;
  saving?: boolean;
};

export function BeneficiaryNamePrompt({
  visible,
  phone,
  network,
  onSave,
  onCancel,
  saving,
}: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [name, setName] = useState("");

  const handleSave = () => {
    if (name.trim().length > 0) {
      onSave(name.trim());
      setName("");
    }
  };

  const handleCancel = () => {
    setName("");
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleCancel}
          style={styles.backdrop}
        />

        <View style={[styles.modal, { backgroundColor: tokens.paper }]}>
          <View style={styles.header}>
            <View
              style={[
                styles.iconBadge,
                { backgroundColor: tokens.mintSoft },
              ]}
            >
              <Ionicons name="person-add" size={24} color={tokens.mint} />
            </View>
            <Text style={[styles.title, { color: tokens.ink }]}>
              Save Beneficiary
            </Text>
            <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
              Give this number a name for quick access next time
            </Text>
          </View>

          <View style={styles.body}>
            <View
              style={[
                styles.infoCard,
                { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
            >
              <View style={styles.infoRow}>
                <Ionicons name="call-outline" size={16} color={tokens.inkMuted} />
                <Text style={[styles.infoText, { color: tokens.ink }]}>
                  {phone}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="wifi-outline" size={16} color={tokens.inkMuted} />
                <Text style={[styles.infoText, { color: tokens.ink }]}>
                  {network.toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: tokens.inkMuted }]}>
                Beneficiary Name
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: tokens.card,
                    color: tokens.ink,
                    borderColor: tokens.border,
                  },
                ]}
                placeholder="e.g., Mom, Dad, Friend..."
                placeholderTextColor={tokens.inkMuted}
                value={name}
                onChangeText={setName}
                autoFocus
                maxLength={50}
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
              <Text style={[styles.hint, { color: tokens.inkMuted }]}>
                This helps you quickly find and recharge this number
              </Text>
            </View>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={handleCancel}
              disabled={saving}
              style={[
                styles.cancelBtn,
                { borderColor: tokens.border },
              ]}
            >
              <Text style={[styles.cancelText, { color: tokens.inkMuted }]}>
                Skip
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSave}
              disabled={!name.trim() || saving}
              style={[
                styles.saveBtn,
                {
                  backgroundColor:
                    name.trim() && !saving ? tokens.mint : tokens.border,
                },
              ]}
            >
              <Text style={[styles.saveText, { color: tokens.mintText }]}>
                {saving ? "Saving..." : "Save"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modal: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    alignItems: "center",
    padding: 24,
    paddingBottom: 20,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  body: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 16,
  },
  infoCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoText: {
    fontSize: 13,
    fontWeight: "600",
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    fontSize: 16,
    fontWeight: "600",
  },
  hint: {
    fontSize: 11,
    lineHeight: 16,
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
  },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
  },
  saveBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  saveText: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
});
