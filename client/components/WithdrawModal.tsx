import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/shared/api/client';
import {
  formatKobo,
  previewWithdrawalFeeKobo,
} from '@/src/shared/lib/money';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';
import { Field } from '@/components/Field';
import { PrimaryButton } from '@/components/PrimaryButton';
import type { PayoutAccount } from '@/components/LinkPayoutAccountModal';

type WithdrawalResponse = {
  transfer_reference: string;
  status: 'pending' | 'success' | 'failed';
  new_balance_points: number;
  fee_kobo: number;
  amount_kobo: number;
};

type WithdrawModalProps = {
  visible: boolean;
  /** User's current points balance (1 pt = 1 kobo). */
  balancePoints: number;
  /** Linked payout account, or null when none. */
  payoutAccount: PayoutAccount | null;
  /** Called when no bank is linked — parent opens LinkPayoutAccountModal. */
  onRequestLink: () => void;
  /** Called after a successful POST. */
  onWithdrawn: (resp: WithdrawalResponse) => void;
  onClose: () => void;
};

const MIN_WITHDRAWAL_KOBO = 100_000; // ₦1,000 — matches the server's Pydantic floor.
const PREVIEW_FEE_KOBO = 1_500; // smallest tier (₦15); server re-computes on submit.

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; data: WithdrawalResponse }
  | { kind: 'error'; message: string };

/**
 * Phase 4 — Withdrawal flow.
 *
 * Opens on the Wallet tab's "Withdraw" button. Three states:
 *
 *   1. No bank linked     → "Link your bank account first" empty state with
 *                            a CTA that hands control back to the parent,
 *                            which opens the existing LinkPayoutAccountModal.
 *   2. Bank linked, idle  → amount input pre-filled with max-withdrawable
 *                            (balance minus the smallest-tier fee), live
 *                            fee/receive preview below the field.
 *   3. Submitting / success / error → success card mirrors the one in
 *                                    LinkPayoutAccountModal.
 *
 * Unit math: 1 point = 1 kobo = ₦0.01. The server is the source of truth
 * for fees (see `compute_withdrawal_fee` in `backend/app/routers/payouts.py`).
 * We duplicate the tier table in `src/shared/lib/money.ts` for the live
 * preview; the server response carries the exact `fee_kobo` and replaces
 * whatever the user saw if the schedule ever changes.
 */
