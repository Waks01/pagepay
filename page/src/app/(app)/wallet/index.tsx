import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { useCallback, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/shared/api/client";
import { consumePendingWithdrawAfterPin } from "@/src/shared/lib/pin-verify-flag";
import {
  formatKobo,
  formatPoints,
  pointsToNairaString,
  koboToPoints,
} from "@/src/shared/lib/money";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import {
  useCurrentUser,
  useCurrentUserStore,
} from "@/src/shared/lib/current-user";
import { PagePay, Fonts } from "@/constants/theme";
import { PrimaryButton } from "@/components/PrimaryButton";
import { UserAvatar } from "@/components/UserAvatar";
import NotificationBell from "@/components/NotificationBell";
import { WithdrawModal } from "@/components/WithdrawModal";
import {
  LinkPayoutAccountModal,
  type PayoutAccount,
} from "@/components/LinkPayoutAccountModal";
import {
  SkeletonBalanceCard,
} from "@/components/skeletons";

type WithdrawalRecord = {
  reference: string;
  amount_kobo: number;
  fee_kobo: number;
  status: "pending" | "success" | "failed";
  reason: string | null;
  paystack_transfer_code: string | null;
  balance_after_debit: number;
  created_at: string | null;
  settled_at: string | null;
};

type PaymentRecord = {
  id: number;
  tier: string;
  tier_name: string;
  amount_kobo: number;
  amount_naira: number;
  provider: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
};

type WithdrawalResponse = {
  transfer_reference: string;
  status: "pending" | "success" | "failed";
  new_balance_points: number;
  fee_kobo: number;
  amount_kobo: number;
};

const MIN_WITHDRAWAL_POINTS = koboToPoints(100_000); // ₦1,000 minimum → 10,000 points at 10 pts/₦

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function WalletScreen() {
  const scheme = useEffectiveScheme();
  const c = PagePay[scheme];
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ welcomeBonus?: string }>();
  const welcomeBonus = Number(params.welcomeBonus ?? 0);
  const insets = useSafeAreaInsets();

  const payoutQ = useQuery({
    queryKey: ["payout", "account"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/payouts/account");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load payout account");
      return (await res.json()) as PayoutAccount;
    },
    staleTime: 60 * 60 * 1000,
  });

  const payoutAccount = payoutQ.data ?? null;

  // If the user just verified their PIN for a withdrawal, open the
  // withdrawal modal automatically.
  useFocusEffect(
    useCallback(() => {
      if (consumePendingWithdrawAfterPin() && payoutAccount) {
        setShowWithdraw(true);
      }
    }, [payoutAccount]),
  );

  // Read the current user from the global store. The auth gate
  // loads /auth/me exactly once at app start; subsequent renders
  // (including the pull-to-refresh below) read from memory and
  // only hit the network when the user explicitly asks to refresh.
  const meQ = useCurrentUser();
  const userLoading = useCurrentUser((s) => !s.loaded);

  const pinStatusQ = useQuery({
    queryKey: ["pin", "status"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/pin/status");
      if (!res.ok) throw new Error("Failed to load PIN status");
      return (await res.json()) as { has_pin: boolean };
    },
  });

  const withdrawalsQ = useQuery({
    queryKey: ["payouts", "transactions"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/payouts/transactions");
      if (!res.ok) throw new Error("Failed to load withdrawals");
      const body = (await res.json()) as {
        data: WithdrawalRecord[];
        meta: { total: number };
      };
      return body.data;
    },
  });

  const paymentsQ = useQuery({
    queryKey: ["payments", "history"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/payments/history");
      if (!res.ok) throw new Error("Failed to load payments");
      return (await res.json()) as PaymentRecord[];
    },
  });

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showLink, setShowLink] = useState(false);
  // Set to true after a successful withdrawal in this session so the
  // auto-open can fire once the user closes the Link modal.
  const [pendingWithdraw, setPendingWithdraw] = useState(false);

  // Targeted invalidations after write actions only. We removed the old
  // blanket useFocusEffect invalidation that refetched all 5 queries on
  // every tab switch — that was adding ~500ms–1.5s per visit.
  const handleWithdrawn = useCallback(
    (_resp: WithdrawalResponse) => {
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["payouts", "transactions"] });
    },
    [qc],
  );

  const balance = meQ?.points_balance ?? 0;
  const serviceCreditBalance = meQ?.service_credit_balance ?? 0;
  const cashableBalance = meQ?.cashable_balance ?? 0;
  const tier = meQ?.tier ?? "free";
  const getTierLabel = (tier: string) => {
    const key = tier as "free" | "premium_monthly" | "premium_yearly";
    return t(`wallet.tier.${key}`, { defaultValue: tier });
  };
  const withdrawals = withdrawalsQ.data ?? [];
  const belowMin = cashableBalance < MIN_WITHDRAWAL_POINTS;

  const onRefresh = () => {
    // The user object is in the global store — refresh it explicitly
    // (instead of going through TanStack Query's invalidation, which
    // doesn't know about the store). The other wallet queries below
    // are still TanStack-Query-managed and use invalidation.
    void useCurrentUserStore.getState().refresh();
    qc.invalidateQueries({ queryKey: ["payout", "account"] });
    qc.invalidateQueries({ queryKey: ["payouts", "transactions"] });
    qc.invalidateQueries({ queryKey: ["payments", "history"] });
  };

  const handleWithdrawPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!payoutAccount) {
      setPendingWithdraw(true);
      setShowLink(true);
      return;
    }
    if (pinStatusQ.data?.has_pin) {
      router.push("/pin/verify?mode=verify&redirect=/(app)/wallet");
      return;
    }
    setShowWithdraw(true);
  }, [payoutAccount, pinStatusQ.data, router]);

  const handleLinkSaved = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["payout", "account"] });
    if (pendingWithdraw) {
      setPendingWithdraw(false);
      setShowLink(false);
      // Defer one frame so the Link modal finishes its close animation
      // before the Withdraw modal slides up.
      setTimeout(() => setShowWithdraw(true), 250);
    }
  }, [qc, pendingWithdraw]);

  const handleLinkClose = useCallback(() => {
    setShowLink(false);
    if (pendingWithdraw) {
      setPendingWithdraw(false);
      setShowLink(false);
    }
  }, [pendingWithdraw]);

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: c.card,
            borderBottomColor: c.border,
            marginTop: insets.top,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <UserAvatar size={28} />
          <Text
            style={[
              styles.headerTitle,
              { color: c.ink, fontFamily: Fonts.display },
            ]}
          >
            {t("wallet.title")}
          </Text>
          <NotificationBell />
        </View>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={onRefresh}
            tintColor={c.mint}
          />
        }
      >
        {/* One-time welcome bonus banner */}
        {welcomeBonus > 0 ? (
          <View
            style={{
              backgroundColor: c.mintSoft,
              borderColor: c.mint,
              borderWidth: 1,
              borderRadius: 14,
              padding: 16,
              marginBottom: 16,
              gap: 8,
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Ionicons name="gift" size={22} color={c.mint} />
              <Text
                style={{
                  fontFamily: Fonts.display,
                  fontSize: 16,
                  color: c.ink,
                  flex: 1,
                }}
              >
                {t("verify_email.welcome_title")}
              </Text>
            </View>
            <Text style={{ fontSize: 14, color: c.inkMuted, lineHeight: 20 }}>
              {t("verify_email.welcome_bonus", {
                points: welcomeBonus.toLocaleString(),
                naira: pointsToNairaString(welcomeBonus).replace(/^₦/, ""),
              })}
            </Text>
          </View>
        ) : null}

        {/* Balance card */}
        <View
          style={{
            backgroundColor: c.card,
            borderRadius: 20,
            padding: 28,
            borderWidth: 1,
            borderColor: c.border,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              color: c.inkMuted,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {t("wallet.balance_label")}
          </Text>
          {userLoading ? (
            <SkeletonBalanceCard />
          ) : (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      color: c.inkMuted,
                      textTransform: "uppercase",
                      letterSpacing: 1.2,
                      marginBottom: 4,
                    }}
                  >
                    {t("wallet.service_credits_label")}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "baseline",
                      flexWrap: "wrap",
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: Fonts.display,
                        fontSize: 32,
                        color: c.ink,
                        lineHeight: 36,
                      }}
                    >
                      {formatPoints(serviceCreditBalance)}
                    </Text>
                    <Text
                      style={{
                        fontSize: 13,
                        color: c.inkMuted,
                        marginLeft: 4,
                        fontWeight: "600",
                      }}
                    >
                      {t("wallet.points_suffix")}
                    </Text>
                  </View>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      color: c.inkMuted,
                      textTransform: "uppercase",
                      letterSpacing: 1.2,
                      marginBottom: 4,
                    }}
                  >
                    {t("wallet.cashable_label")}
                  </Text>
                  <Text
                    style={{
                      fontFamily: Fonts.display,
                      fontSize: 32,
                      color: c.mint,
                      lineHeight: 36,
                    }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {pointsToNairaString(cashableBalance)}
                  </Text>
                </View>
              </View>
            </View>
          )}
          <View
            style={{
              height: 1,
              backgroundColor: c.border,
              marginVertical: 16,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 13, color: c.inkMuted }}>
              {getTierLabel(tier)}
            </Text>
            {tier !== "free" && (
              <View
                style={{
                  backgroundColor: c.mint,
                  borderRadius: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 2,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: c.mintText,
                    fontWeight: "700",
                    letterSpacing: 0.3,
                  }}
                >
                  PREMIUM
                </Text>
              </View>
            )}
          </View>

          {userLoading || payoutQ.isLoading ? (
            <ActivityIndicator
              color={c.mint}
              style={{ alignSelf: "flex-start" }}
            />
          ) : (
            <View style={{ gap: 10 }}>
              {/* Fund Wallet Button */}
              <PrimaryButton
                title={t("wallet.fund_wallet")}
                onPress={() => router.push("/fund-wallet")}
              />

              {/* Withdraw Button */}
              {belowMin ? (
                <View style={{ gap: 4 }}>
                  <PrimaryButton
                    title={t("wallet.withdraw")}
                    onPress={handleWithdrawPress}
                    disabled
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      color: c.inkMuted,
                      textAlign: "center",
                    }}
                  >
                    {t("wallet.min_withdraw")}
                  </Text>
                </View>
              ) : (
                <PrimaryButton
                  title={t("wallet.withdraw")}
                  onPress={handleWithdrawPress}
                />
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <WithdrawModal
        visible={showWithdraw}
        balancePoints={cashableBalance}
        payoutAccount={payoutAccount}
        onRequestLink={() => {
          setShowWithdraw(false);
          setPendingWithdraw(true);
          setShowLink(true);
        }}
        onWithdrawn={handleWithdrawn}
        onClose={() => setShowWithdraw(false)}
      />

      <LinkPayoutAccountModal
        visible={showLink}
        current={payoutAccount}
        onClose={handleLinkClose}
        onSaved={() => {
          handleLinkSaved();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
});
