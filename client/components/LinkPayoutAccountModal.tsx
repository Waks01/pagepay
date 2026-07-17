import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/src/shared/api/client';
import {
  NIGERIAN_BANKS,
  NigerianBank,
} from '@/src/shared/lib/nigerian-banks';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';
import { Field } from '@/components/Field';
import { PrimaryButton } from '@/components/PrimaryButton';

export type PayoutAccount = {
  bank_code: string;
  bank_name: string;
  account_number_last4: string;
  account_name: string | null;
  verified: boolean;
  linked_at: string;
  recipient_code: string | null;
};

type LinkPayoutAccountModalProps = {
  visible: boolean;
  /** Existing link (if any) — used to prefill the bank and to know whether
   *  the user is "adding" or "changing" their account. */
  current: PayoutAccount | null;
  onClose: () => void;
  /** Called with the saved PayoutAccount so the profile screen can refresh. */
  onSaved: (saved: PayoutAccount) => void;
};

const NUBAN_LENGTH = 10;

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; account: PayoutAccount }
  | { kind: 'error'; message: string };

/**
 * Phase 4 — Paystack-wired bank-account linking modal.
 *
 * Flow:
 *   1. User picks a bank. The picker uses TanStack Query against
 *      `/api/v1/payouts/banks` (which proxies Paystack's `/bank`); on
 *      fetch failure it falls back to the curated `NIGERIAN_BANKS`
 *      list so the modal stays usable offline.
 *   2. User types a 10-digit NUBAN. On reaching 10 digits we POST
 *      `/payouts/resolve-account` — which now calls Paystack's
 *      `/bank/resolve`. The resolved name (or `null` when Paystack
 *      can't resolve) populates the read-only "Account name" field.
 *   3. Save → PUT `/payouts/account`. With Paystack configured, the
 *      server also calls `/transferrecipient/create` and flips
 *      `verified=true`. We surface that state with a "Verified by
 *      Paystack" badge instead of the v1 "Pending validation" copy.
 *
 * The NUBAN is the only secret-protected field. Saving always
 * persists it server-side; we never echo it back, only `last4` in the
 * response.
 */
