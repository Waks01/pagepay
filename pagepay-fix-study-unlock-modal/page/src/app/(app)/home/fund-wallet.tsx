import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { usePaystack } from "expo-paystack";

import { apiFetch } from "@/src/shared/api/client";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PagePay } from "@/constants/theme";

type DepositResponse = {
  payment_url: string;
  access_code: string;
  reference: string;
  amount_kobo: number;
  deposit_amount_kobo: number;
};

const AMOUNTS = [100, 1000, 2000, 5000, 10000, 20000];

export default function FundWalletScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { initializePayment, isLoading: paystackLoading } = usePaystack();

  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [checkingPayment, setCheckingPayment] = useState(false);

  const pollPaymentStatus = async (reference: string) => {
    console.log(
      "🔍 [PAYMENT] Starting payment verification for reference:",
      reference,
    );
    setCheckingPayment(true);
    let attempts = 0;

    const checkStatus = async (): Promise<boolean> => {
      try {
        attempts++;
        console.log(`🔄 [PAYMENT] Polling attempt ${attempts}/10...`);

        console.log("📊 [PAYMENT] Refetching user data...");
        await qc.refetchQueries({ queryKey: ["me"] });
        console.log("✅ [PAYMENT] User data refetched");

        const me = useCurrentUserStore.getState().user;
        if (me) {
          console.log("✅ [PAYMENT] User data refreshed after deposit");
          return true;
        }

        if (attempts < 10) {
          console.log(`⏳ [PAYMENT] Waiting 2s before next attempt...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return checkStatus();
        }

        console.log("⚠️ [PAYMENT] Max attempts reached");
        return false;
      } catch (e) {
        console.error("❌ [PAYMENT] Error during check:", e);
        return false;
      }
    };

    const success = await checkStatus();
    setCheckingPayment(false);

    console.log("🏁 [PAYMENT] Polling complete. Success:", success);

    Alert.alert(
      success
        ? t("fund_wallet.payment_success_title")
        : t("fund_wallet.payment_processing_title"),
      success
        ? t("fund_wallet.payment_success_body")
        : t("fund_wallet.payment_processing_body"),
    );

    console.log("🔄 [PAYMENT] Final query invalidation...");
    await qc.invalidateQueries({ queryKey: ["me"] });
    await qc.invalidateQueries({ queryKey: ["payments", "history"] });
    console.log("🏠 [PAYMENT] Navigating back...");
    router.back();
  };

  const depositMutation = useMutation({
    mutationFn: async () => {
      const finalAmount = amount ?? (parseInt(customAmount) || 0);
      console.log(
        "💳 [DEPOSIT] Starting deposit request, amount:",
        finalAmount,
      );

      if (finalAmount < 100) {
        console.log("❌ [DEPOSIT] Amount too low:", finalAmount);
        throw new Error(t("fund_wallet.errors.amount_min"));
      }

      console.log("🌐 [DEPOSIT] Calling backend /api/v1/wallet/deposit...");
      const res = await apiFetch("/api/v1/wallet/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deposit_amount_kobo: finalAmount * 100,
          custom_amount: !AMOUNTS.includes(finalAmount),
        }),
      });

      console.log("📥 [DEPOSIT] Backend response status:", res.status);

      if (!res.ok) {
        const err = await res.json();
        console.error("❌ [DEPOSIT] Backend error:", err);
        throw new Error(err.detail || t("fund_wallet.errors.deposit_failed"));
      }

      const data = await res.json();
      console.log("✅ [DEPOSIT] Backend success, response:", data);
      console.log("   Payment URL:", data.payment_url);
      console.log("   Reference:", data.reference);
      console.log("   Amount:", data.amount_kobo);

      // Show "Payment initiated" alert
      Alert.alert(
        t("fund_wallet.payment_initiated_title"),
        t("fund_wallet.payment_initiated_body"),
        [{ text: t("premium.ok") }],
      );

      return data as DepositResponse;
    },
    onSuccess: async (data) => {
      console.log("🚀 [DEPOSIT] Opening in-app payment...");
      try {
        await initializePayment({
          email: (await apiFetch("/api/v1/auth/me").then(r => r.json())).email,
          amount: data.amount_kobo,
          currency: "NGN",
          accessCode: data.access_code,
          reference: data.reference,
          onSuccess: (tx) => {
            console.log("✅ [DEPOSIT] Payment successful in-app:", tx);
          },
          onCancel: () => {
            console.log("❌ [DEPOSIT] Payment cancelled by user");
          },
          onError: (err) => {
            console.error("❌ [DEPOSIT] Payment error:", err);
          },
        });

        console.log("👤 [DEPOSIT] In-app payment closed");

        console.log(
          "🔍 [DEPOSIT] User returned from payment - checking status...",
        );
        pollPaymentStatus(data.reference);
      } catch (e) {
        console.error("❌ [DEPOSIT] Failed to open in-app payment:", e);
        Alert.alert(
          t("fund_wallet.errors.deposit_failed"),
          t("fund_wallet.could_not_open_payment"),
        );
        return;
      }
    },
    onError: (error: Error) => {
      console.error("❌ [DEPOSIT] Mutation error:", error);
      Alert.alert(t("fund_wallet.errors.deposit_failed"), error.message);
    },
  });

  const finalAmount = amount ?? (parseInt(customAmount) || 0);
  const processingFee =
    finalAmount >= 100 ? Math.min(Math.ceil(finalAmount * 0.015), 2000) : 0;
  const totalPayment = finalAmount + processingFee;
  const canSubmit = finalAmount >= 100;
  const pointsToReceive = finalAmount * 10; // Points based on deposit amount (not including fee)

  return (
    <View
      style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}
    >
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>
            {t("fund_wallet.title")}
          </Text>
        </View>

        {/* Info */}
        <View
          style={[
            styles.infoCard,
            { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
          ]}
        >
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={tokens.mint}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.infoText, { color: tokens.ink }]}>
              {t("fund_wallet.payment_note")}
            </Text>
          </View>
        </View>

        {/* Quick amounts */}
        <Text style={[styles.label, { color: tokens.inkMuted }]}>
          {t("fund_wallet.amount_label")}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {AMOUNTS.map((a) => (
            <TouchableOpacity
              key={a}
              onPress={() => {
                setAmount(a);
                setCustomAmount("");
              }}
              style={[
                styles.amtBtn,
                {
                  backgroundColor: amount === a ? tokens.mint : tokens.card,
                  borderColor: amount === a ? tokens.mint : tokens.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.amtText,
                  { color: amount === a ? tokens.mintText : tokens.ink },
                ]}
              >
                ₦{a.toLocaleString()}
              </Text>
              <Text
                style={[
                  styles.ptsText,
                  { color: amount === a ? tokens.mintText : tokens.mint },
                ]}
              >
                {(a * 10).toLocaleString()} pts
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom amount */}
        <Text style={[styles.label, { color: tokens.inkMuted, marginTop: 8 }]}>
          {t("fund_wallet.custom_amount")}
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
          placeholder={t("fund_wallet.minimum")}
          placeholderTextColor={tokens.inkMuted}
          value={customAmount}
          onChangeText={(text) => {
            setCustomAmount(text);
            setAmount(null);
          }}
          keyboardType="number-pad"
          maxLength={7}
        />

        {/* Summary */}
        {canSubmit && (
          <View
            style={[
              styles.summaryCard,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: tokens.inkMuted }]}>
                {t("fund_wallet.amount_label")}
              </Text>
              <Text style={[styles.summaryValue, { color: tokens.ink }]}>
                ₦{finalAmount.toLocaleString()}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: tokens.inkMuted }]}>
                {t("fund_wallet.processing_fee", { fee: processingFee })}
              </Text>
              <Text style={[styles.summaryValue, { color: tokens.inkMuted }]}>
                ₦{processingFee.toLocaleString()}
              </Text>
            </View>
            <View
              style={[styles.divider, { backgroundColor: tokens.border }]}
            />
            <View style={styles.summaryRow}>
              <Text
                style={[
                  styles.summaryLabel,
                  { color: tokens.ink, fontWeight: "600" },
                ]}
              >
                {t("fund_wallet.total_payment", { total: totalPayment })}
              </Text>
              <Text
                style={[
                  styles.summaryValue,
                  { color: tokens.ink, fontWeight: "700", fontSize: 18 },
                ]}
              >
                ₦{totalPayment.toLocaleString()}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: tokens.mint }]}>
                {t("fund_wallet.youl_receive")}
              </Text>
              <Text
                style={[
                  styles.summaryValue,
                  { color: tokens.mint, fontWeight: "700" },
                ]}
              >
                {pointsToReceive.toLocaleString()} pts
              </Text>
            </View>
            <View
              style={[styles.divider, { backgroundColor: tokens.border }]}
            />
            <Text style={[styles.noteText, { color: tokens.inkMuted }]}>
              {t("fund_wallet.pay_securely_note")}
            </Text>
          </View>
        )}

        {/* Pay button */}
        <TouchableOpacity
          onPress={() => depositMutation.mutate()}
          disabled={!canSubmit || depositMutation.isPending || checkingPayment || paystackLoading}
          style={[
            styles.payBtn,
            {
              backgroundColor: canSubmit ? tokens.mint : tokens.border,
              opacity: depositMutation.isPending || checkingPayment || paystackLoading ? 0.7 : 1,
            },
          ]}
        >
          {depositMutation.isPending || checkingPayment || paystackLoading ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <ActivityIndicator color={tokens.mintText} />
              {checkingPayment && (
                <Text
                  style={[
                    styles.payText,
                    { color: tokens.mintText, fontSize: 14 },
                  ]}
                >
                  {t("fund_wallet.verifying_payment")}
                </Text>
              )}
              {paystackLoading && !checkingPayment && (
                <Text
                  style={[
                    styles.payText,
                    { color: tokens.mintText, fontSize: 14 },
                  ]}
                >
                  Opening payment...
                </Text>
              )}
            </View>
          ) : (
            <>
              <Ionicons name="card-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.payText, { color: tokens.mintText }]}>
                {canSubmit
                  ? t("fund_wallet.fund_button")
                  : t("fund_wallet.minimum")}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  label: { fontSize: 13, fontWeight: "500" },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  infoText: { fontSize: 13, lineHeight: 18 },
  input: {
    borderRadius: 12,
    padding: 14,
    fontSize: 18,
    fontWeight: "600",
    borderWidth: 1,
  },
  amtBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    minWidth: 110,
  },
  amtText: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  ptsText: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    marginTop: 8,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  summaryLabel: { fontSize: 14 },
  summaryValue: { fontSize: 16, fontWeight: "600" },
  divider: { height: 1, marginVertical: 12 },
  noteText: { fontSize: 12, lineHeight: 16 },
  payBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
  },
  payText: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
});
