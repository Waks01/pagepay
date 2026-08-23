import React, { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";

import { apiFetch } from "@/src/shared/api/client";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PagePay } from "@/constants/theme";

interface DeleteAccountModalProps {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteAccountModal({
  visible,
  onClose,
  onDeleted,
}: DeleteAccountModalProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { t } = useTranslation();

  const [step, setStep] = useState<"warning" | "confirm">("warning");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{
    password?: string;
    confirmation?: string;
    general?: string;
  }>({});

  const resetForm = () => {
    setStep("warning");
    setPassword("");
    setConfirmation("");
    setErrors({});
    setLoading(false);
  };

  const handleClose = () => {
    if (!loading) {
      resetForm();
      onClose();
    }
  };

  const handleProceed = () => {
    setStep("confirm");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleDelete = async () => {
    setErrors({});

    // Validation
    const newErrors: typeof errors = {};

    if (!password.trim()) {
      newErrors.password = t("delete_account.errors.password_required", {
        defaultValue: "Password is required",
      });
    }

    if (confirmation !== "DELETE") {
      newErrors.confirmation = t("delete_account.errors.confirmation_invalid", {
        defaultValue: "Type 'DELETE' exactly to confirm",
      });
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);

    try {
      const response = await apiFetch("/api/v1/auth/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: password.trim(),
          confirmation: "DELETE",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.detail ||
            t("delete_account.errors.generic", {
              defaultValue: "Failed to delete account",
            }),
        );
      }

      // Success
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDeleted();
    } catch (error) {
      setErrors({
        general:
          error instanceof Error
            ? error.message
            : t("delete_account.errors.network", {
                defaultValue: "Network error. Please try again.",
              }),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView
        style={[styles.container, { backgroundColor: tokens.paper }]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: tokens.border }]}>
          <Pressable
            onPress={handleClose}
            disabled={loading}
            style={({ pressed }) => [
              styles.headerButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="close" size={24} color={tokens.ink} />
          </Pressable>

          <Text style={[styles.headerTitle, { color: tokens.ink }]}>
            {t("delete_account.title", { defaultValue: "Delete Account" })}
          </Text>

          <View style={styles.headerButton} />
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
        >
          {step === "warning" ? (
            /* Warning Step */
            <View style={styles.warningStep}>
              <View
                style={[
                  styles.warningIcon,
                  { backgroundColor: tokens.signalSoft },
                ]}
              >
                <Ionicons name="warning" size={32} color={tokens.signal} />
              </View>

              <Text style={[styles.warningTitle, { color: tokens.ink }]}>
                {t("delete_account.warning.title", {
                  defaultValue: "This will permanently delete your account",
                })}
              </Text>

              <Text
                style={[styles.warningDescription, { color: tokens.inkMuted }]}
              >
                {t("delete_account.warning.description", {
                  defaultValue:
                    "This action cannot be undone. All your data will be permanently deleted.",
                })}
              </Text>

              <View
                style={[
                  styles.dataList,
                  { backgroundColor: tokens.card, borderColor: tokens.border },
                ]}
              >
                <Text style={[styles.dataListTitle, { color: tokens.ink }]}>
                  {t("delete_account.warning.data_title", {
                    defaultValue: "The following will be permanently deleted:",
                  })}
                </Text>

                {[
                  "delete_account.warning.data.profile",
                  "delete_account.warning.data.points",
                  "delete_account.warning.data.reading",
                  "delete_account.warning.data.study",
                  "delete_account.warning.data.tasks",
                  "delete_account.warning.data.community",
                  "delete_account.warning.data.payout",
                ].map((key, index) => (
                  <View key={key} style={styles.dataItem}>
                    <Ionicons
                      name="trash-outline"
                      size={16}
                      color={tokens.signal}
                    />
                    <Text
                      style={[styles.dataItemText, { color: tokens.inkMuted }]}
                    >
                      {t(key, {
                        defaultValue: [
                          "Profile information & avatar",
                          "Points balance & transaction history",
                          "Reading progress & bookmarks",
                          "Study materials & AI conversations",
                          "Task submissions & earnings",
                          "Community posts & comments",
                          "Payout account information",
                        ][index],
                      })}
                    </Text>
                  </View>
                ))}
              </View>

              <Text style={[styles.warningFooter, { color: tokens.inkMuted }]}>
                {t("delete_account.warning.footer", {
                  defaultValue:
                    "Consider downloading your data before proceeding if you need it for your records.",
                })}
              </Text>
            </View>
          ) : (
            /* Confirmation Step */
            <View style={styles.confirmStep}>
              <View
                style={[
                  styles.confirmIcon,
                  { backgroundColor: tokens.signalSoft },
                ]}
              >
                <Ionicons
                  name="shield-checkmark-outline"
                  size={32}
                  color={tokens.signal}
                />
              </View>

              <Text style={[styles.confirmTitle, { color: tokens.ink }]}>
                {t("delete_account.confirm.title", {
                  defaultValue: "Confirm Account Deletion",
                })}
              </Text>

              <Text
                style={[styles.confirmDescription, { color: tokens.inkMuted }]}
              >
                {t("delete_account.confirm.description", {
                  defaultValue:
                    "To complete the deletion, please enter your password and type 'DELETE' below.",
                })}
              </Text>

              {/* Password Input */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: tokens.ink }]}>
                  {t("delete_account.confirm.password_label", {
                    defaultValue: "Current Password",
                  })}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: tokens.card,
                      borderColor: errors.password
                        ? tokens.signal
                        : tokens.border,
                      color: tokens.ink,
                    },
                  ]}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (errors.password) {
                      setErrors((prev) => ({ ...prev, password: undefined }));
                    }
                  }}
                  placeholder={t(
                    "delete_account.confirm.password_placeholder",
                    {
                      defaultValue: "Enter your password",
                    },
                  )}
                  placeholderTextColor={tokens.inkMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  editable={!loading}
                />
                {errors.password && (
                  <Text style={[styles.errorText, { color: tokens.signal }]}>
                    {errors.password}
                  </Text>
                )}
              </View>

              {/* Confirmation Input */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: tokens.ink }]}>
                  {t("delete_account.confirm.confirmation_label", {
                    defaultValue: "Type 'DELETE' to confirm",
                  })}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: tokens.card,
                      borderColor: errors.confirmation
                        ? tokens.signal
                        : tokens.border,
                      color: tokens.ink,
                    },
                  ]}
                  value={confirmation}
                  onChangeText={(text) => {
                    setConfirmation(text);
                    if (errors.confirmation) {
                      setErrors((prev) => ({
                        ...prev,
                        confirmation: undefined,
                      }));
                    }
                  }}
                  placeholder="DELETE"
                  placeholderTextColor={tokens.inkMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!loading}
                />
                {errors.confirmation && (
                  <Text style={[styles.errorText, { color: tokens.signal }]}>
                    {errors.confirmation}
                  </Text>
                )}
              </View>

              {/* General Error */}
              {errors.general && (
                <View
                  style={[
                    styles.errorBox,
                    {
                      backgroundColor: tokens.signalSoft,
                      borderColor: tokens.signal,
                    },
                  ]}
                >
                  <Ionicons
                    name="alert-circle"
                    size={16}
                    color={tokens.signal}
                  />
                  <Text style={[styles.errorBoxText, { color: tokens.signal }]}>
                    {errors.general}
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Footer Buttons */}
        <View style={[styles.footer, { borderTopColor: tokens.border }]}>
          {step === "warning" ? (
            <>
              <Pressable
                onPress={handleClose}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: tokens.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    { color: tokens.inkMuted },
                  ]}
                >
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleProceed}
                style={({ pressed }) => [
                  styles.dangerButton,
                  {
                    backgroundColor: tokens.signal,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.dangerButtonText, { color: tokens.paper }]}
                >
                  {t("delete_account.warning.proceed", {
                    defaultValue: "I Understand, Proceed",
                  })}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={() => setStep("warning")}
                disabled={loading}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  {
                    borderColor: tokens.border,
                    opacity: pressed || loading ? 0.7 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    { color: tokens.inkMuted },
                  ]}
                >
                  {t("common.back", { defaultValue: "Back" })}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleDelete}
                disabled={
                  loading || !password.trim() || confirmation !== "DELETE"
                }
                style={({ pressed }) => [
                  styles.dangerButton,
                  {
                    backgroundColor: tokens.signal,
                    opacity:
                      pressed ||
                      loading ||
                      !password.trim() ||
                      confirmation !== "DELETE"
                        ? 0.7
                        : 1,
                  },
                ]}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={tokens.paper} />
                ) : (
                  <Text
                    style={[styles.dangerButtonText, { color: tokens.paper }]}
                  >
                    {t("delete_account.confirm.delete_button", {
                      defaultValue: "Delete My Account",
                    })}
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "SpaceGrotesk_600SemiBold",
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  // Warning Step Styles
  warningStep: {
    alignItems: "center",
    gap: 20,
  },
  warningIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  warningTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  warningDescription: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  dataList: {
    width: "100%",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  dataListTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  dataItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dataItemText: {
    fontSize: 14,
    flex: 1,
  },
  warningFooter: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  // Confirmation Step Styles
  confirmStep: {
    gap: 20,
  },
  confirmIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  confirmTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  confirmDescription: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorBoxText: {
    fontSize: 14,
    flex: 1,
  },
  // Footer Styles
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  dangerButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerButtonText: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
});
