import { useCallback } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";

import { apiFetch } from "@/src/shared/api/client";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { SkeletonPage } from "@/components/skeletons";
import NotificationBell from "@/components/NotificationBell";
import { PrimaryButton } from "@/components/PrimaryButton";

type Tier = {
  tier: string;
  display_name: string;
  price_kobo: number;
  duration_days: number;
  benefits: string[];
};

export default function PremiumScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();
  const [selectedTier, setSelectedTier] = useState<string>("premium_monthly");
  const [checkingPayment, setCheckingPayment] = useState(false);

  const pollSubscriptionStatus = async (reference: string) => {
    console.log(
      "🔍 [PREMIUM] Starting subscription verification for reference:",
      reference,
    );
    setCheckingPayment(true);
    let attempts = 0;

    const checkStatus = async (): Promise<boolean> => {
      try {
        attempts++;
        console.log(`🔄 [PREMIUM] Polling attempt ${attempts}/10...`);

        // Refresh subscription status
        console.log("📊 [PREMIUM] Refetching subscription data...");
        await qc.refetchQueries({ queryKey: ["payments", "subscription"] });
        const status = qc.getQueryData(["payments", "subscription"]) as any;
        console.log("📋 [PREMIUM] Subscription status:", status);

        if (status?.is_premium) {
          console.log(
            "✅ [PREMIUM] Subscription CONFIRMED! User is now premium",
          );
          return true;
        }

        console.log("⏰ [PREMIUM] Not premium yet, continuing...");

        if (attempts < 10) {
          console.log(`⏳ [PREMIUM] Waiting 2s before next attempt...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return checkStatus();
        }

        console.log("⚠️ [PREMIUM] Max attempts reached");
        return false;
      } catch (e) {
        console.error("❌ [PREMIUM] Error during check:", e);
        return false;
      }
    };

    const success = await checkStatus();
    setCheckingPayment(false);

    console.log("🏁 [PREMIUM] Polling complete. Success:", success);

    Alert.alert(
      success ? "🎉 Premium Activated!" : "⏳ Processing Payment",
      success
        ? "Welcome to Premium! Enjoy ad-free reading and 2x earning points."
        : "Your subscription is being activated. This may take a few moments.",
    );

    console.log("🔄 [PREMIUM] Final query invalidation...");
    await qc.invalidateQueries({ queryKey: ["payments", "subscription"] });
    await qc.invalidateQueries({ queryKey: ["me"] });
  };

  const tiersQ = useQuery({
    queryKey: ["payments", "tiers"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/payments/tiers");
      if (!res.ok) throw new Error("Failed to load tiers");
      return res.json() as Promise<Tier[]>;
    },
  });

  const tierInfoQ = useQuery({
    queryKey: ["payments", "subscription"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/payments/subscription");
      if (!res.ok) throw new Error("Failed to load subscription");
      return res.json() as Promise<any>;
    },
  });

  const handleSelectTier = (tierId: string) => {
    setSelectedTier(tierId);
  };

  const handleUpgrade = async (tier: string) => {
    console.log("💳 [PREMIUM] Starting subscription upgrade, tier:", tier);
    try {
      console.log("🌐 [PREMIUM] Calling backend /api/v1/payments/initiate...");
      const res = await apiFetch("/api/v1/payments/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, provider: "paystack" }),
      });

      console.log("📥 [PREMIUM] Backend response status:", res.status);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        console.error("❌ [PREMIUM] Backend error:", err);
        throw new Error(err.detail || "Initiation failed");
      }

      const data = await res.json();
      console.log("✅ [PREMIUM] Backend success, response:", data);
      console.log("   Payment URL:", data.payment_url);
      console.log("   Reference:", data.provider_tx_ref);

      if (data.payment_url) {
        console.log("🚀 [PREMIUM] Opening payment browser...");

        // Show "Payment Initiated" alert
        Alert.alert(
          "💳 Subscription Payment Initiated",
          "Opening payment page... Complete the payment and return to activate your subscription.",
          [{ text: "OK" }],
        );

        const result = await WebBrowser.openBrowserAsync(data.payment_url, {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
        });

        console.log("👤 [PREMIUM] Browser closed, result:", result);

        // After payment browser closes, poll for subscription activation
        if (result.type === "dismiss" || result.type === "cancel") {
          console.log(
            "🔍 [PREMIUM] User returned from payment - checking status...",
          );
          await pollSubscriptionStatus(data.provider_tx_ref);
        } else {
          console.log(
            "⚠️ [PREMIUM] Unexpected browser result type:",
            result.type,
          );
          qc.invalidateQueries({ queryKey: ["payments", "subscription"] });
        }
      }
    } catch (e) {
      console.error("❌ [PREMIUM] Upgrade error:", e);
      const message =
        e instanceof Error ? e.message : t("premium.payment_error");
      Alert.alert(t("premium.payment_error"), message);
    }
  };

  const tiers = tiersQ.data ?? [];
  const userTier = tierInfoQ.data;
  const isPremium = userTier?.is_premium ?? false;

  if (tiersQ.isLoading) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={{ flex: 1, backgroundColor: tokens.paper }}
      >
        <View
          style={[
            styles.header,
            { backgroundColor: tokens.card, borderBottomColor: tokens.border },
          ]}
        >
          <View style={styles.headerRow}>
            <Image
              source={require("@/assets/images/icon.png")}
              style={styles.headerIcon}
            />
            <Text
              style={[
                styles.headerTitle,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {t("premium.title")}
            </Text>
            <NotificationBell />
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <SkeletonPage count={3} header={false} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (tiersQ.error) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={{
          flex: 1,
          backgroundColor: tokens.paper,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <View
          style={[
            styles.header,
            { backgroundColor: tokens.card, borderBottomColor: tokens.border },
          ]}
        >
          <View style={styles.headerRow}>
            <Image
              source={require("@/assets/images/icon.png")}
              style={styles.headerIcon}
            />
            <Text
              style={[
                styles.headerTitle,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {t("premium.title")}
            </Text>
            <NotificationBell />
          </View>
        </View>
        <Ionicons name="alert-circle-outline" size={48} color={tokens.error} />
        <Text style={[styles.errorTitle, { color: tokens.ink }]}>
          {t("premium.load_error")}
        </Text>
        <Text style={[styles.errorText, { color: tokens.inkMuted }]}>
          {tiersQ.error instanceof Error
            ? tiersQ.error.message
            : t("premium.connection_error")}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => tiersQ.refetch()}
        >
          <Text style={[styles.retryText, { color: tokens.mint }]}>
            {t("premium.retry")}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: tokens.paper }}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: tokens.card, borderBottomColor: tokens.border },
        ]}
      >
        <View style={styles.headerRow}>
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.headerIcon}
          />
          <Text
            style={[
              styles.headerTitle,
              { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
            ]}
          >
            {t("premium.title")}
          </Text>
          <NotificationBell />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {isPremium && userTier ? (
          <View
            style={[
              styles.currentTierBadge,
              { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
            ]}
          >
            <Ionicons name="checkmark-circle" size={20} color={tokens.mint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.badgeTitle, { color: tokens.mint }]}>
                {t("premium.active_subscription")}
              </Text>
              <Text style={[styles.badgeSubtitle, { color: tokens.inkMuted }]}>
                {userTier.tier_name} •{" "}
                {userTier.days_remaining !== null && userTier.days_remaining > 0
                  ? t("premium.days_remaining", {
                      days: userTier.days_remaining,
                    })
                  : t("premium.active")}
              </Text>
            </View>
          </View>
        ) : null}

        {tierInfoQ.isLoading ? (
          <ActivityIndicator
            color={tokens.mint}
            style={{ paddingVertical: 24 }}
          />
        ) : tierInfoQ.error ? (
          <View
            style={[
              styles.errorCard,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color={tokens.error}
            />
            <Text style={[styles.errorCardText, { color: tokens.ink }]}>
              {tierInfoQ.error instanceof Error
                ? tierInfoQ.error.message
                : t("premium.subscription_error")}
            </Text>
            <TouchableOpacity onPress={() => tierInfoQ.refetch()}>
              <Text style={[styles.retryText, { color: tokens.mint }]}>
                {t("premium.retry")}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.tiersContainer}>
            {tiers.map((tier) => (
              <TouchableOpacity
                key={tier.tier}
                onPress={() => handleSelectTier(tier.tier)}
                activeOpacity={0.7}
                style={[
                  styles.tierCard,
                  {
                    backgroundColor:
                      selectedTier === tier.tier
                        ? tokens.mintSoft
                        : tokens.card,
                    borderColor:
                      selectedTier === tier.tier ? tokens.mint : tokens.border,
                    borderWidth: selectedTier === tier.tier ? 2 : 1,
                  },
                ]}
              >
                <View style={styles.tierHeader}>
                  <Text style={[styles.tierName, { color: tokens.ink }]}>
                    {tier.display_name}
                  </Text>
                  <Text style={[styles.tierPrice, { color: tokens.mint }]}>
                    ₦{(tier.price_kobo / 100).toLocaleString()}
                  </Text>
                </View>

                <Text style={[styles.tierDuration, { color: tokens.inkMuted }]}>
                  {tier.duration_days} {t("premium.days_suffix")}
                </Text>

                <View style={styles.benefits}>
                  {tier.benefits.map((benefit, idx) => (
                    <View key={idx} style={styles.benefitRow}>
                      <Ionicons
                        name="checkmark"
                        size={16}
                        color={tokens.mint}
                      />
                      <Text style={[styles.benefitText, { color: tokens.ink }]}>
                        {benefit}
                      </Text>
                    </View>
                  ))}
                </View>

                <View style={styles.button}>
                  <PrimaryButton
                    title={
                      checkingPayment
                        ? t("premium.verifying")
                        : isPremium && userTier?.tier === tier.tier
                          ? t("premium.current_plan")
                          : t("premium.choose")
                    }
                    onPress={() => handleUpgrade(tier.tier)}
                    disabled={
                      checkingPayment ||
                      (isPremium && userTier?.tier === tier.tier)
                    }
                    loading={checkingPayment}
                  />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Payment History Link */}
        <TouchableOpacity
          onPress={() => router.push("/payment-history")}
          style={[
            styles.historyLink,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <Ionicons name="receipt-outline" size={20} color={tokens.mint} />
          <Text style={[styles.historyLinkText, { color: tokens.mint }]}>
            {t("premium.view_payment_history")}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={tokens.mint} />
        </TouchableOpacity>

        <View
          style={[
            styles.faqSection,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <Text style={[styles.faqTitle, { color: tokens.ink }]}>
            {t("premium.faq_title")}
          </Text>
          <Text style={[styles.faqText, { color: tokens.inkMuted }]}>
            {t("premium.faq_text")}
          </Text>
        </View>
      </ScrollView>

      {/* Verification Overlay */}
      <Modal transparent visible={checkingPayment} animationType="fade">
        <View style={styles.overlay}>
          <View
            style={[
              styles.overlayCard,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <ActivityIndicator size="large" color={tokens.mint} />
            <Text style={[styles.overlayTitle, { color: tokens.ink }]}>
              {t("premium.verifying_payment")}
            </Text>
            <Text style={[styles.overlayText, { color: tokens.inkMuted }]}>
              {t("premium.verifying_subtitle")}
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    gap: 24,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 20,
    letterSpacing: -0.2,
    flex: 1,
    textAlign: "center",
  },
  headline: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  subline: {
    fontSize: 14,
    lineHeight: 20,
  },
  currentTierBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  badgeTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  badgeSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  loading: {
    paddingVertical: 48,
    alignItems: "center",
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 12,
  },
  errorText: {
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  errorCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 8,
    alignItems: "center",
  },
  errorCardText: {
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: "600",
  },
  tiersContainer: {
    gap: 14,
  },
  tierCard: {
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  tierHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tierName: {
    fontSize: 18,
    fontWeight: "600",
  },
  tierPrice: {
    fontSize: 20,
    fontWeight: "700",
  },
  tierDuration: {
    fontSize: 13,
  },
  benefits: {
    gap: 8,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  benefitText: {
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    marginTop: 8,
  },
  faqSection: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  faqTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  faqText: {
    fontSize: 13,
    lineHeight: 18,
  },
  historyLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  historyLinkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  overlayCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 32,
    gap: 16,
    alignItems: "center",
    minWidth: 280,
    maxWidth: 320,
  },
  overlayTitle: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  overlayText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
