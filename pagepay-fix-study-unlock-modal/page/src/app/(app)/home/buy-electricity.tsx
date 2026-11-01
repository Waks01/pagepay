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
  ConfirmModal,
  EarnBadge,
  BuyScreenSkeleton,
} from "@/src/components/bills";
import { DiscountSlider } from "@/src/components/bills/DiscountSlider";
import { ConfirmPurchaseModal } from "@/src/components/bills/ConfirmPurchaseModal";
import { ShortfallModal } from "@/src/components/bills/ShortfallModal";
import { PagePaySpinner } from "@/components/PagePaySpinner";
import { Skeleton } from "@/components/Skeleton";

type Disco = {
  plan_id?: string;
  plan_code?: string;
  plan_name?: string;
  code?: string;
  name?: string;
  min_amount?: number;
  max_amount?: number;
};

type PurchaseResult = {
  reference: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
  token: string | null;
  units: string | null;
};

type ValidateResult = {
  customer_name: string | null;
  address: string | null;
  validated: boolean;
  message?: string;
};

type Beneficiary = {
  id: number;
  name: string;
  meter_number: string;
  disco: string;
  meter_type: "prepaid" | "postpaid";
};

type PurchaseState = "idle" | "processing" | "success" | "failed";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

const AMOUNTS = [1000, 2000, 5000, 10000, 20000];

