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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { usePaystack } from "expo-paystack";

import { apiFetch } from "@/src/shared/api/client";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { SkeletonPage } from "@/components/skeletons";
import NotificationBell from "@/components/NotificationBell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { UserAvatar } from "@/components/UserAvatar";
import { PremiumBenefitsComparison } from "@/components/PremiumBenefitsComparison";
import { PremiumBenefitsList } from "@/components/PremiumBenefitsList";
import { EmptyState } from "@/components/EmptyState";
import { NetworkError } from "@/components/NetworkError";

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
  const [selectedTier, setSelectedTier] = useState<string>("premium_monthly");
  const [checkingPayment, setCheckingPayment] = useState(false);

  const tiersQ = useQuery({
    queryKey: ["payments", "tiers"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/payments/tiers");
      if (!res.ok) throw new Error(t("premium.load_tiers_failed"));
      return res.json() as Promise<Tier[]>;
    },
  });

  const tierInfoQ = useQuery({
    queryKey: ["payments", "subscription"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/payments/subscription");
      if (!res.ok) throw new Error(t("premium.load_subscription_failed"));
      return res.json() as Promise<any>;
    },
  });

  const handleSelectTier = (tierId: string) => {
    setSelectedTier(tierId);
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
            <UserAvatar size={28} />
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
        style={{ flex: 1, backgroundColor: tokens.paper }}
      >
        <View
          style={[
            styles.header,
            { backgroundColor: tokens.card, borderBottomColor: tokens.border },
          ]}
        >
          <View style={styles.headerRow}>
            <UserAvatar size={28} />
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
        <NetworkError
          title={t("premium.load_error")}
          message={
            tiersQ.error instanceof Error
              ? tiersQ.error.message
              : t("premium.connection_error")
          }
          retryLabel={t("premium.retry")}
          onRetry={() => tiersQ.refetch()}
        />
      </SafeAreaView>
    );
  }

  return (
    <PremiumBody
      t={t}
      tokens={tokens}
      tiers={tiers}
      userTier={userTier}
      isPremium={isPremium}
      tierInfoLoading={tierInfoQ.isLoading}
      tierInfoError={tierInfoQ.error as Error | null}
      refetchTierInfo={() => tierInfoQ.refetch()}
      selectedTier={selectedTier}
      setSelectedTier={setSelectedTier}
      checkingPayment={checkingPayment}
      setCheckingPayment={setCheckingPayment}
      handleSelectTier={handleSelectTier}
    />
  );
}

/**
 * `PremiumBody` is rendered only after `PremiumScreen` resolves the
 * `tiers` query. It owns the `usePaystack()` hook so the parent
 * `PremiumScreen` module never throws on first render — `usePaystack`
 * requires a `<PaystackProvider>` in scope, and isolating the hook here
 * guarantees the route module evaluates cleanly even before the
 * provider is mounted (e.g. during HMR or a fast-refresh stall).
 */
