import { useState, useCallback } from "react";
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
  EarnBadge,
  ErrorBanner,
  BuyScreenSkeleton,
} from "@/src/components/bills";
import { DiscountSlider } from "@/src/components/bills/DiscountSlider";
import { ConfirmPurchaseModal } from "@/src/components/bills/ConfirmPurchaseModal";
import { ShortfallModal } from "@/src/components/bills/ShortfallModal";

type Biller = {
  code: string;
  name: string;
  min_amount: number;
  max_amount: number;
};

type Product = {
  id: number;
  name: string;
  amount: number;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
  transaction_id: string;
  status_detail: string;
};

type ValidateResult = {
  customer_name?: string | null;
  validation_reference?: string | null;
  requires_validation_ref?: boolean | null;
  [key: string]: unknown;
};

export default function BuyBettingScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [biller, setBiller] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [validatedName, setValidatedName] = useState<string | null>(null);
  const [validationRef, setValidationRef] = useState<string | null>(null);
  const [requiresValidationRef, setRequiresValidationRef] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  // SV Discount states
  const [applySvDiscountAmount, setApplySvDiscountAmount] = useState(0);
  const [showShortfallModal, setShowShortfallModal] = useState(false);
  const [shortfallSv, setShortfallSv] = useState(0);

  const billersQ = useQuery({
    queryKey: ["betting-billers"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/bills/betting/billers");
      if (!res.ok) throw new Error(t("bills.betting.load_error"));
      return (await res.json()) as Biller[];
    },
  });

  const productsQ = useQuery({
    queryKey: ["betting-products", biller],
    queryFn: async () => {
      if (!biller) return [];
      const res = await apiFetch(
        `/api/v1/bills/betting/products?biller_code=${biller}`,
      );
      if (!res.ok) throw new Error(t("bills.betting.load_products_error"));
      return (await res.json()) as Product[];
    },
    enabled: !!biller,
  });

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

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!biller || !accountNumber)
        throw new Error(t("bills.betting.select_biller_account"));
      const res = await apiFetch("/api/v1/bills/betting/validate", {
        method: "POST",
        body: JSON.stringify({
          biller_code: biller,
          account_number: accountNumber,
        }),
      });
      if (!res.ok) throw new Error(t("bills.betting.validation_failed"));
      return (await res.json()) as ValidateResult;
    },
    onSuccess: (data) => {
      setValidatedName(data.customer_name ?? null);
      setValidationRef(data.validation_reference ?? null);
      setRequiresValidationRef(Boolean(data.requires_validation_ref));
      if (data.customer_name && !customerName)
        setCustomerName(String(data.customer_name));
    },
    onError: () => {
      setValidatedName(null);
      setValidationRef(null);
      setRequiresValidationRef(false);
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!biller) throw new Error(t("bills.betting.select_platform"));
      if (!accountNumber) throw new Error(t("bills.betting.enter_account"));
      if (!selectedProduct) throw new Error(t("bills.betting.amount_required"));
      const res = await apiFetch("/api/v1/bills/betting", {
        method: "POST",
        body: JSON.stringify({
          biller_code: biller,
          account_number: accountNumber,
          amount_naira: selectedProduct,
          customer_name: customerName || validatedName || "",
          apply_sv_discount: applySvDiscountAmount,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t("bills.betting.purchase_failed"));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["me"] });
      setShowConfirmModal(false);
      Alert.alert(
        t("bills.betting.success_title"),
        t("bills.betting.success_message", {
          platform: billersQ.data?.find((b) => b.code === biller)?.name,
          tx: data.transaction_id,
        }),
        [{ text: t("bills.betting.done"), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      setShowConfirmModal(false);
      setPurchaseError(error.message);
    },
  });

  const selectedBiller = billersQ.data?.find((b) => b.code === biller);
  const amountNum = selectedProduct ? parseInt(selectedProduct, 10) : 0;
  const canSubmit = !!biller && accountNumber.length >= 3 && !!selectedProduct;

  const quickAmounts = [100, 500, 1000, 5000, 10000, 50000].filter(
    (a) =>
      !selectedBiller ||
      (a >= selectedBiller.min_amount && a <= selectedBiller.max_amount),
  );

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

  // Initial-load gate: the form needs the billers catalog before the
  // platform/account sections are usable. productsQ only fetches once a
  // biller is selected, so it isn't part of the first-paint gate.
  if (billersQ.isLoading || profileQ.isLoading) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <BuyScreenSkeleton sections={3} />
      </View>
    );
  }

  const userServiceCreditBalance = profileQ.data?.service_credit_balance || 0;
  const userCashableBalance = profileQ.data?.cashable_balance || 0;

  // Pull-to-refresh: refetch the billers catalog.
  const onRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["betting-billers"] });
  }, [qc]);

  return (
    <View
      style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={billersQ.isFetching}
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
            {t("bills.betting.title")}
          </Text>
        </View>

        {/* SECTION 1: Platform (horizontal scroll chips) */}
        <SectionCard label={t("bills.betting.platform")}>
          {billersQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : billersQ.isError ? (
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
                name="alert-circle-outline"
                size={20}
                color={tokens.signal}
              />
              <Text style={[styles.errorText, { color: tokens.signal }]}>
                {t("bills.betting.load_error")}
              </Text>
              <TouchableOpacity
                onPress={() => billersQ.refetch()}
                style={styles.retryBtn}
              >
                <Text style={[styles.retryText, { color: tokens.mint }]}>
                  {t("common.retry")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (billersQ.data ?? []).length === 0 ? (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t("bills.betting.no_platforms")}
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {(billersQ.data ?? []).map((b) => {
                const isActive = biller === b.code;
                return (
                  <TouchableOpacity
                    key={b.code}
                    onPress={() => {
                      setBiller(b.code);
                      setSelectedProduct(null);
                      setValidatedName(null);
                      setValidationRef(null);
                      setRequiresValidationRef(false);
                    }}
                    style={[
                      styles.segmentChip,
                      {
                        backgroundColor: isActive ? tokens.mint : tokens.paper,
                        borderColor: isActive ? tokens.mint : tokens.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentChipText,
                        { color: isActive ? tokens.mintText : tokens.ink },
                      ]}
                    >
                      {b.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </SectionCard>

        {/* SECTION 2: Account + Validate */}
        <SectionCard label={t("bills.betting.account")}>
          <View style={{ position: "relative" }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: tokens.paper,
                  color: tokens.ink,
                  borderColor:
                    accountNumber.length >= 3 ? tokens.mint : tokens.border,
                },
              ]}
              placeholder={t("bills.betting.account_placeholder")}
              placeholderTextColor={tokens.inkMuted}
              value={accountNumber}
              onChangeText={(text) => {
                setAccountNumber(text);
                setValidatedName(null);
                setValidationRef(null);
                setRequiresValidationRef(false);
              }}
              maxLength={20}
            />
            {validatedName && (
              <View style={styles.inputIconValid}>
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={tokens.mint}
                />
              </View>
            )}
          </View>

          <TouchableOpacity
            onPress={() => validateMutation.mutate()}
            disabled={
              !biller || accountNumber.length < 3 || validateMutation.isPending
            }
            style={[
              styles.validateBtn,
              {
                backgroundColor: tokens.mintSoft,
                borderColor: tokens.mint,
                opacity:
                  !biller ||
                  accountNumber.length < 3 ||
                  validateMutation.isPending
                    ? 0.5
                    : 1,
              },
            ]}
          >
            {validateMutation.isPending ? (
              <ActivityIndicator size="small" color={tokens.mint} />
            ) : (
              <>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={16}
                  color={tokens.mint}
                />
                <Text style={[styles.validateText, { color: tokens.mint }]}>
                  {t("bills.betting.validate_account_button")}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {validatedName && (
            <View style={{ marginTop: 8, gap: 2 }}>
              <Text
                style={{ color: tokens.mint, fontSize: 13, fontWeight: "600" }}
              >
                ✓ {validatedName}
              </Text>
              {validationRef && (
                <Text style={{ color: tokens.inkMuted, fontSize: 11 }}>
                  {t("bills.betting.validation_ref_label", {
                    ref: validationRef,
                  })}
                </Text>
              )}
              {requiresValidationRef && (
                <Text
                  style={{
                    color: tokens.signal,
                    fontSize: 11,
                    fontWeight: "600",
                  }}
                >
                  {t("bills.betting.requires_validation_ref")}
                </Text>
              )}
              <Text
                style={{
                  color: tokens.inkMuted,
                  fontSize: 10,
                  fontStyle: "italic",
                }}
              >
                {t("bills.betting.verified_via")}
              </Text>
            </View>
          )}
        </SectionCard>

        {/* SECTION 3: Amount (3-col grid) + custom */}
        <SectionCard
          label={t("bills.betting.amount")}
          accessory={
            amountNum > 0 ? (
              <EarnBadge points={Math.floor(amountNum * 0.018 * 0.67 * 10)} />
            ) : undefined
          }
        >
          {selectedBiller && quickAmounts.length > 0 && (
            <View style={styles.amountGrid}>
              {quickAmounts.map((a) => {
                const isActive = selectedProduct === String(a);
                return (
                  <TouchableOpacity
                    key={a}
                    onPress={() => setSelectedProduct(String(a))}
                    style={[
                      styles.amountCard,
                      {
                        backgroundColor: isActive
                          ? tokens.mintSoft
                          : tokens.paper,
                        borderColor: isActive ? tokens.mint : tokens.border,
                      },
                    ]}
                  >
                    {isActive && (
                      <View style={styles.planCheck}>
                        <Ionicons name="checkmark" size={10} color="#fff" />
                      </View>
                    )}
                    <Text style={[styles.amountValue, { color: tokens.ink }]}>
                      ₦{a.toLocaleString()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: tokens.paper,
                color: tokens.ink,
                borderColor:
                  selectedProduct &&
                  parseInt(selectedProduct) >= (selectedBiller?.min_amount ?? 0)
                    ? tokens.mint
                    : tokens.border,
                marginTop: 12,
              },
            ]}
            placeholder={t("bills.betting.custom_amount")}
            placeholderTextColor={tokens.inkMuted}
            value={
              selectedProduct &&
              !quickAmounts.includes(parseInt(selectedProduct))
                ? selectedProduct
                : ""
            }
            onChangeText={(text) => {
              const cleaned = text.replace(/[^0-9]/g, "");
              setSelectedProduct(cleaned || null);
            }}
            keyboardType="number-pad"
            maxLength={10}
          />
        </SectionCard>

        {/* SV Discount Slider */}
        {amountNum >= 100 && (
          <DiscountSlider
            productPriceKobo={amountNum * 100}
            userServiceCreditBalance={userServiceCreditBalance}
            maxDiscountPercent={25}
            onDiscountChange={(svAmount) => {
              setApplySvDiscountAmount(svAmount);
            }}
          />
        )}

        {/* Pay button */}
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
          <Ionicons name="wallet-outline" size={20} color={tokens.mintText} />
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {amountNum > 0
              ? t("bills.betting.fund_button_with_amount", {
                  amount: amountNum,
                })
              : t("bills.betting.amount_required")}
          </Text>
        </TouchableOpacity>

        <ErrorBanner
          message={purchaseError ?? ""}
          onDismiss={() => setPurchaseError(null)}
        />

        <ConfirmPurchaseModal
          visible={showConfirmModal}
          productType="Betting Wallet"
          productDetails={`${selectedBiller?.name ?? ""} · ${accountNumber}`}
          totalKobo={amountNum * 100}
          cashPaymentKobo={amountNum * 100 - applySvDiscountAmount * 10}
          svDiscountSv={applySvDiscountAmount}
          commissionSv={Math.floor(amountNum * 0.018 * 0.67 * 10)}
          newCashableBalance={
            userCashableBalance - (amountNum * 100 - applySvDiscountAmount * 10)
          }
          newServiceCreditBalance={
            userServiceCreditBalance -
            applySvDiscountAmount +
            Math.floor(amountNum * 0.018 * 0.67 * 10)
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
    fontSize: 18,
    fontWeight: "600",
    borderWidth: 1,
  },
  inputIconValid: {
    position: "absolute",
    right: 12,
    top: 14,
  },
  segmentChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  segmentChipText: { fontSize: 13, fontWeight: "600" },
  validateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  validateText: { fontSize: 14, fontWeight: "600" },
  amountGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  amountCard: {
    width: "30%",
    minWidth: 100,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    position: "relative",
  },
  amountValue: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  planCheck: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#0E7C66",
    alignItems: "center",
    justifyContent: "center",
  },
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
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 13, fontWeight: "500" },
  retryBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  retryText: { fontSize: 13, fontWeight: "700" },
});