export default function BuyElectricityScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [meterNumber, setMeterNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
  const [meterType, setMeterType] = useState<"prepaid" | "postpaid">("prepaid");
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [validatedName, setValidatedName] = useState<string | null>(null);
  const [validatedAddress, setValidatedAddress] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>("idle");
  const [successData, setSuccessData] = useState<PurchaseResult | null>(null);
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<
    number | null
  >(null);
  const [saveAsBeneficiary, setSaveAsBeneficiary] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  // SV Discount states
  const [applySvDiscountAmount, setApplySvDiscountAmount] = useState(0);
  const [showShortfallModal, setShowShortfallModal] = useState(false);
  const [shortfallSv, setShortfallSv] = useState(0);

  const discosQ = useQuery({
    queryKey: ["electricity-plans"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/bills/electricity/plans");
      if (!res.ok) throw new Error(t("bills.electricity.load_error"));
      return (await res.json()) as Disco[];
    },
  });

  const beneficiariesQ = useQuery({
    queryKey: ["electricity-beneficiaries"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/bills/electricity/beneficiaries");
      if (!res.ok) throw new Error("Failed to load beneficiaries");
      return (await res.json()) as Beneficiary[];
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

  const createBeneficiaryMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      meter_number: string;
      disco: string;
      meter_type: "prepaid" | "postpaid";
    }) => {
      const res = await apiFetch("/api/v1/bills/electricity/beneficiaries", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to save beneficiary");
      }
      return (await res.json()) as Beneficiary;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["electricity-beneficiaries"] });
    },
  });

  const deleteBeneficiaryMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(
        `/api/v1/bills/electricity/beneficiaries/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete beneficiary");
      return (await res.json()) as { deleted: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["electricity-beneficiaries"] });
      if (selectedBeneficiaryId === deleteBeneficiaryMutation.variables) {
        setSelectedBeneficiaryId(null);
      }
    },
  });

  const beneficiaryList = beneficiariesQ.data ?? [];
  const debouncedSearch = useDebounce(searchQuery, 300);

  const filteredBeneficiaries = beneficiaryList.filter((b) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return b.name.toLowerCase().includes(q) || b.meter_number.includes(q);
  });

  const handleSelectBeneficiary = (b: Beneficiary) => {
    setMeterNumber(b.meter_number);
    setSelectedBeneficiaryId(b.id);
    const matched = discosQ.data?.find(
      (d) => (d.code || d.plan_code) === b.disco,
    );
    if (matched) setPlanId(matched.code || matched.plan_code || "");
    setMeterType(b.meter_type);
    setShowDropdown(false);
    setSearchQuery("");
    setValidatedName(null);
    setValidatedAddress(null);
  };

  const handleDeleteBeneficiary = async (id: number) => {
    await deleteBeneficiaryMutation.mutateAsync(id);
  };

  const handleSaveBeneficiary = async () => {
    if (!meterNumber || meterNumber.length < 10 || !planId) return;
    const name = `Meter ${beneficiaryList.length + 1}`;
    try {
      await createBeneficiaryMutation.mutateAsync({
        name,
        meter_number: meterNumber,
        disco: planId,
        meter_type: meterType,
      });
      setSaveAsBeneficiary(false);
    } catch {
      // Silently ignore save failures
    }
  };

  useEffect(() => {
    if (!planId && discosQ.data && discosQ.data.length > 0) {
      const first = discosQ.data[0];
      setPlanId(first.code || first.plan_code || "");
    }
  }, [discosQ.data, planId]);

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!planId || !meterNumber)
        throw new Error(t("bills.electricity.meter_required"));
      const res = await apiFetch("/api/v1/bills/validate-meter", {
        method: "POST",
        body: JSON.stringify({
          meter_number: meterNumber,
          plan_id: planId,
          meter_type: meterType,
        }),
      });
      if (!res.ok)
        throw new Error(t("bills.electricity.errors.validation_failed"));
      return (await res.json()) as ValidateResult;
    },
    onSuccess: (data) => {
      if (data.validated && data.customer_name) {
        setValidatedName(data.customer_name);
        setValidatedAddress(data.address);
      } else {
        setValidatedName(null);
        setValidatedAddress(null);
      }
    },
    onError: () => {
      setValidatedName(null);
      setValidatedAddress(null);
    },
  });

  // Auto-validate meter when user types and meter is >= 10 digits
  useEffect(() => {
    if (meterNumber.length >= 10 && planId) {
      const timer = setTimeout(() => {
        validateMutation.mutate();
      }, 800); // Debounce to avoid too many API calls
      return () => clearTimeout(timer);
    } else {
      setValidatedName(null);
      setValidatedAddress(null);
    }
  }, [meterNumber, planId, meterType]);

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      const finalAmount = amount ?? (parseInt(customAmount) || 0);
      if (finalAmount < 1000)
        throw new Error(t("bills.electricity.min_amount"));
      if (!phone) throw new Error(t("bills.electricity.phone_required"));
      const res = await apiFetch("/api/v1/bills/electricity", {
        method: "POST",
        body: JSON.stringify({
          meter_number: meterNumber,
          plan_id: planId,
          meter_type: meterType,
          amount_naira: finalAmount,
          phone: phone,
          apply_sv_discount: applySvDiscountAmount,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t("bills.electricity.purchase_failed"));
      }
      return (await res.json()) as PurchaseResult;
    },
    onSuccess: (data) => {
      setSuccessData(data);
      setPurchaseState("success");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error: Error) => {
      setPurchaseError(error.message);
      setPurchaseState("failed");
    },
  });

  const finalAmount = amount ?? (parseInt(customAmount) || 0);
  const canSubmit =
    meterNumber.length >= 10 && phone.length === 11 && finalAmount >= 1000;
  const estPoints = finalAmount
    ? Math.floor(finalAmount * 0.012 * 0.67 * 10)
    : 0;

  const handleBuyPress = () => {
    if (!canSubmit) return;

    // Check if user has enough SV if they applied discount
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

  const handleConfirmPurchase = () => {
    setShowConfirmModal(false);
    setPurchaseState("processing");
    purchaseMutation.mutate();
  };

  const handleRetry = () => {
    setPurchaseState("idle");
    setPurchaseError(null);
  };

  const handleSuccessDone = async () => {
    if (saveAsBeneficiary && successData && !selectedBeneficiaryId) {
      await handleSaveBeneficiary();
    }
    setPurchaseState("idle");
    setSuccessData(null);
    setMeterNumber("");
    setPhone("");
    setPlanId(
      discosQ.data && discosQ.data.length > 0
        ? discosQ.data[0].code || discosQ.data[0].plan_code || ""
        : null,
    );
    setMeterType("prepaid");
    setAmount(null);
    setCustomAmount("");
    setValidatedName(null);
    setValidatedAddress(null);
    setSelectedBeneficiaryId(null);
    setSaveAsBeneficiary(false);
  };

  const meterTypeOptions = [
    {
      value: "prepaid" as const,
      label: t("bills.electricity.prepaid"),
      icon: "keypad-outline" as const,
    },
    {
      value: "postpaid" as const,
      label: t("bills.electricity.postpaid"),
      icon: "receipt-outline" as const,
    },
  ];

  // Pull-to-refresh callback - must be before any early returns
  const onRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["electricity-plans"] });
    qc.invalidateQueries({ queryKey: ["electricity-beneficiaries"] });
  }, [qc]);

  // Initial-load gate: the form needs the disco catalog and beneficiaries
  if (discosQ.isLoading || beneficiariesQ.isLoading || profileQ.isLoading) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <BuyScreenSkeleton sections={3} />
      </View>
    );
  }

  const userServiceCreditBalance = profileQ.data?.service_credit_balance || 0;
  const userCashableBalance = profileQ.data?.cashable_balance || 0;

  // Success screen
  if (purchaseState === "success" && successData) {
    const selectedDisco = discosQ.data?.find(
      (d) => (d.code || d.plan_code) === planId,
    );
    return (
      <View
        style={[
          styles.fullscreen,
          { paddingTop: insets.top, backgroundColor: tokens.paper },
        ]}
      >
        <View
          style={[
            styles.successIcon,
            { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
          ]}
        >
          <Ionicons name="checkmark" size={48} color={tokens.mint} />
        </View>
        <Text style={[styles.bigTitle, { color: tokens.ink }]}>
          {t("bills.electricity.success_title_big")}
        </Text>
        <SectionCard>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
              DISCO
            </Text>
            <Text style={[styles.summaryValue, { color: tokens.ink }]}>
              {selectedDisco?.name || "Electric"}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: tokens.border }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
              {t("bills.electricity.confirm_amount")}
            </Text>
            <Text style={[styles.summaryValue, { color: tokens.mint }]}>
              ₦{finalAmount.toLocaleString()}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: tokens.border }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
              {t("bills.electricity.confirm_meter")}
            </Text>
            <Text
              style={[
                styles.summaryValue,
                { color: tokens.ink, fontFamily: "monospace" },
              ]}
            >
              {successData.reference.slice(0, 12)}...
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: tokens.border }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
              Points Earned
            </Text>
            <Text style={[styles.summaryValue, { color: tokens.mint }]}>
              +{successData.points_earned} pts
            </Text>
          </View>
          {successData.token && (
            <>
              <View
                style={[styles.divider, { backgroundColor: tokens.border }]}
              />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
                  Token
                </Text>
                <Text
                  style={[
                    styles.summaryValue,
                    { color: tokens.ink, fontFamily: "monospace" },
                  ]}
                >
                  {successData.token}
                </Text>
              </View>
            </>
          )}
        </SectionCard>

        {selectedBeneficiaryId === null && (
          <View
            style={[
              styles.savePrompt,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.savePromptTitle, { color: tokens.ink }]}>
                Save this meter?
              </Text>
              <Text style={[styles.savePromptSub, { color: tokens.inkMuted }]}>
                {meterNumber} for next time
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setSaveAsBeneficiary(!saveAsBeneficiary)}
              style={[
                styles.toggleTrack,
                {
                  backgroundColor: saveAsBeneficiary
                    ? tokens.mint
                    : tokens.border,
                },
              ]}
            >
              <View style={[styles.toggleThumb, { backgroundColor: "#fff" }]} />
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          onPress={handleSuccessDone}
          style={[styles.payBtn, { backgroundColor: tokens.mint }]}
        >
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {t("common.done")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Failed screen
  if (purchaseState === "failed") {
    return (
      <View
        style={[
          styles.fullscreen,
          { paddingTop: insets.top, backgroundColor: tokens.paper },
        ]}
      >
        <View
          style={[
            styles.errorIcon,
            { backgroundColor: tokens.signalSoft, borderColor: tokens.signal },
          ]}
        >
          <Ionicons name="close" size={48} color={tokens.signal} />
        </View>
        <Text style={[styles.bigTitle, { color: tokens.ink }]}>
          Purchase Failed
        </Text>
        <Text style={[styles.errorMessage, { color: tokens.inkMuted }]}>
          {purchaseError}
        </Text>
        <SectionCard>
          <Text style={[styles.errorNote, { color: tokens.inkMuted }]}>
            Please check your details and try again. If the problem persists,
            contact support.
          </Text>
        </SectionCard>
        <TouchableOpacity
          onPress={handleRetry}
          style={[styles.payBtn, { backgroundColor: tokens.mint }]}
        >
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {t("common.try_again")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Processing screen
  if (purchaseState === "processing") {
    return (
      <View
        style={[
          styles.fullscreen,
          { paddingTop: insets.top, backgroundColor: tokens.paper },
        ]}
      >
        <PagePaySpinner size={56} />
        <Text style={[styles.processingTitle, { color: tokens.ink }]}>
          Processing Payment
        </Text>
        <Text style={[styles.processingSub, { color: tokens.inkMuted }]}>
          Please wait while we process your electricity purchase...
        </Text>
        <View style={styles.skeletonGroup}>
          <Skeleton
            width="80%"
            height={14}
            borderRadius={7}
            marginBottom={12}
          />
          <Skeleton width="60%" height={12} borderRadius={6} marginBottom={8} />
          <Skeleton width="70%" height={12} borderRadius={6} />
        </View>
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={discosQ.isFetching}
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
            {t("bills.electricity.title")}
          </Text>
        </View>

        {/* Beneficiary chips */}
        {beneficiaryList.length > 0 && (
          <View style={styles.chipsRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {beneficiaryList.map((b) => {
                const isActive = selectedBeneficiaryId === b.id;
                return (
                  <TouchableOpacity
                    key={b.id}
                    onPress={() => handleSelectBeneficiary(b)}
                    onLongPress={() => handleDeleteBeneficiary(b.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: isActive
                          ? tokens.mintSoft
                          : tokens.card,
                        borderColor: isActive ? tokens.mint : tokens.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: isActive ? tokens.mint : tokens.ink },
                      ]}
                    >
                      {b.name}
                    </Text>
                    <Text style={[styles.chipSub, { color: tokens.inkMuted }]}>
                      {b.meter_number.slice(-4)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* SECTION 1: DISCO + Meter Type */}
        <SectionCard label={t("bills.electricity.disco")}>
          {discosQ.isLoading ? (
            <ActivityIndicator color={tokens.mint} />
          ) : discosQ.data && discosQ.data.length > 0 ? (
            <View style={styles.discoGrid}>
              {(discosQ.data ?? []).map((d) => {
                const id = d.plan_code ?? d.code ?? "";
                const name = d.plan_name ?? d.name ?? "";
                const isActive = planId === id;
                return (
                  <TouchableOpacity
                    key={id}
                    onPress={() => {
                      setPlanId(id);
                      setValidatedName(null);
                      setValidatedAddress(null);
                    }}
                    style={[
                      styles.discoChip,
                      {
                        backgroundColor: isActive
                          ? tokens.mintSoft
                          : tokens.paper,
                        borderColor: isActive ? tokens.mint : tokens.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.discoChipText,
                        { color: isActive ? tokens.mint : tokens.ink },
                      ]}
                    >
                      {name.split("(")[0].trim()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t("bills.electricity.no_discos")}
            </Text>
          )}

          <View style={{ marginTop: 12 }}>
            <Text style={[styles.subLabel, { color: tokens.inkMuted }]}>
              {t("bills.electricity.meter_type")}
            </Text>
            <SegmentedControl
              options={meterTypeOptions}
              value={meterType}
              onChange={(v) => {
                setMeterType(v);
                setValidatedName(null);
                setValidatedAddress(null);
              }}
            />
          </View>
        </SectionCard>

        {/* SECTION 2: Meter Number + Validate */}
        <SectionCard label={t("bills.electricity.meter_number")}>
          <View style={{ position: "relative" }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: tokens.paper,
                  color: tokens.ink,
                  borderColor:
                    meterNumber.length >= 10 ? tokens.mint : tokens.border,
                },
              ]}
              placeholder={t("bills.electricity.meter_placeholder")}
              placeholderTextColor={tokens.inkMuted}
              value={meterNumber}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, "");
                setMeterNumber(cleaned);
                setSelectedBeneficiaryId(null);
                if (cleaned.length > 0 && cleaned.length < 10) {
                  setSearchQuery(cleaned);
                  setShowDropdown(true);
                } else {
                  setShowDropdown(false);
                  setSearchQuery("");
                }
                setValidatedName(null);
                setValidatedAddress(null);
              }}
              keyboardType="number-pad"
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
            {showDropdown && filteredBeneficiaries.length > 0 && (
              <View
                style={[
                  styles.dropdown,
                  { backgroundColor: tokens.card, borderColor: tokens.border },
                ]}
              >
                {filteredBeneficiaries.map((b) => (
                  <TouchableOpacity
                    key={b.id}
                    onPress={() => handleSelectBeneficiary(b)}
                    style={[
                      styles.dropdownRow,
                      { borderBottomColor: tokens.border },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.dropdownName, { color: tokens.ink }]}
                      >
                        {b.name}
                      </Text>
                      <Text
                        style={[
                          styles.dropdownPhone,
                          { color: tokens.inkMuted },
                        ]}
                      >
                        {b.meter_number} · {b.disco.toUpperCase()}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDeleteBeneficiary(b.id)}
                      style={styles.dropdownDelete}
                    >
                      <Ionicons
                        name="close-circle"
                        size={18}
                        color={tokens.signal}
                      />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          {meterNumber.length > 0 && meterNumber.length < 10 && (
            <Text style={{ color: tokens.error, fontSize: 12, marginTop: 4 }}>
              {t("bills.electricity.meter_error")}
            </Text>
          )}

          {/* Auto-validation status */}
          {meterNumber.length >= 10 && validateMutation.isPending && (
            <View
              style={{
                marginTop: 8,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ActivityIndicator size="small" color={tokens.mint} />
              <Text style={{ color: tokens.inkMuted, fontSize: 12 }}>
                {t("bills.electricity.validating")}
              </Text>
            </View>
          )}

          {validatedName && (
            <View style={{ marginTop: 8, gap: 2 }}>
              <Text
                style={{ color: tokens.mint, fontSize: 13, fontWeight: "600" }}
              >
                ✓ {validatedName}
              </Text>
              {validatedAddress && (
                <Text style={{ color: tokens.inkMuted, fontSize: 11 }}>
                  {validatedAddress}
                </Text>
              )}
              <Text
                style={{
                  color: tokens.inkMuted,
                  fontSize: 10,
                  fontStyle: "italic",
                }}
              >
                {t("bills.electricity.verified_via")}
              </Text>
            </View>
          )}
        </SectionCard>

        {/* SECTION 3: Phone */}
        <SectionCard label={t("bills.electricity.phone")}>
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
              placeholder={t("bills.electricity.phone_placeholder")}
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
              {t("bills.electricity.phone_error")}
            </Text>
          )}
        </SectionCard>

        {/* SECTION 4: Amount + custom */}
        <SectionCard
          label={t("bills.electricity.amount")}
          accessory={
            finalAmount >= 1000 ? <EarnBadge points={estPoints} /> : undefined
          }
        >
          <View style={styles.amountGrid}>
            {AMOUNTS.map((a) => {
              const isActive = amount === a;
              return (
                <TouchableOpacity
                  key={a}
                  onPress={() => {
                    setAmount(a);
                    setCustomAmount("");
                  }}
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
                  <Text style={[styles.amountPoints, { color: tokens.mint }]}>
                    +{Math.floor(a * 0.012 * 0.67 * 10)} pts
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: tokens.paper,
                color: tokens.ink,
                borderColor: customAmount ? tokens.mint : tokens.border,
                marginTop: 12,
              },
            ]}
            placeholder={t("bills.electricity.custom_placeholder")}
            placeholderTextColor={tokens.inkMuted}
            value={customAmount}
            onChangeText={(text) => {
              const cleaned = text.replace(/[^0-9]/g, "");
              setCustomAmount(cleaned);
              setAmount(null);
            }}
            keyboardType="number-pad"
            maxLength={7}
          />
        </SectionCard>

        {/* SV Discount Slider */}
        {finalAmount >= 1000 && (
          <DiscountSlider
            productPriceKobo={finalAmount * 100}
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
            {finalAmount >= 1000
              ? t("bills.electricity.pay_button", { amount: finalAmount })
              : t("bills.electricity.min_amount_prompt")}
          </Text>
        </TouchableOpacity>

        <ConfirmPurchaseModal
          visible={showConfirmModal}
          productType="Electricity"
          productDetails={`${meterType.toUpperCase()} · ${meterNumber}`}
          totalKobo={finalAmount * 100}
          cashPaymentKobo={finalAmount * 100 - applySvDiscountAmount * 10}
          svDiscountSv={applySvDiscountAmount}
          commissionSv={estPoints}
          newCashableBalance={
            userCashableBalance -
            (finalAmount * 100 - applySvDiscountAmount * 10)
          }
          newServiceCreditBalance={
            userServiceCreditBalance - applySvDiscountAmount + estPoints
          }
          onConfirm={handleConfirmPurchase}
          onCancel={() => setShowConfirmModal(false)}
        />

        {/* Shortfall Modal */}
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
  subLabel: { fontSize: 13, fontWeight: "500", marginBottom: 8 },
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
  discoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  discoChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  discoChipText: { fontSize: 12, fontWeight: "600" },
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
  amountPoints: { fontSize: 11, fontWeight: "600" },
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
  // New styles for beneficiaries and full-screen states
  chipsRow: {
    minHeight: 44,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  chipSub: {
    fontSize: 11,
    fontWeight: "500",
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 200,
    zIndex: 10,
  },
  dropdownRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropdownName: {
    fontSize: 14,
    fontWeight: "600",
  },
  dropdownPhone: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  dropdownDelete: {
    padding: 4,
  },
  fullscreen: {
    flex: 1,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  errorIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  bigTitle: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  summaryKey: { fontSize: 13, fontWeight: "500" },
  summaryValue: { fontSize: 14, fontWeight: "600" },
  divider: { height: 1 },
  errorMessage: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  errorNote: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  processingTitle: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "SpaceGrotesk_700Bold",
  },
  processingSub: { fontSize: 14, textAlign: "center", lineHeight: 22 },
  skeletonGroup: { marginTop: 24, alignItems: "center" },
  savePrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  savePromptTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  savePromptSub: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  toggleTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    padding: 2,
    justifyContent: "center",
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
});
