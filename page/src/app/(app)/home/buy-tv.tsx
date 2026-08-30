import { useState, useEffect, useCallback } from "react";
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
  SegmentedControl,
  PlanGrid,
  ConfirmModal,
  EarnBadge,
  ErrorBanner,
  BuyScreenSkeleton,
} from "@/src/components/bills";
import { DiscountSlider } from "@/src/components/bills/DiscountSlider";
import { ConfirmPurchaseModal } from "@/src/components/bills/ConfirmPurchaseModal";
import { ShortfallModal } from "@/src/components/bills/ShortfallModal";

type Bouquet = {
  id?: string;
  plan_id?: string;
  plan_code?: string;
  provider?: string;
  name?: string;
  price_naira?: number;
  amount?: number;
  channels?: string | null;
  commission_rate?: number;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
  customer_name: string | null;
};

type ValidateResult = {
  customer_name: string | null;
  account_status: string | null;
  validated: boolean;
  message?: string;
};

type TvProvider = {
  cable_name: string;
  product_name?: string;
};

export default function BuyTvScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [smartcard, setSmartcard] = useState("");
  const [phone, setPhone] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const [selectedBouquet, setSelectedBouquet] = useState<string | null>(null);
  const [validatedName, setValidatedName] = useState<string | null>(null);
  const [validatedStatus, setValidatedStatus] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  // SV Discount states
  const [applySvDiscountAmount, setApplySvDiscountAmount] = useState(0);
  const [showShortfallModal, setShowShortfallModal] = useState(false);
  const [shortfallSv, setShortfallSv] = useState(0);

  const providersQ = useQuery({
    queryKey: ["tv-providers"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/bills/tv/providers");
      if (!res.ok) throw new Error(t("bills.tv.load_error"));
      const data = await res.json();
      const providers: TvProvider[] = [];
      const seen = new Set<string>();
      for (const item of data) {
        const name = String(item.cable_name || item.name || "").toLowerCase();
        if (name && !seen.has(name)) {
          seen.add(name);
          providers.push({
            cable_name: name,
            product_name: item.product_name || item.name,
          });
        }
      }
      return providers;
    },
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

  useEffect(() => {
    if (!provider && providersQ.data && providersQ.data.length > 0) {
      setProvider(providersQ.data[0].cable_name);
    }
  }, [providersQ.data, provider]);

  const bouquetsQ = useQuery({
    queryKey: ["tv-plans", provider],
    queryFn: async () => {
      if (!provider) return [];
      const res = await apiFetch(`/api/v1/bills/tv/plans?provider=${provider}`);
      if (!res.ok) throw new Error(t("bills.tv.load_error"));
      return (await res.json()) as Bouquet[];
    },
    enabled: !!provider,
  });

  const selectedPkg = bouquetsQ.data?.find(
    (b) => (b.plan_code || b.id) === selectedBouquet,
  );

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!provider || !smartcard)
        throw new Error(t("bills.tv.errors.smartcard_required"));
      const res = await apiFetch("/api/v1/bills/validate-smartcard", {
        method: "POST",
        body: JSON.stringify({ smartcard_number: smartcard, provider }),
      });
      if (!res.ok) throw new Error(t("bills.tv.errors.validation_failed"));
      return (await res.json()) as ValidateResult;
    },
    onSuccess: (data) => {
      if (data.validated && data.customer_name) {
        setValidatedName(data.customer_name);
        setValidatedStatus(data.account_status);
      } else {
        setValidatedName(null);
        setValidatedStatus(null);
      }
    },
    onError: () => {
      setValidatedName(null);
      setValidatedStatus(null);
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPkg) throw new Error(t("bills.tv.select_bouquet"));
      if (!phone) throw new Error(t("bills.tv.phone_required"));
      if (!provider) throw new Error(t("bills.tv.errors.provider_required"));
      const res = await apiFetch("/api/v1/bills/tv", {
        method: "POST",
        body: JSON.stringify({
          smartcard_number: smartcard,
          provider,
          plan_code: selectedPkg.plan_code || selectedBouquet,
          phone: phone,
          apply_sv_discount: applySvDiscountAmount,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t("bills.tv.purchase_failed"));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["me"] });
      setShowConfirmModal(false);
      Alert.alert(
        t("bills.tv.success_title"),
        t("bills.tv.success_message", {
          name: selectedPkg?.name,
          smartcard,
          points: data.points_earned,
        }),
        [{ text: t("bills.tv.done"), onPress: () => router.back() }],
      );
    },
    onError: (error: Error) => {
      setShowConfirmModal(false);
      setPurchaseError(error.message);
    },
  });

  const canSubmit =
    smartcard.length >= 10 &&
    phone.length === 11 &&
    selectedBouquet !== null &&
    provider !== null;
  const estPoints = selectedPkg
    ? Math.floor(
        (selectedPkg.price_naira || selectedPkg.amount || 0) *
          0.018 *
          0.67 *
          10,
      )
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

  const providerOptions = (providersQ.data ?? []).map((p) => ({
    value: p.cable_name,
    label: p.cable_name.toUpperCase(),
  }));

  // Initial-load gate: the form needs the TV provider catalog before the
  // provider picker is usable. bouquetsQ only fetches once a provider is
  // selected, so it isn't part of the first-paint gate.
  if (providersQ.isLoading || profileQ.isLoading) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <BuyScreenSkeleton sections={3} />
      </View>
    );
  }

  const userServiceCreditBalance = profileQ.data?.service_credit_balance || 0;
  const userCashableBalance = profileQ.data?.cashable_balance || 0;

  // Pull-to-refresh: refetch the TV providers catalog.
  const onRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["tv-providers"] });
  }, [qc]);

  return (
    <View
      style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={providersQ.isFetching}
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
            {t("bills.tv.title")}
          </Text>
        </View>

        {/* SECTION 1: Provider (segmented control) */}
        <SectionCard label={t("bills.tv.provider_label")}>
          {providersQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : providerOptions.length === 0 ? (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t("bills.tv.no_providers")}
            </Text>
          ) : (
            <SegmentedControl
              options={providerOptions}
              value={provider ?? providerOptions[0]?.value ?? ""}
              onChange={(v) => {
                setProvider(v);
                setSelectedBouquet(null);
                setValidatedName(null);
                setValidatedStatus(null);
              }}
            />
          )}
        </SectionCard>

        {/* SECTION 2: Bouquets (2-col grid) */}
        <SectionCard
          label={t("bills.tv.package_label")}
          accessory={selectedPkg ? <EarnBadge points={estPoints} /> : undefined}
        >
          {bouquetsQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : (
            <PlanGrid
              items={bouquetsQ.data ?? []}
              isActive={(b) => (b.plan_code ?? b.id ?? "") === selectedBouquet}
              onSelect={(b) => {
                setSelectedBouquet(b.plan_code ?? b.id ?? "");
                setValidatedName(null);
                setValidatedStatus(null);
              }}
              primary={(b) => b.name ?? ""}
              secondary={(b) => b.channels ?? undefined}
              tertiary={(b) =>
                `₦${(b.price_naira || b.amount || 0).toLocaleString()}`
              }
              emptyLabel={t("bills.tv.no_bouquets")}
            />
          )}
        </SectionCard>

        {/* SECTION 3: Smartcard + Validate */}
        <SectionCard label={t("bills.tv.smartcard_label")}>
          <View style={{ position: "relative" }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: tokens.paper,
                  color: tokens.ink,
                  borderColor:
                    smartcard.length >= 10 ? tokens.mint : tokens.border,
                },
              ]}
              placeholder={t("bills.tv.smartcard_placeholder")}
              placeholderTextColor={tokens.inkMuted}
              value={smartcard}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, "");
                setSmartcard(cleaned);
                setValidatedName(null);
                setValidatedStatus(null);
              }}
              keyboardType="number-pad"
              maxLength={15}
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
          {smartcard.length > 0 && smartcard.length < 10 && (
            <Text style={{ color: tokens.error, fontSize: 12, marginTop: 4 }}>
              {t("bills.tv.smartcard_error")}
            </Text>
          )}

          <TouchableOpacity
            onPress={() => validateMutation.mutate()}
            disabled={
              smartcard.length < 10 || !provider || validateMutation.isPending
            }
            style={[
              styles.validateBtn,
              {
                backgroundColor: tokens.mintSoft,
                borderColor: tokens.mint,
                opacity:
                  smartcard.length < 10 ||
                  !provider ||
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
                  {t("bills.tv.validate_button")}
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
              {validatedStatus && (
                <Text style={{ color: tokens.inkMuted, fontSize: 11 }}>
                  {t("bills.tv.account_status", { status: validatedStatus })}
                </Text>
              )}
              <Text
                style={{
                  color: tokens.inkMuted,
                  fontSize: 10,
                  fontStyle: "italic",
                }}
              >
                {t("bills.tv.verified_via")}
              </Text>
            </View>
          )}
        </SectionCard>

        {/* SECTION 4: Phone */}
        <SectionCard label={t("bills.tv.phone")}>
          <View style={{ position: "relative" }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: tokens.paper,
                  color: tokens.ink,
                  borderColor:
                    phone.length === 11 ? tokens.mint : tokens.border,
                },
              ]}
              placeholder={t("bills.tv.phone_placeholder")}
              placeholderTextColor={tokens.inkMuted}
              value={phone}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, "");
                setPhone(cleaned);
              }}
              keyboardType="phone-pad"
              maxLength={11}
            />
            {phone.length === 11 && (
              <View style={styles.inputIconValid}>
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={tokens.mint}
                />
              </View>
            )}
          </View>
          {phone.length > 0 && phone.length < 11 && (
            <Text style={{ color: tokens.error, fontSize: 12, marginTop: 4 }}>
              {t("bills.tv.phone_error")}
            </Text>
          )}
        </SectionCard>

        {/* SV Discount Slider */}
        {selectedPkg &&
          (selectedPkg.price_naira || selectedPkg.amount || 0) >= 100 && (
            <DiscountSlider
              productPriceKobo={
                (selectedPkg.price_naira || selectedPkg.amount || 0) * 100
              }
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
          <Ionicons name="cart-outline" size={20} color={tokens.mintText} />
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {selectedPkg
              ? t("bills.tv.pay_button_with_amount", {
                  amount: selectedPkg.price_naira || selectedPkg.amount || 0,
                })
              : t("bills.tv.select_bouquet_prompt")}
          </Text>
        </TouchableOpacity>

        <ErrorBanner
          message={purchaseError ?? ""}
          onDismiss={() => setPurchaseError(null)}
        />

        <ConfirmPurchaseModal
          visible={showConfirmModal}
          productType="TV Subscription"
          productDetails={`${(provider ?? "").toUpperCase()} · ${selectedPkg?.name ?? ""}`}
          totalKobo={
            (selectedPkg?.price_naira || selectedPkg?.amount || 0) * 100
          }
          cashPaymentKobo={
            (selectedPkg?.price_naira || selectedPkg?.amount || 0) * 100 -
            applySvDiscountAmount * 10
          }
          svDiscountSv={applySvDiscountAmount}
          commissionSv={estPoints}
          newCashableBalance={
            userCashableBalance -
            ((selectedPkg?.price_naira || selectedPkg?.amount || 0) * 100 -
              applySvDiscountAmount * 10)
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
    fontSize: 18,
    fontWeight: "600",
    borderWidth: 1,
  },
  inputIconValid: {
    position: "absolute",
    right: 12,
    top: 14,
  },
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