export function LinkPayoutAccountModal({
  visible,
  current,
  onClose,
  onSaved,
}: LinkPayoutAccountModalProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const banksQuery = useQuery({
    queryKey: ['payouts', 'banks'],
    queryFn: async (): Promise<NigerianBank[]> => {
      const res = await apiFetch('/api/v1/payouts/banks');
      if (!res.ok) throw new Error('Failed to load banks');
      return (await res.json()) as NigerianBank[];
    },
    // The bank list changes rarely; 1h mirrors the server-side cache.
    staleTime: 60 * 60 * 1000,
    // Keep showing the offline list while we re-fetch so the modal
    // doesn't flash an empty state on remount.
    refetchOnWindowFocus: false,
  });

  // Online list when available; offline list (curated top banks) when
  // the fetch fails or the user is offline.
  const banks: NigerianBank[] = useMemo(() => {
    const source = banksQuery.data ?? NIGERIAN_BANKS;
    const map = new Map<string, NigerianBank>();
    for (const b of source) {
      if (!map.has(b.code)) map.set(b.code, b);
    }
    return Array.from(map.values());
  }, [banksQuery.data]);

  const [bank, setBank] = useState<NigerianBank | null>(
    current
      ? banks.find((b) => b.code === current.bank_code) ?? {
          code: current.bank_code,
          name: current.bank_name,
        }
      : null,
  );
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedName, setResolvedName] = useState<string | null>(
    current?.account_name ?? null,
  );
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  // Filter the bank list based on the search query. With an empty
  // query we show the curated top N; "Show all" unlocks the full list.
  // searchBanks operates on the offline list only — when the online
  // list is in play we filter inline.
  const filteredBanks = useMemo(() => {
    if (!search.trim()) {
      // Empty query: show curated top of the active list, or the full
      // list if "show all" was toggled.
      if (showAll) return banks;
      return banksQuery.data ? banks.slice(0, 30) : NIGERIAN_BANKS;
    }
    const q = search.trim().toLowerCase();
    const matched = banks.filter((b) => {
      const name = b.name.toLowerCase();
      const short = (b.short ?? '').toLowerCase();
      return (
        name.includes(q) ||
        short.includes(q) ||
        b.code.includes(q)
      );
    });
    // Stable alphabetical order so the picker doesn't shuffle between
    // renders.
    matched.sort((a, b) => a.name.localeCompare(b.name));
    return matched;
  }, [banks, banksQuery.data, search, showAll]);

  // Reset state when the modal (re-)opens so a half-completed form
  // doesn't carry over into the next open.
  useEffect(() => {
    if (!visible) return;
    setBank(
      current
        ? banks.find((b) => b.code === current.bank_code) ?? {
            code: current.bank_code,
            name: current.bank_name,
          }
        : null,
    );
    setSearch('');
    setShowAll(false);
    setAccountNumber('');
    setResolvedName(current?.account_name ?? null);
    setResolveError(null);
    setSaveState({ kind: 'idle' });
  }, [visible, current, banks]);

  // Hit the resolve endpoint once the user has typed 10 digits.
  // We don't block typing on the response — the field stays editable,
  // and the resolved-name chip updates when the call returns.
  useEffect(() => {
    if (!visible) return;
    if (accountNumber.length !== NUBAN_LENGTH || !bank) return;
    let cancelled = false;
    setResolving(true);
    setResolveError(null);
    (async () => {
      try {
        const res = await apiFetch('/api/v1/payouts/resolve-account', {
          method: 'POST',
          body: JSON.stringify({
            bank_code: bank.code,
            account_number: accountNumber,
          }),
        });
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json()) as { account_name: string | null; verified: boolean };
          setResolvedName(body.account_name);
        } else {
          setResolvedName(null);
          setResolveError("Couldn't verify this account. Try again.");
        }
      } catch {
        if (cancelled) return;
        setResolvedName(null);
        setResolveError("Couldn't reach the server. Check your connection.");
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountNumber, bank, visible]);

  // Derived save state — `saving` is true mid-flight, `justSaved`
  // shows the success card, and `saveError` is null until we hit an
  // error. Pulled up here so `canSave` can read them.
  const saving = saveState.kind === 'saving';
  const justSaved = saveState.kind === 'saved';
  const saveError = saveState.kind === 'error' ? saveState.message : null;
  const savedVerified = justSaved && saveState.account.verified;

  const canSave =
    !!bank &&
    accountNumber.length === NUBAN_LENGTH &&
    !saving &&
    !resolving;

  async function handleSave() {
    if (!bank) {
      setSaveState({ kind: 'error', message: 'Pick a bank first.' });
      return;
    }
    if (accountNumber.length !== NUBAN_LENGTH) {
      setSaveState({ kind: 'error', message: 'Account number must be 10 digits.' });
      return;
    }
    setSaveState({ kind: 'saving' });
    try {
      const res = await apiFetch('/api/v1/payouts/account', {
        method: 'PUT',
        body: JSON.stringify({
          bank_code: bank.code,
          bank_name: bank.name,
          account_number: accountNumber,
          account_name: resolvedName,
        }),
      });
      if (!res.ok) {
        let message = "Couldn't save your account. Please try again.";
        if (res.status === 422) {
          message = 'Check your account number — it must be exactly 10 digits.';
        } else if (res.status === 502) {
          message =
            "We couldn't link this account with Paystack. Please double-check the details and try again.";
        } else {
          try {
            const errBody = (await res.json()) as { detail?: string };
            if (errBody?.detail) message = errBody.detail;
          } catch {
            // ignore — keep the generic message
          }
        }
        setSaveState({ kind: 'error', message });
        return;
      }
      const saved = (await res.json()) as PayoutAccount;
      onSaved(saved);
      setSaveState({ kind: 'saved', account: saved });
    } catch {
      setSaveState({ kind: 'error', message: "Couldn't reach the server. Check your connection." });
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              {current ? 'Change bank account' : 'Link your bank account'}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={[styles.cancel, { color: tokens.inkMuted }]}>Cancel</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollBody}
          >
            {/* ── Post-save success state ─────────────────────── */}
            {justSaved ? (
              <View
                style={[
                  styles.successCard,
                  {
                    backgroundColor: tokens.mintSoft,
                    borderColor: tokens.mint,
                  },
                ]}
              >
                <Ionicons
                  name={savedVerified ? 'shield-checkmark' : 'checkmark-circle'}
                  size={22}
                  color={tokens.mint}
                />
                <View style={styles.successInfo}>
                  <Text style={[styles.successTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                    {savedVerified ? 'Verified by Paystack' : 'Linked'}
                  </Text>
                  <Text style={[styles.successBody, { color: tokens.inkMuted }]}>
                    {savedVerified
                      ? `Account name on file: ${saveState.account.account_name ?? '—'}`
                      : 'Your bank details were saved. Verification is pending.'}
                  </Text>
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  style={[styles.successDone, { backgroundColor: tokens.mint }]}
                >
                  <Text style={[styles.successDoneText, { color: tokens.mintText, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                    Done
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* ── Bank picker ─────────────────────────────────────── */}
            <Text style={[styles.section, { color: tokens.inkMuted }]}>BANK</Text>
            <Field
              label=""
              placeholder="Search banks (e.g. GTBank, Zenith)"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {banksQuery.isError ? (
              <Text style={[styles.offlineHint, { color: tokens.inkMuted }]}>
                Offline list — full Paystack bank list will load when you reconnect.
              </Text>
            ) : null}
            <View style={[styles.bankList, { borderColor: tokens.border }]}>
              {filteredBanks.map((b) => {
                const selected = bank?.code === b.code;
                return (
                  <Pressable
                    key={b.code}
                    onPress={() => setBank(b)}
                    style={({ pressed }) => [
                      styles.bankRow,
                      {
                        backgroundColor: selected ? tokens.mintSoft : 'transparent',
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <View style={styles.bankLogo}>
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={selected ? tokens.mint : tokens.inkMuted}
                      />
                    </View>
                    <View style={styles.bankInfo}>
                      <Text style={[styles.bankName, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                        {b.short || b.name}
                      </Text>
                      <Text style={[styles.bankCode, { color: tokens.inkMuted }]}>
                        {b.name} · {b.code}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {!showAll && !search.trim() && banksQuery.data ? (
                <Pressable
                  onPress={() => setShowAll(true)}
                  style={styles.showAll}
                  accessibilityRole="button"
                >
                  <Text style={[styles.showAllText, { color: tokens.mint }]}>
                    Show all {banks.length} banks
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* ── Account number ──────────────────────────────────── */}
            <Text style={[styles.section, { color: tokens.inkMuted }]}>ACCOUNT NUMBER</Text>
            <Field
              label=""
              placeholder="10-digit account number"
              keyboardType="number-pad"
              maxLength={NUBAN_LENGTH}
              value={accountNumber}
              onChangeText={(v) => {
                const cleaned = v.replace(/\D/g, '');
                setAccountNumber(cleaned);
              }}
              autoCorrect={false}
              error={resolveError}
              helper={
                resolving
                  ? 'Verifying with Paystack…'
                  : bank
                    ? 'We verify the name with Paystack before linking.'
                    : 'Pick a bank first.'
              }
            />

            {/* ── Resolved name ───────────────────────────────────── */}
            <Text style={[styles.section, { color: tokens.inkMuted }]}>ACCOUNT NAME</Text>
            <View style={[styles.nameBox, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
              {resolving ? (
                <View style={styles.nameLoading}>
                  <ActivityIndicator size="small" color={tokens.mint} />
                  <Text style={[styles.nameLoadingText, { color: tokens.inkMuted }]}>
                    Resolving with Paystack…
                  </Text>
                </View>
              ) : (
                <View style={styles.nameRow}>
                  <Text
                    style={[
                      styles.nameValue,
                      { color: resolvedName ? tokens.ink : tokens.inkMuted },
                    ]}
                  >
                    {resolvedName
                      ? resolvedName
                      : accountNumber.length === NUBAN_LENGTH
                        ? 'Pending validation'
                        : 'Awaiting account number'}
                  </Text>
                  {resolvedName ? (
                    <View style={[styles.verifiedBadge, { backgroundColor: tokens.mintSoft }]}>
                      <Ionicons name="shield-checkmark" size={12} color={tokens.mint} />
                      <Text style={[styles.verifiedBadgeText, { color: tokens.mint }]}>
                        Verified by Paystack
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            {saveError ? (
              <Text style={[styles.saveError, { color: tokens.signal }]}>{saveError}</Text>
            ) : null}

            {/* ── Footer copy ─────────────────────────────────────── */}
            <View style={[styles.note, { backgroundColor: tokens.mintSoft }]}>
              <Ionicons name="lock-closed" size={14} color={tokens.mint} />
              <Text style={[styles.noteText, { color: tokens.ink }]}>
                We use Paystack to validate bank details and your account
                number is encrypted at rest.
              </Text>
            </View>

            {!justSaved ? (
              <View style={styles.actions}>
                <PrimaryButton
                  title={saving ? 'Saving…' : 'Save bank account'}
                  onPress={handleSave}
                  loading={saving}
                  disabled={!canSave}
                />
              </View>
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
  bankList: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.15)',
  },
  bankLogo: {
    width: 22,
    alignItems: 'center',
  },
  bankInfo: {
    flex: 1,
    gap: 2,
  },
  bankName: {
    fontSize: 15,
  },
  bankCode: {
    fontSize: 12,
  },
  showAll: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  showAllText: {
    fontSize: 13,
    fontWeight: '600',
  },
  offlineHint: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: -4,
  },
  nameBox: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  nameLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameLoadingText: {
    fontSize: 14,
  },
  nameValue: {
    fontSize: 15,
    fontWeight: '500',
    flexShrink: 1,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  saveError: {
    fontSize: 14,
    marginTop: 4,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
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
  // Post-save success card
  successCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  successInfo: {
    flex: 1,
    gap: 2,
  },
  successTitle: {
    fontSize: 14,
  },
  successBody: {
    fontSize: 12,
    lineHeight: 17,
  },
  successDone: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  successDoneText: {
    fontSize: 13,
  },
});