function PremiumBody({
  t,
  tokens,
  tiers,
  userTier,
  isPremium,
  tierInfoLoading,
  tierInfoError,
  refetchTierInfo,
  selectedTier,
  setSelectedTier,
  checkingPayment,
  setCheckingPayment,
  handleSelectTier,
}: {
  t: ReturnType<typeof useTranslation>["t"];
  tokens: (typeof PagePay)["light"];
  tiers: Tier[];
  userTier: any;
  isPremium: boolean;
  tierInfoLoading: boolean;
  tierInfoError: Error | null;
  refetchTierInfo: () => void;
  selectedTier: string;
  setSelectedTier: (v: string) => void;
  checkingPayment: boolean;
  setCheckingPayment: (v: boolean) => void;
  handleSelectTier: (tierId: string) => void;
}) {
  const qc = useQueryClient();
  const { initializePayment, isLoading: paystackLoading } = usePaystack();

  const refreshSubscriptionData = async (delay: number = 3000) => {
    setTimeout(async () => {
      console.log("🔄 [PREMIUM] Refreshing subscription data...");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["payments", "subscription"] }),
        qc.invalidateQueries({ queryKey: ["payments", "history"] }),
        qc.invalidateQueries({ queryKey: ["me"] }),
      ]);
      console.log("✅ [PREMIUM] Subscription data refreshed");
    }, delay);
  };

  const handleUpgrade = async (tier: string) => {
    console.log("💳 [PREMIUM] Starting subscription upgrade, tier:", tier);
    setCheckingPayment(false);

    /*
     * WEBHOOK-DRIVEN PAYMENT FLOW:
     * 1. Frontend initiates payment via /api/v1/payments/initiate
     * 2. Frontend opens Paystack modal for user interaction
     * 3. Paystack processes payment and sends webhook to backend
     * 4. Backend webhook handles all payment status updates (success/cancel/error)
     * 5. Frontend simply refreshes data to reflect webhook processing
     *
     * This approach eliminates race conditions and ensures reliable payment handling.
     */

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
        throw new Error(err.detail || t("premium.initiation_failed"));
      }

      const data = await res.json();
      console.log("✅ [PREMIUM] Backend success, response:", data);
      console.log("   Payment URL:", data.payment_url);
      console.log("   Access code:", data.access_code);
      console.log("   Reference:", data.provider_tx_ref);

      if (data.access_code) {
        console.log("🚀 [PREMIUM] Opening in-app payment...");

        const meRes = await apiFetch("/api/v1/auth/me");
        const meData = meRes.ok ? await meRes.json() : {};
        const userEmail = meData?.email || "";

        await initializePayment({
          email: userEmail,
          amount: data.amount_kobo,
          currency: "NGN",
          accessCode: data.access_code,
          reference: data.provider_tx_ref,
          onSuccess: (tx) => {
            console.log("✅ [PREMIUM] Payment successful in-app:", tx);
            // Show immediate success feedback
            Alert.alert(
              t("premium.payment_success_title", "Payment Successful!"),
              t(
                "premium.payment_success_body",
                "Your payment was successful. Your premium subscription will be activated shortly.",
              ),
              [{ text: t("premium.ok") }],
            );
            // Webhook will handle the subscription activation
            // Refresh subscription data after a short delay to allow webhook processing
            refreshSubscriptionData(3000);
          },
          onCancel: async () => {
            console.log("❌ [PREMIUM] Payment cancelled by user");
            // Call backend to update payment status since Paystack may not send webhook
            try {
              const cancelUrl = `/api/v1/payments/status/${data.provider_tx_ref}/cancel`;
              console.log(
                "🔄 [PREMIUM] Updating payment status to cancelled...",
              );
              console.log("🔗 [PREMIUM] Cancel URL:", cancelUrl);
              console.log("📝 [PREMIUM] Reference:", data.provider_tx_ref);
              const cancelRes = await apiFetch(cancelUrl, {
                method: "POST",
              });
              console.log(
                "📥 [PREMIUM] Cancel response status:",
                cancelRes.status,
              );
              if (cancelRes.ok) {
                const responseData = await cancelRes.json();
                console.log("✅ [PREMIUM] Payment status updated to cancelled");
                console.log("📄 [PREMIUM] Response data:", responseData);
              } else {
                const errorText = await cancelRes.text();
                console.error(
                  "❌ [PREMIUM] Failed to update cancel status:",
                  cancelRes.status,
                  cancelRes.statusText,
                );
                console.error("📄 [PREMIUM] Error response:", errorText);
              }
            } catch (err) {
              console.error("❌ [PREMIUM] Error updating cancel status:", err);
            }

            Alert.alert(
              t("premium.payment_cancelled_title", "Payment Cancelled"),
              t(
                "premium.payment_cancelled_body",
                "You cancelled the payment. Complete your payment anytime to activate your subscription.",
              ),
            );
            // Refresh data to reflect cancellation status
            refreshSubscriptionData(1000);
          },
          onError: async (err) => {
            console.error("❌ [PREMIUM] Payment error:", err);
            // Call backend to update payment status since Paystack may not send webhook
            try {
              console.log("🔄 [PREMIUM] Updating payment status to failed...");
              const failRes = await apiFetch(
                `/api/v1/payments/status/${data.provider_tx_ref}/fail`,
                {
                  method: "POST",
                },
              );
              if (failRes.ok) {
                console.log("✅ [PREMIUM] Payment status updated to failed");
              } else {
                console.error(
                  "❌ [PREMIUM] Failed to update error status:",
                  failRes.status,
                  failRes.statusText,
                );
              }
            } catch (err) {
              console.error("❌ [PREMIUM] Error updating error status:", err);
            }

            Alert.alert(
              t("premium.payment_error_title", "Payment Failed"),
              t(
                "premium.payment_error_body",
                "Something went wrong during payment. Please try again.",
              ),
            );
            // Refresh data to reflect error status
            refreshSubscriptionData(1000);
          },
        });

        console.log("👤 [PREMIUM] Payment modal closed");
      }
    } catch (e) {
      console.error("❌ [PREMIUM] Upgrade error:", e);
      const message =
        e instanceof Error ? e.message : t("premium.payment_error");
      Alert.alert(t("premium.payment_error"), message);
    }
  };

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
          <UserAvatar size={28} />
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

        {tierInfoLoading ? (
          <ActivityIndicator
            color={tokens.mint}
            style={{ paddingVertical: 24 }}
          />
        ) : tierInfoError ? (
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
              {tierInfoError instanceof Error
                ? tierInfoError.message
                : t("premium.subscription_error")}
            </Text>
            <TouchableOpacity onPress={refetchTierInfo}>
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
                      isPremium && userTier?.tier === tier.tier
                        ? t("premium.current_plan")
                        : t("premium.choose")
                    }
                    onPress={() => handleUpgrade(tier.tier)}
                    disabled={isPremium && userTier?.tier === tier.tier}
                    loading={paystackLoading}
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
});
