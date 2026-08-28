import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { apiFetch } from "@/src/shared/api/client";
import { useCurrentUser } from "@/src/shared/lib/current-user";
import { useAdsConfig } from "@/src/shared/hooks/use-ads-config";
import { RewardedAd } from "@/components/ads/RewardedAd";
import { queryClient } from "@/src/shared/lib/queryClient";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import {
  SectionCard,
  NetworkPicker,
  ConfirmModal,
  EarnBadge,
  BuyScreenSkeleton,
  BeneficiaryNamePrompt,
  RecentTransactionsList,
  ReceiptShareModal,
  RateLimitDisplay,
  BulkAirtimeModal,
  DisputeModal,
  ScheduleModal,
} from "@/src/components/bills";
import { DiscountSlider } from "@/src/components/bills/DiscountSlider";
import { ConfirmPurchaseModal } from "@/src/components/bills/ConfirmPurchaseModal";
import { ShortfallModal } from "@/src/components/bills/ShortfallModal";
import { PagePaySpinner } from "@/components/PagePaySpinner";
import { Skeleton } from "@/components/Skeleton";

type AirtimeResult = {
  reference: string;
  phone: string;
  amount_naira: number;
  network: string;
  commission_naira: number;
  points_earned: number;
  new_balance: number;
  status: string;
};

type NetworkOption = {
  id: string;
  name: string;
};

type Beneficiary = {
  id: number;
  name: string;
  phone: string;
  network: string;
};

type PurchaseState = "idle" | "processing" | "success" | "failed";

const AMOUNTS = [25, 50, 100, 200, 500, 1000, 2000, 5000];

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

