import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

interface ConfirmPurchaseModalProps {
  visible: boolean;
  productType: string;
  productDetails: string;
  totalKobo: number;
  cashPaymentKobo: number;
  svDiscountSv: number;
  commissionSv: number;
  newCashableBalance: number;
  newServiceCreditBalance: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPurchaseModal({
  visible,
  productType,
  productDetails,
  totalKobo,
  cashPaymentKobo,
  svDiscountSv,
  commissionSv,
  newCashableBalance,
  newServiceCreditBalance,
  onConfirm,
  onCancel,
}: ConfirmPurchaseModalProps) {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: tokens.paper }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[styles.title, { color: tokens.ink }]}>
              {t("sv_discount.confirm_title")}
            </Text>

            <View style={styles.productInfo}>
              <Text style={[styles.productAmount, { color: tokens.ink }]}>
                ₦{(totalKobo / 100).toFixed(2)} {productType}
              </Text>
              <Text style={[styles.productDetails, { color: tokens.inkMuted }]}>
                {productDetails}
              </Text>
            </View>

            <View style={[styles.section, { borderTopColor: tokens.border }]}>
              <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                {t("sv_discount.payment_breakdown")}
              </Text>

              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: tokens.ink }]}>
                  ├─ {t("sv_discount.cash_payment")}:
                </Text>
                <Text style={[styles.rowValue, { color: tokens.ink }]}>
                  ₦{(cashPaymentKobo / 100).toFixed(2)}
                </Text>
              </View>
              <Text style={[styles.subtext, { color: tokens.inkMuted }]}>
                   {t("sv_discount.from_cashable")}
              </Text>

              {svDiscountSv > 0 && (
                <>
                  <View style={styles.row}>
                    <Text style={[styles.rowLabel, { color: tokens.ink }]}>
                      ├─ {t("sv_discount.sv_discount_label")}:
                    </Text>
                    <Text style={[styles.rowValue, { color: tokens.mint }]}>
                      ₦{((svDiscountSv * 10) / 100).toFixed(2)}
                    </Text>
                  </View>
                  <Text style={[styles.subtext, { color: tokens.inkMuted }]}>
                     {t("sv_discount.from_service_credits")}
                  </Text>
                </>
              )}

              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: tokens.ink }]}>
                  └─ {t("sv_discount.commission_earned")}:
                </Text>
                <Text style={[styles.rowValue, { color: tokens.mint }]}>
                  +{commissionSv} sv
                </Text>
              </View>
              <Text style={[styles.subtext, { color: tokens.inkMuted }]}>
                 {t("sv_discount.earned_after")}
              </Text>
            </View>

            <View style={[styles.section, { borderTopColor: tokens.border }]}>
              <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                {t("sv_discount.new_balances")}
              </Text>
              <Text style={[styles.balanceText, { color: tokens.inkMuted }]}>
                • {t("sv_discount.cashable_balance", { amount: (newCashableBalance / 100).toFixed(2) })}
              </Text>
              <Text style={[styles.balanceText, { color: tokens.inkMuted }]}>
                • {t("sv_discount.service_credit_balance", { sv: newServiceCreditBalance })}
              </Text>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton, { borderColor: tokens.border }]}
                onPress={onCancel}
              >
                <Text style={[styles.cancelButtonText, { color: tokens.ink }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.confirmButton, { backgroundColor: tokens.mint }]}
                onPress={onConfirm}
              >
                <Text style={[styles.confirmButtonText, { color: tokens.mintText }]}>
                  Confirm Purchase
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    width: "90%",
    maxHeight: "80%",
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
    textAlign: "center",
  },
  productInfo: {
    marginBottom: 20,
    alignItems: "center",
  },
  productAmount: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  productDetails: {
    fontSize: 14,
  },
  section: {
    borderTopWidth: 1,
    paddingTop: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  rowLabel: {
    fontSize: 14,
    flex: 1,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "600",
  },
  subtext: {
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 8,
  },
  balanceText: {
    fontSize: 14,
    marginBottom: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  confirmButton: {
    // backgroundColor set via tokens
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
});