export function WithdrawModal({
  visible,
  balancePoints,
  payoutAccount,
  onRequestLink,
  onWithdrawn,
  onClose,
}: WithdrawModalProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [amountText, setAmountText] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' });

  // Pre-fill the input with the max-withdrawable amount whenever the modal
  // opens. Max-withdrawable = balance - the smallest fee tier, so the
  // pre-filled value is always affordable. Reset submit state on every
  // open so a half-completed form doesn't carry over.
  useEffect(() => {
    if (!visible) return;
    const prefilled = Math.max(0, balancePoints - PREVIEW_FEE_KOBO);
    setAmountText(prefilled > 0 ? String(prefilled) : '');
    setSubmitState({ kind: 'idle' });
  }, [visible, balancePoints]);

  const amountKobo = (() => {
    const n = parseInt(amountText, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const previewFeeKobo = amountKobo > 0 ? previewWithdrawalFeeKobo(amountKobo) : 0;
  const previewReceiveKobo = Math.max(0, amountKobo - previewFeeKobo);
  const totalDebitKobo = amountKobo + previewFeeKobo;

  const isBelowMin = amountKobo > 0 && amountKobo < MIN_WITHDRAWAL_KOBO;
  const exceedsBalance = totalDebitKobo > balancePoints;
  const isEmpty = amountKobo === 0;

  // Surface an inline error when the user-typed value violates one of the
  // gates. The server enforces the same rules and returns a more specific
  // message (e.g. the exact shortfall) — we prefer that when present, but
  // show our own pre-flight message first so the user gets feedback before
  // they hit submit.
  const inlineError = (() => {
    if (isEmpty) return null;
    if (isBelowMin) {
      return `Minimum withdrawal is ${formatKobo(MIN_WITHDRAWAL_KOBO)}.`;
    }
    if (exceedsBalance) {
      const shortfall = totalDebitKobo - balancePoints;
      return `Not enough balance. You need ${formatKobo(shortfall)} more to cover the ${formatKobo(previewFeeKobo)} fee.`;
    }
    return null;
  })();

  const canSubmit =
    !!payoutAccount &&
    !isEmpty &&
    !isBelowMin &&
    !exceedsBalance &&
    submitState.kind !== 'submitting';

  const mutation = useMutation<
    WithdrawalResponse,
    Error,
    { amountKobo: number }
  >({
    mutationFn: async ({ amountKobo: amount }) => {
      const res = await apiFetch('/api/v1/payouts/withdraw', {
        method: 'POST',
        body: JSON.stringify({
          amount_kobo: amount,
          reason: 'PagePay withdrawal',
        }),
      });
      if (!res.ok) {
        let detail = "Couldn't start your withdrawal. Please try again.";
        try {
          const errBody = (await res.json()) as { detail?: string };
          if (typeof errBody?.detail === 'string' && errBody.detail) {
            detail = errBody.detail;
          }
        } catch {
          /* non-JSON response — keep the generic message */
        }
        // Status-code-specific copy mirrors the LinkPayoutAccountModal
        // mapping so the two flows feel consistent. The server's
        // `detail` already carries the actionable message in most cases.
        if (res.status === 503) {
          detail =
            'Withdrawals temporarily unavailable. Please try again in a few hours.';
        } else if (res.status === 502) {
          detail =
            "Paystack rejected the transfer. Please try again, or contact support if the issue persists.";
        } else if (res.status === 400 && !detail) {
          detail = 'Please check the amount and try again.';
        }
        throw new Error(detail);
      }
      return (await res.json()) as WithdrawalResponse;
    },
    onSuccess: (data) => {
      setSubmitState({ kind: 'success', data });
      onWithdrawn(data);
    },
    onError: (err) => {
      setSubmitState({ kind: 'error', message: err.message });
    },
  });

  function handleSubmit() {
    if (!canSubmit) return;
    setSubmitState({ kind: 'submitting' });
    mutation.mutate({ amountKobo });
  }

  function handleClose() {
    if (submitState.kind === 'submitting') return;
    onClose();
  }

  const justSaved = submitState.kind === 'success';
  const submitting = submitState.kind === 'submitting';
  const submitError =
    submitState.kind === 'error' ? submitState.message : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.headerRow}>
            <Text
              style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
            >
              Withdraw to your bank
            </Text>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={[styles.cancel, { color: tokens.inkMuted }]}>Cancel</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollBody}
          >
            {/* ── Post-submit success state ──────────────────── */}
            {justSaved ? (
              <View
                style={[
                  styles.successCard,
                  { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
                ]}
              >
                <Ionicons name="shield-checkmark" size={22} color={tokens.mint} />
                <View style={styles.successInfo}>
                  <Text
                    style={[
                      styles.successTitle,
                      { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' },
                    ]}
                  >
                    Withdrawal initiated
                  </Text>
                  <Text style={[styles.successBody, { color: tokens.inkMuted }]}>
                    Sending {formatKobo(submitState.data.amount_kobo)} to{' '}
                    {payoutAccount?.bank_name ?? 'your bank'} ···{payoutAccount?.account_number_last4 ?? ''}
                    {'. '}
                    Status: pending — usually settles in minutes.
                  </Text>
                  <Text style={[styles.successBalance, { color: tokens.ink }]}>
                    New balance: {submitState.data.new_balance_points.toLocaleString()} pts
                  </Text>
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  style={[styles.successDone, { backgroundColor: tokens.mint }]}
                >
                  <Text
                    style={[
                      styles.successDoneText,
                      { color: tokens.mintText, fontFamily: 'SpaceGrotesk_700Bold' },
                    ]}
                  >
                    Done
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* ── No-bank empty state ────────────────────────── */}
            {!justSaved && !payoutAccount ? (
              <View
                style={[
                  styles.emptyCard,
                  { backgroundColor: tokens.mintSoft, borderColor: tokens.mint },
                ]}
              >
                <Ionicons name="business-outline" size={22} color={tokens.mint} />
                <View style={styles.successInfo}>
                  <Text
                    style={[
                      styles.successTitle,
                      { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' },
                    ]}
                  >
                    Link your bank account first
                  </Text>
                  <Text style={[styles.successBody, { color: tokens.inkMuted }]}>
                    PagePay uses Paystack to send the money to your account. You&apos;ll
                    need a 10-digit NUBAN and your bank name.
                  </Text>
                </View>
                <Pressable
                  onPress={onRequestLink}
                  accessibilityRole="button"
                  style={[styles.successDone, { backgroundColor: tokens.mint }]}
                >
                  <Text
                    style={[
                      styles.successDoneText,
                      { color: tokens.mintText, fontFamily: 'SpaceGrotesk_700Bold' },
                    ]}
                  >
                    Link now
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* ── Amount form ────────────────────────────────── */}
            {!justSaved && payoutAccount ? (
              <>
                <View
                  style={[
                    styles.accountChip,
                    { backgroundColor: tokens.paper, borderColor: tokens.border },
                  ]}
                >
                  <Ionicons name="business" size={16} color={tokens.inkMuted} />
                  <Text style={[styles.accountChipText, { color: tokens.inkMuted }]}>
                    {payoutAccount.bank_name} ····{payoutAccount.account_number_last4}
                  </Text>
                </View>

                <Text style={[styles.section, { color: tokens.inkMuted }]}>AMOUNT (POINTS)</Text>
                <Field
                  label=""
                  placeholder="0"
                  value={amountText}
                  onChangeText={(v) => {
                    // Strip non-digits. We let the input be empty (so the
                    // user can clear and retype) and parseInt defaults to
                    // 0 for empty strings.
                    const cleaned = v.replace(/\D/g, '');
                    setAmountText(cleaned);
                    // Drop a server-side error as soon as the user types —
                    // a stale 400 isn't actionable once the input has
                    // changed.
                    if (submitState.kind === 'error') {
                      setSubmitState({ kind: 'idle' });
                    }
                  }}
                  keyboardType="number-pad"
                  autoCorrect={false}
                  error={inlineError ?? submitError}
                  helper={
                    amountKobo > 0
                      ? `Fee: ${formatKobo(previewFeeKobo)} · You'll receive: ${formatKobo(previewReceiveKobo)}`
                      : `Min ${formatKobo(MIN_WITHDRAWAL_KOBO)} per withdrawal · Balance: ${balancePoints.toLocaleString()} pts`
                  }
                />

                <Text style={[styles.section, { color: tokens.inkMuted }]}>YOU&apos;LL RECEIVE</Text>
                <View
                  style={[
                    styles.receiveBox,
                    { backgroundColor: tokens.paper, borderColor: tokens.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.receiveValue,
                      { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' },
                    ]}
                  >
                    {amountKobo > 0 ? formatKobo(previewReceiveKobo) : '—'}
                  </Text>
                  <Text style={[styles.receiveMeta, { color: tokens.inkMuted }]}>
                    {payoutAccount.bank_name} ····{payoutAccount.account_number_last4}
                  </Text>
                </View>

                <View style={[styles.note, { backgroundColor: tokens.mintSoft }]}>
                  <Ionicons name="information-circle-outline" size={14} color={tokens.mint} />
                  <Text style={[styles.noteText, { color: tokens.ink }]}>
                    We debit your wallet when you tap Withdraw, then send the
                    full amount (minus the small flat fee) via Paystack. Your
                    balance updates immediately.
                  </Text>
                </View>

                {submitting ? (
                  <View style={styles.submittingRow}>
                    <ActivityIndicator size="small" color={tokens.mint} />
                    <Text style={[styles.submittingText, { color: tokens.inkMuted }]}>
                      Sending to Paystack…
                    </Text>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <PrimaryButton
                      title={`Withdraw ${amountKobo > 0 ? formatKobo(amountKobo) : ''}`}
                      onPress={handleSubmit}
                      loading={submitting}
                      disabled={!canSubmit}
                    />
                  </View>
                )}
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 18,
    paddingBottom: 24,
    maxHeight: '90%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    letterSpacing: 0.1,
  },
  cancel: {
    fontSize: 15,
    fontWeight: '600',
  },
  scrollBody: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
  },
  section: {
    fontSize: 11,
    letterSpacing: 1.0,
    fontWeight: '600',
    marginTop: 4,
  },
  accountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  accountChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  receiveBox: {
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  receiveValue: {
    fontSize: 28,
    letterSpacing: -0.4,
  },
  receiveMeta: {
    fontSize: 12,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginTop: 6,
  },
  noteText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  actions: {
    marginTop: 12,
  },
  submittingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    paddingVertical: 14,
  },
  submittingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  // Post-submit success card
  successCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  successInfo: {
    flex: 1,
    gap: 4,
  },
  successTitle: {
    fontSize: 15,
  },
  successBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  successBalance: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  successDone: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  successDoneText: {
    fontSize: 13,
  },
  // No-bank empty state
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
