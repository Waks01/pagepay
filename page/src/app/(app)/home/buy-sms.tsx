import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { apiFetch } from "@/src/shared/api/client";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PagePay } from "@/constants/theme";
import {
  SectionCard,
  ConfirmModal,
  ErrorBanner,
  BuyScreenSkeleton,
} from "@/src/components/bills";
import { DiscountSlider } from "@/src/components/bills/DiscountSlider";
import { ConfirmPurchaseModal } from "@/src/components/bills/ConfirmPurchaseModal";
import { ShortfallModal } from "@/src/components/bills/ShortfallModal";

type SmsPricing = {
  cost_per_page: number;
  normal_chars_per_page: number;
  unicode_chars_per_page: number;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
  job_id: string;
  total_pages: number;
  total_cost: number;
};

const MAX_CHARS = 1000;

export default function BuySmsScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [senderName, setSenderName] = useState("");
  const [recipients, setRecipients] = useState("");
  const [message, setMessage] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  // SV Discount states
  const [applySvDiscountAmount, setApplySvDiscountAmount] = useState(0);
  const [showShortfallModal, setShowShortfallModal] = useState(false);
  const [shortfallSv, setShortfallSv] = useState(0);

  const pricingQ = useQuery({
    queryKey: ["sms-pricing"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/bills/sms/pricing");
      if (!res.ok) throw new Error(t("bills.sms.load_error"));
      return (await res.json()) as SmsPricing;
    },
  });

  const recipientList = useMemo(() => {
    return recipients
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
  }, [recipients]);

  const estimate = useMemo(() => {
    const pricing = pricingQ.data;
    if (!pricing || recipientList.length === 0 || !message) {
      return { pages: 0, cost: 0 };
    }
    const charsPerPage = pricing.normal_chars_per_page || 160;
    const pages = Math.max(1, Math.ceil(message.length / charsPerPage));
    const cost = pricing.cost_per_page * pages * recipientList.length;
    return { pages, cost };
  }, [pricingQ.data, recipientList, message]);

  // Fetch user profile for service credit balance
  const profileQ = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/me");
      if (!res.ok) throw new Error("Failed to load profile");
      return (await res.json()) as {
        service_credit_balance: number;
        cashable_balance: number;
        points_balance: number;
      };
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!senderName.trim()) throw new Error(t("bills.sms.enter_sender"));
      if (recipientList.length === 0)
        throw new Error(t("bills.sms.enter_recipients"));
      if (!message.trim()) throw new Error(t("bills.sms.enter_message"));
      const res = await apiFetch("/api/v1/bills/sms/send", {
        method: "POST",
        body: JSON.stringify({
          sender_name: senderName.trim(),
          recipients: recipientList,
          message: message.trim(),
          apply_sv_discount: applySvDiscountAmount,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t("bills.sms.send_failed"));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["me"] });
      setShowConfirmModal(false);
      Alert.alert(
        t("bills.sms.success_title"),
        t("bills.sms.success_message", {
          pages: data.total_pages,
          recipients: recipientList.length,
          job: data.job_id,
        }),
        [{ text: t("bills.sms.done"), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      setShowConfirmModal(false);
      setPurchaseError(error.message);
    },
  });

  const canSubmit =
    senderName.trim().length > 0 &&
    recipientList.length > 0 &&
    message.trim().length > 0;
  const estPoints = estimate.cost
    ? Math.floor(estimate.cost * 0.018 * 0.67 * 10)
    : 0;

  const handleBuyPress = () => {
    if (!canSubmit) return;
    setPurchaseError(null);

    // Check SV shortfall
    if (
      applySvDiscountAmount > 0 &&
      applySvDiscountAmount > userServiceCreditBalance
    ) {
      const shortfall = applySvDiscountAmount - userServiceCreditBalance;
      setShortfallSv(shortfall);
      setShowShortfallModal(true);
      return;
    }

    setShowConfirmModal(true);
  };

  // Initial-load gate: the form needs the SMS pricing catalog before the
  // units/amount sections are usable.
  if (pricingQ.isLoading || profileQ.isLoading) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <BuyScreenSkeleton sections={3} />
      </View>
    );
  }

  const userServiceCreditBalance = profileQ.data?.service_credit_balance || 0;
  const userCashableBalance = profileQ.data?.cashable_balance || 0;

  // Pull-to-refresh: refetch the SMS pricing catalog.
  const onRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["sms-pricing"] });
  }, [qc]);

  return (
    <View
      style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={pricingQ.isFetching}
            onRefresh={onRefresh}
            tintColor={tokens.mint}
          />
        }
      >
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>
            {t("bills.sms.title")}
          </Text>
        </View>

        {/* SECTION 1: Sender Name */}
        <SectionCard label={t("bills.sms.sender")}>
          <View style={{ position: "relative" }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: tokens.paper,
                  color: tokens.ink,
                  borderColor:
                    senderName.trim().length > 0 ? tokens.mint : tokens.border,
                },
              ]}
              placeholder={t("bills.sms.sender_placeholder")}
              placeholderTextColor={tokens.inkMuted}
              value={senderName}
              onChangeText={setSenderName}
              maxLength={20}
            />
            {senderName.trim().length > 0 && (
              <View style={styles.inputIconValid}>
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={tokens.mint}
                />
              </View>
            )}
          </View>
        </SectionCard>

        {/* SECTION 2: Recipients */}
        <SectionCard
          label={t("bills.sms.recipients")}
          accessory={
            recipientList.length > 0 ? (
              <Text style={{ color: tokens.inkMuted, fontSize: 11 }}>
                {recipientList.length === 1
                  ? t("bills.sms.recipient_count_one", {
                      count: recipientList.length,
                    })
                  : t("bills.sms.recipient_count_other", {
                      count: recipientList.length,
                    })}
              </Text>
            ) : undefined
          }
        >
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: tokens.paper,
                color: tokens.ink,
                borderColor:
                  recipientList.length > 0 ? tokens.mint : tokens.border,
              },
            ]}
            placeholder={t("bills.sms.recipients_placeholder")}
            placeholderTextColor={tokens.inkMuted}
            value={recipients}
            onChangeText={setRecipients}
            keyboardType="numbers-and-punctuation"
            multiline
          />
        </SectionCard>

        {/* SECTION 3: Message */}
        <SectionCard
          label={t("bills.sms.message")}
          accessory={
            <Text style={{ color: tokens.inkMuted, fontSize: 11 }}>
              {message.length} / {MAX_CHARS}
            </Text>
          }
        >
          <TextInput
            style={[
              styles.textarea,
              {
                backgroundColor: tokens.paper,
                color: tokens.ink,
                borderColor:
                  message.trim().length > 0 ? tokens.mint : tokens.border,
              },
            ]}
            placeholder={t("bills.sms.message_placeholder")}
            placeholderTextColor={tokens.inkMuted}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={6}
            maxLength={MAX_CHARS}
          />
        </SectionCard>

        {/* SECTION 4: Estimate Summary */}
        {estimate.cost > 0 && (
          <SectionCard>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
                {t("bills.sms.pages_label")}
              </Text>
              <Text style={[styles.summaryValue, { color: tokens.ink }]}>
                {estimate.pages}
              </Text>
            </View>
            <View
              style={[
                styles.summaryDivider,
                { backgroundColor: tokens.border },
              ]}
            />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
                {t("bills.sms.recipients_label")}
              </Text>
              <Text style={[styles.summaryValue, { color: tokens.ink }]}>
                {recipientList.length}
              </Text>
            </View>
            <View
              style={[
                styles.summaryDivider,
                { backgroundColor: tokens.border },
              ]}
            />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
                {t("bills.sms.estimated_cost")}
              </Text>
              <Text
                style={[
                  styles.summaryValue,
                  { color: tokens.mint, fontWeight: "700" },
                ]}
              >
                ₦{estimate.cost.toLocaleString()}
              </Text>
            </View>
            <View
              style={[
                styles.summaryDivider,
                { backgroundColor: tokens.border },
              ]}
            />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
                {t("bills.sms.earn_label")}
              </Text>
              <Text
                style={[
                  styles.summaryValue,
                  { color: tokens.mint, fontWeight: "700" },
                ]}
              >
                +{estPoints} pts
              </Text>
            </View>
          </SectionCard>
        )}

        {/* SV Discount Slider */}
        {estimate.cost >= 100 && (
          <DiscountSlider
            productPriceKobo={estimate.cost * 100}
            userServiceCreditBalance={userServiceCreditBalance}
            maxDiscountPercent={25}
            onDiscountChange={(svAmount) => {
              setApplySvDiscountAmount(svAmount);
            }}
          />
        )}

        {/* Send button */}
        <TouchableOpacity
          onPress={handleBuyPress}
          disabled={!canSubmit || purchaseMutation.isPending}
          style={[
            styles.payBtn,
            {
              backgroundColor: canSubmit ? tokens.mint : tokens.border,
              opacity: purchaseMutation.isPending ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="send-outline" size={20} color={tokens.mintText} />
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {estimate.cost > 0
              ? t("bills.sms.send_button_with_cost", { cost: estimate.cost })
              : t("bills.sms.fill_details")}
          </Text>
        </TouchableOpacity>

        <ErrorBanner
          message={purchaseError ?? ""}
          onDismiss={() => setPurchaseError(null)}
        />

        <ConfirmPurchaseModal
          visible={showConfirmModal}
          productType="Bulk SMS"
          productDetails={`${recipientList.length} recipients · ${estimate.pages} pages`}
          totalKobo={estimate.cost * 100}
          cashPaymentKobo={estimate.cost * 100 - applySvDiscountAmount * 10}
          svDiscountSv={applySvDiscountAmount}
          commissionSv={estPoints}
          newCashableBalance={
            userCashableBalance -
            (estimate.cost * 100 - applySvDiscountAmount * 10)
          }
          newServiceCreditBalance={
            userServiceCreditBalance - applySvDiscountAmount + estPoints
          }
          onConfirm={() => purchaseMutation.mutate()}
          onCancel={() => setShowConfirmModal(false)}
        />

        <ShortfallModal
          visible={showShortfallModal}
          shortfallSv={shortfallSv}
          onCancel={() => {
            setShowShortfallModal(false);
            setApplySvDiscountAmount(0);
          }}
        />
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
  input: {
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    fontWeight: "600",
    borderWidth: 1,
  },
  inputIconValid: {
    position: "absolute",
    right: 12,
    top: 14,
  },
  textarea: {
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    fontWeight: "500",
    borderWidth: 1,
    minHeight: 120,
    textAlignVertical: "top",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  summaryKey: { fontSize: 14, fontWeight: "500" },
  summaryValue: { fontSize: 14, fontWeight: "600" },
  summaryDivider: { height: 1 },
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