export default function BuyAirtimeScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();

  const [phone, setPhone] = useState("");
  const [selectedNetworkId, setSelectedNetworkId] = useState<
    string | number | null
  >(null);
  const [detectedNetwork, setDetectedNetwork] = useState<string | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [isDetecting, setIsDetecting] = useState(false);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [successData, setSuccessData] = useState<AirtimeResult | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<
    number | null
  >(null);
  const [saveAsBeneficiary, setSaveAsBeneficiary] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // New modal states for backend features
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [disputeTransaction, setDisputeTransaction] = useState<{
    reference: string;
    details: any;
  } | null>(null);

  // SV Discount states
  const [applySvDiscountAmount, setApplySvDiscountAmount] = useState(0);
  const [showShortfallModal, setShowShortfallModal] = useState(false);
  const [shortfallSv, setShortfallSv] = useState(0);

  // Ad modal state for earning SP via rewarded ads
  const [showAdModal, setShowAdModal] = useState(false);
  const adsConfigQ = useAdsConfig();
  const user = useCurrentUser();

  const networksQ = useQuery({
    queryKey: ["airtime-networks"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/bills/airtime/networks");
      if (!res.ok) throw new Error(t("bills.airtime.load_error"));
      return (await res.json()) as NetworkOption[];
    },
  });

  const beneficiariesQ = useQuery({
    queryKey: ["beneficiaries"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/bills/beneficiaries");
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

  // Fetch recent airtime transactions
  const recentTxQ = useQuery({
    queryKey: ["bills-history", "airtime", "recent"],
    queryFn: async () => {
      const res = await apiFetch(
        "/api/v1/bills/history?service=airtime&limit=3",
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.items || [];
    },
    staleTime: 60 * 1000, // 1 minute
  });

  const createBeneficiaryMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      phone: string;
      network: string;
    }) => {
      const res = await apiFetch("/api/v1/bills/beneficiaries", {
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
      queryClient.invalidateQueries({ queryKey: ["beneficiaries"] });
    },
  });

  const deleteBeneficiaryMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/v1/bills/beneficiaries/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete beneficiary");
      return (await res.json()) as { deleted: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beneficiaries"] });
      if (selectedBeneficiaryId === deleteBeneficiaryMutation.variables) {
        setSelectedBeneficiaryId(null);
      }
    },
  });

  const networkList = networksQ.data ?? [];

  useEffect(() => {
    if (!selectedNetworkId && networkList.length > 0) {
      setSelectedNetworkId(networkList[0].id);
    }
  }, [networkList, selectedNetworkId]);

  const detectNetwork = async (phoneNumber: string) => {
    if (phoneNumber.length !== 11) {
      setDetectedNetwork(null);
      return;
    }
    setIsDetecting(true);
    try {
      const res = await apiFetch("/api/v1/bills/detect-network", {
        method: "POST",
        body: JSON.stringify({ phone: phoneNumber }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.validated && data.network) {
          const matched = networkList.find(
            (n) => n.id === String(data.network),
          );
          if (matched) {
            setSelectedNetworkId(matched.id);
            setDetectedNetwork(data.network_name || matched.name);
          }
        }
      }
    } catch {
      // Silently ignore detection failures — user can still pick manually
    } finally {
      setIsDetecting(false);
    }
  };

  const beneficiaryList = beneficiariesQ.data ?? [];

  const debouncedSearch = useDebounce(searchQuery, 300);

  const filteredBeneficiaries = beneficiaryList.filter((b) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return b.name.toLowerCase().includes(q) || b.phone.includes(q);
  });

  const handleSelectBeneficiary = (b: Beneficiary) => {
    setPhone(b.phone);
    setSelectedBeneficiaryId(b.id);
    const matched = networkList.find(
      (n) => n.name.toLowerCase() === b.network.toLowerCase(),
    );
    if (matched) setSelectedNetworkId(matched.id);
    setShowDropdown(false);
    setSearchQuery("");
  };

  const handleClearBeneficiary = () => {
    setSelectedBeneficiaryId(null);
  };

  const handleSaveBeneficiary = async () => {
    if (!phone || phone.length !== 11 || !selectedNetworkId) return;
    const networkName =
      networkList.find((n) => n.id === selectedNetworkId)?.name || "mtn";
    const name = `Beneficiary ${beneficiaryList.length + 1}`;
    try {
      await createBeneficiaryMutation.mutateAsync({
        name,
        phone,
        network: networkName,
      });
      setSaveAsBeneficiary(false);
    } catch {
      // Silently ignore save failures
    }
  };

  const handleDeleteBeneficiary = async (id: number) => {
    await deleteBeneficiaryMutation.mutateAsync(id);
  };

  const selectedNetwork = networkList.find((n) => n.id === selectedNetworkId);
  const finalAmount = selectedAmount ?? (parseInt(customAmount, 10) || 0);
  const canSubmit =
    phone.length === 11 && selectedNetworkId !== null && finalAmount >= 25;
  const estPoints = finalAmount
    ? Math.floor(finalAmount * 0.018 * 0.67 * 10)
    : 0;

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedNetworkId)
        throw new Error(t("bills.airtime.select_network"));
      const res = await apiFetch("/api/v1/bills/airtime", {
        method: "POST",
        body: JSON.stringify({
          phone,
          network: selectedNetworkId,
          amount_naira: finalAmount,
          apply_sv_discount: applySvDiscountAmount,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(
          err.detail || t("bills.airtime.errors.purchase_failed"),
        );
      }
      return (await res.json()) as AirtimeResult;
    },
    onSuccess: (data) => {
      setSuccessData(data);
      setPurchaseState("success");
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
      setPurchaseState("failed");
    },
  });

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
    setErrorMessage("");
  };

  const handleSuccessDone = async () => {
    // If user wants to save and hasn't already saved this number
    if (saveAsBeneficiary && successData && !selectedBeneficiaryId) {
      setShowNamePrompt(true);
      return; // Don't close yet, wait for name input
    }

    // Reset and close
    setPurchaseState("idle");
    setSuccessData(null);
    setPhone("");
    setSelectedNetworkId(networkList.length > 0 ? networkList[0].id : null);
    setDetectedNetwork(null);
    setSelectedAmount(null);
    setCustomAmount("");
    setSelectedBeneficiaryId(null);
    setSaveAsBeneficiary(false);
  };

  const handleSaveBeneficiaryWithName = async (name: string) => {
    if (!successData || !phone || !selectedNetworkId) {
      setShowNamePrompt(false);
      return;
    }

    const networkName =
      networkList.find((n) => n.id === selectedNetworkId)?.name || "mtn";

    try {
      await createBeneficiaryMutation.mutateAsync({
        name,
        phone,
        network: networkName,
      });
      setShowNamePrompt(false);
      setSaveAsBeneficiary(false);

      // Now close the success screen
      handleSuccessDone();
    } catch {
      // Silently ignore save failures, close anyway
      setShowNamePrompt(false);
      handleSuccessDone();
    }
  };

  const handleRetryTransaction = (tx: any) => {
    // Prefill form with transaction data
    setPhone(tx.phone || "");
    if (tx.network) {
      const matched = networkList.find(
        (n) => n.name.toLowerCase() === tx.network.toLowerCase(),
      );
      if (matched) setSelectedNetworkId(matched.id);
    }
    setSelectedAmount(tx.amount_naira);
    setCustomAmount("");
  };

  // Pull-to-refresh: invalidate the catalog queries so TanStack Query
  // refetches networks and beneficiaries. The RefreshControl's
  // `refreshing` flag is bound to networksQ.isFetching so the spinner
  // stays in sync without local state.
  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["airtime-networks"] });
    queryClient.invalidateQueries({ queryKey: ["beneficiaries"] });
  }, []);

  // Initial-load gate: the form needs both the network catalog and the
  // saved beneficiaries before the recipient/network sections are usable.
  // Show a skeleton placeholder so the user gets immediate visual feedback
  // instead of an empty form while the queries are in flight.
  if (networksQ.isLoading || beneficiariesQ.isLoading || profileQ.isLoading) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <BuyScreenSkeleton sections={3} />
      </View>
    );
  }

  const userServiceCreditBalance = profileQ.data?.service_credit_balance || 0;
  const userCashableBalance = profileQ.data?.cashable_balance || 0;

  if (purchaseState === "success" && successData) {
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
          {t("bills.airtime.success_title_big")}
        </Text>
        <SectionCard>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
              {t("bills.airtime.confirm_network")}
            </Text>
            <Text style={[styles.summaryValue, { color: tokens.ink }]}>
              {selectedNetwork?.name || successData.network}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: tokens.border }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
              {t("bills.airtime.confirm_amount")}
            </Text>
            <Text style={[styles.summaryValue, { color: tokens.mint }]}>
              ₦{successData.amount_naira.toLocaleString()}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: tokens.border }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
              {t("bills.airtime.confirm_phone")}
            </Text>
            <Text style={[styles.summaryValue, { color: tokens.ink }]}>
              {successData.phone}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: tokens.border }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
              {t("bills.airtime.points_earned_label")}
            </Text>
            <Text style={[styles.summaryValue, { color: tokens.mint }]}>
              +{successData.points_earned} sp
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: tokens.border }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryKey, { color: tokens.inkMuted }]}>
              {t("bills.airtime.reference_label")}
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
                Save this number?
              </Text>
              <Text style={[styles.savePromptSub, { color: tokens.inkMuted }]}>
                {successData.phone} for next time
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

        {/* Share Receipt Button */}
        <TouchableOpacity
          onPress={() => setShowReceiptModal(true)}
          style={[
            styles.shareBtn,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <Ionicons name="share-outline" size={20} color={tokens.ink} />
          <Text style={[styles.shareBtnText, { color: tokens.ink }]}>
            Share Receipt
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSuccessDone}
          style={[styles.payBtn, { backgroundColor: tokens.mint }]}
        >
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {t("common.done")}
          </Text>
        </TouchableOpacity>

        {/* Beneficiary Name Prompt */}
        <BeneficiaryNamePrompt
          visible={showNamePrompt}
          phone={phone}
          network={selectedNetwork?.name || ""}
          onSave={handleSaveBeneficiaryWithName}
          onCancel={() => {
            setShowNamePrompt(false);
            setSaveAsBeneficiary(false);
            handleSuccessDone();
          }}
          saving={createBeneficiaryMutation.isPending}
        />

        {/* Receipt Share Modal */}
        <ReceiptShareModal
          visible={showReceiptModal}
          onClose={() => setShowReceiptModal(false)}
          receipt={
            successData
              ? {
                  reference: successData.reference,
                  service: "airtime",
                  amount: successData.amount_naira,
                  points_earned: successData.points_earned,
                  date: new Date().toISOString(),
                  phone: successData.phone,
                  network: successData.network,
                  status: successData.status,
                }
              : null
          }
        />
      </View>
    );
  }

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
          {t("bills.airtime.error_title_big")}
        </Text>
        <Text style={[styles.errorMessage, { color: tokens.inkMuted }]}>
          {errorMessage}
        </Text>
        <SectionCard>
          <Text style={[styles.errorNote, { color: tokens.inkMuted }]}>
            {t("bills.airtime.error_note")}
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
          {t("bills.airtime.processing_title")}
        </Text>
        <Text style={[styles.processingSub, { color: tokens.inkMuted }]}>
          {t("bills.airtime.processing_sub")}
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

  // idle state — the form
  const networkOptions = networkList.map((n) => ({
    id: n.id,
    name: n.name,
  }));

  return (
    <View
      style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={networksQ.isFetching || beneficiariesQ.isFetching}
            onRefresh={onRefresh}
            tintColor={tokens.mint}
          />
        }
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={24} color={tokens.ink} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: tokens.ink }]}>
              {t("bills.airtime.title")}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.push("/(app)/home/beneficiaries" as any)}
            style={styles.headerBtn}
          >
            <Ionicons name="people-outline" size={22} color={tokens.ink} />
          </TouchableOpacity>
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
                      {b.phone.slice(-4)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Recent Transactions */}
        {recentTxQ.data && recentTxQ.data.length > 0 && (
          <RecentTransactionsList
            transactions={recentTxQ.data}
            onRetry={handleRetryTransaction}
            onDispute={(tx) => {
              setDisputeTransaction({
                reference: tx.id.toString(),
                details: {
                  service: "airtime",
                  amount: tx.amount_naira,
                  phone: tx.phone,
                  network: tx.network || "Unknown",
                },
              });
              setShowDisputeModal(true);
            }}
          />
        )}

        {/* SECTION 1: Phone */}
        <SectionCard label={t("bills.airtime.phone_label")}>
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
              placeholder={t("bills.airtime.phone_placeholder")}
              placeholderTextColor={tokens.inkMuted}
              value={phone}
              onChangeText={(text) => {
                const cleaned = text.replace(/[^0-9]/g, "");
                setPhone(cleaned);
                setSelectedBeneficiaryId(null);
                if (cleaned.length > 0 && cleaned.length < 11) {
                  setSearchQuery(cleaned);
                  setShowDropdown(true);
                } else {
                  setShowDropdown(false);
                  setSearchQuery("");
                }
                if (cleaned.length === 11) {
                  detectNetwork(cleaned);
                } else {
                  setDetectedNetwork(null);
                }
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
                        {b.phone} · {b.network.toUpperCase()}
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
          {phone.length > 0 && phone.length < 11 && (
            <Text style={{ color: tokens.error, fontSize: 12, marginTop: 4 }}>
              {t("bills.airtime.errors.phone_invalid")}
            </Text>
          )}
          {detectedNetwork && (
            <Text
              style={{
                color: tokens.mint,
                fontSize: 12,
                marginTop: 4,
                fontWeight: "600",
              }}
            >
              ✓ {t("bills.airtime.detected", { network: detectedNetwork })}
            </Text>
          )}
          {isDetecting && (
            <Text
              style={{ color: tokens.inkMuted, fontSize: 12, marginTop: 4 }}
            >
              {t("bills.airtime.detecting")}
            </Text>
          )}
        </SectionCard>

        {/* SECTION 2: Network (logo chips) */}
        <SectionCard label={t("bills.airtime.network_label")}>
          {networksQ.isLoading ? (
            <PagePaySpinner size={32} />
          ) : networkList.length === 0 ? (
            <Text style={{ color: tokens.inkMuted, fontSize: 13 }}>
              {t("bills.airtime.no_networks")}
            </Text>
          ) : (
            <NetworkPicker
              options={networkOptions}
              value={selectedNetworkId}
              onChange={setSelectedNetworkId}
            />
          )}
        </SectionCard>

        {/* SECTION 3: Amount (3-col grid) + custom amount */}
        <SectionCard
          label={t("bills.airtime.amount_label")}
          accessory={
            finalAmount >= 25 ? <EarnBadge points={estPoints} /> : undefined
          }
        >
          <View style={styles.amountGrid}>
            {AMOUNTS.map((a) => {
              const isActive = selectedAmount === a;
              return (
                <TouchableOpacity
                  key={a}
                  onPress={() => {
                    setSelectedAmount(a);
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
                    +{Math.floor(a * 0.018 * 0.67 * 10)} sp
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
            placeholder={t("bills.airtime.custom_amount")}
            placeholderTextColor={tokens.inkMuted}
            value={customAmount}
            onChangeText={(text) => {
              const cleaned = text.replace(/[^0-9]/g, "");
              setCustomAmount(cleaned);
              setSelectedAmount(null);
            }}
            keyboardType="number-pad"
            maxLength={6}
          />
        </SectionCard>

        {/* SV Discount Slider */}
        {finalAmount >= 25 && (
          <View>
            <DiscountSlider
              productPriceKobo={finalAmount * 100}
              userServiceCreditBalance={userServiceCreditBalance}
              maxDiscountPercent={25}
              onDiscountChange={(svAmount) => {
                setApplySvDiscountAmount(svAmount);
              }}
              onWatchAds={() => {
                setShowAdModal(true);
              }}
            />
          </View>
        )}

        {/* Rate Limit Display */}
        <RateLimitDisplay service="airtime" />

        {/* Quick Actions */}
        <SectionCard>
          <View style={styles.quickActions}>
            <TouchableOpacity
              onPress={() => setShowBulkModal(true)}
              style={[
                styles.quickActionBtn,
                { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
            >
              <Ionicons name="people-outline" size={20} color={tokens.ink} />
              <Text style={[styles.quickActionText, { color: tokens.ink }]}>
                Bulk Purchase
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowScheduleModal(true)}
              style={[
                styles.quickActionBtn,
                { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
            >
              <Ionicons name="time-outline" size={20} color={tokens.ink} />
              <Text style={[styles.quickActionText, { color: tokens.ink }]}>
                Schedule
              </Text>
            </TouchableOpacity>
          </View>
        </SectionCard>

        {/* Pay button */}
        <TouchableOpacity
          onPress={handleBuyPress}
          disabled={!canSubmit}
          style={[
            styles.payBtn,
            { backgroundColor: canSubmit ? tokens.mint : tokens.border },
          ]}
        >
          <Ionicons name="cart-outline" size={20} color={tokens.mintText} />
          <Text style={[styles.payText, { color: tokens.mintText }]}>
            {finalAmount >= 25
              ? t("bills.airtime.buy_button", { amount: finalAmount })
              : t("bills.airtime.amount_required")}
          </Text>
        </TouchableOpacity>

        {/* Confirm Modal */}
        <ConfirmPurchaseModal
          visible={showConfirmModal}
          productType="Airtime"
          productDetails={`${selectedNetwork?.name || ""} · ${phone}`}
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

        {/* Bulk Airtime Modal */}
        <BulkAirtimeModal
          visible={showBulkModal}
          onClose={() => setShowBulkModal(false)}
          onSuccess={(result) => {
            Alert.alert(
              "Bulk Purchase Complete",
              `${result.total_successful} of ${result.total_successful + result.total_failed} purchases succeeded.\n\nTotal: ₦${result.total_amount.toLocaleString()}\nSP Earned: ${result.total_points_earned}`,
            );
            queryClient.invalidateQueries({ queryKey: ["me"] });
          }}
        />

        {/* Schedule Modal */}
        <ScheduleModal
          visible={showScheduleModal}
          onClose={() => setShowScheduleModal(false)}
          service="airtime"
          defaultData={{
            network: selectedNetwork?.id || "mtn",
            phone: phone,
            amount: finalAmount,
          }}
        />

        {/* Dispute Modal */}
        {disputeTransaction && (
          <DisputeModal
            visible={showDisputeModal}
            onClose={() => {
              setShowDisputeModal(false);
              setDisputeTransaction(null);
            }}
            transactionReference={disputeTransaction.reference}
            transactionDetails={disputeTransaction.details}
          />
        )}

        {/* Shortfall Modal */}
        <ShortfallModal
          visible={showShortfallModal}
          shortfallSv={shortfallSv}
          adsNeeded={Math.ceil(shortfallSv / 16)}
          onWatchAds={() => {
            setShowShortfallModal(false);
            setShowAdModal(true);
          }}
          onCancel={() => {
            setShowShortfallModal(false);
            setApplySvDiscountAmount(0);
          }}
        />

        {/* Rewarded Ad Modal for earning SP */}
        <RewardedAd
          key="airtime-shortfall"
          visible={showAdModal}
          adUnit={
            adsConfigQ.data?.rewarded_android ||
            adsConfigQ.data?.rewarded_ios ||
            ""
          }
          adUnitName={
            Platform.OS === "android" ? "rewarded_android" : "rewarded_ios"
          }
          userId={user?.id ?? 0}
          title={t("sv_discount.ad_title", "Watch Ad")}
          body={t(
            "sv_discount.ad_body",
            "Watch this ad to earn service points",
          )}
          claimLabel={t("sv_discount.watch_ads", "Watch Ad")}
          allowSkip
          skipLabel={t("common.skip", "Skip")}
          onClaimed={(_info) => {
            setShowAdModal(false);
            queryClient.invalidateQueries({ queryKey: ["me"] });
          }}
          onSkipped={() => {
            setShowAdModal(false);
          }}
          onClose={() => {
            setShowAdModal(false);
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
    gap: 6,
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
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
  quickActions: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 8,
  },
  quickActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: "600",
  },
  headerBtn: {
    padding: 8,
    borderRadius: 12,
  },
});
