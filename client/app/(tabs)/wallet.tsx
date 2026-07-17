import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { View, Text, FlatList, RefreshControl, ActivityIndicator, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PLATFORM_ENV } from '@/src/shared/lib/ads';
import { consumePendingWithdrawAfterPin } from '@/src/shared/lib/pin-verify-flag';
import { formatKobo, formatPoints } from '@/src/shared/lib/money';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay, Fonts } from '@/constants/theme';
import { PageMark } from '@/components/PageMark';
import { PrimaryButton } from '@/components/PrimaryButton';
import { WithdrawModal } from '@/components/WithdrawModal';
import {
  LinkPayoutAccountModal,
  type PayoutAccount,
} from '@/components/LinkPayoutAccountModal';
import { SkeletonBalanceCard, SkeletonTransactionRow } from '@/components/skeletons';
import { NativeAdBanner } from '@/components/ads/NativeAdBanner';

type UserMe = {
  id: number;
  email: string | null;
  phone: string | null;
  points_balance: number;
  tier: string;
};

type Transaction = {
  id: number;
  type: 'earn' | 'pending' | 'bonus';
  points: number;
  description: string;
  date: string;
};

type WithdrawalRecord = {
  reference: string;
  amount_kobo: number;
  fee_kobo: number;
  status: 'pending' | 'success' | 'failed';
  reason: string | null;
  paystack_transfer_code: string | null;
  balance_after_debit: number;
  created_at: string | null;
  settled_at: string | null;
};

type WithdrawalResponse = {
  transfer_reference: string;
  status: 'pending' | 'success' | 'failed';
  new_balance_points: number;
  fee_kobo: number;
  amount_kobo: number;
};

const MIN_WITHDRAWAL_KOBO = 100_000; // ₦1,000 — matches the server's Pydantic floor.

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function WalletScreen() {
  const scheme = useEffectiveScheme();
  const c = PagePay[scheme];
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useTranslation();

  // Fetch ad config for native unit
  const [nativeAdUnit, setNativeAdUnit] = useState('');
  const { data: adConfig } = useQuery({
    queryKey: ['ads-config'],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/config/ads?env=${PLATFORM_ENV}`);
      if (!res.ok) return {};
      return (await res.json()) as Record<string, string>;
    },
  });

  useEffect(() => {
    if (adConfig) {
      const platform = Platform.OS;
      const unitKey = platform === 'android' ? 'in_feed_android' : 'in_feed_ios';
      setNativeAdUnit(adConfig[unitKey] || '');
    }
  }, [adConfig]);

  // If the user just verified their PIN for a withdrawal, open the
  // withdrawal modal automatically.
  useFocusEffect(
    useCallback(() => {
      if (consumePendingWithdrawAfterPin() && payoutAccount) {
        setShowWithdraw(true);
      }
    }, [payoutAccount]),
  );

  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) throw new Error('Failed to load profile');
      return (await res.json()) as UserMe;
    },
  });

  const txQ = useQuery({
    queryKey: ['wallet', 'transactions'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/wallet/transactions');
      if (!res.ok) throw new Error('Failed to load transactions');
      return (await res.json()) as Transaction[];
    },
  });

  const payoutQ = useQuery({
    queryKey: ['payout', 'account'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/payouts/account');
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to load payout account');
      return (await res.json()) as PayoutAccount;
    },
    staleTime: 30_000,
  });

  const pinStatusQ = useQuery({
    queryKey: ['pin', 'status'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/pin/status');
      if (!res.ok) throw new Error('Failed to load PIN status');
      return (await res.json()) as { has_pin: boolean };
    },
  });

  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ['pin', 'status'] });
    }, [qc]),
  );

  const withdrawalsQ = useQuery({
    queryKey: ['payouts', 'transactions'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/payouts/transactions');
      if (!res.ok) throw new Error('Failed to load withdrawals');
      const body = (await res.json()) as { data: WithdrawalRecord[]; meta: { total: number } };
      return body.data;
    },
  });

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showLink, setShowLink] = useState(false);
  // Set to true after a successful withdrawal in this session so the
  // auto-open can fire once the user closes the Link modal.
  const [pendingWithdraw, setPendingWithdraw] = useState(false);

  // The wallet is the proof a session paid out. Refetch when the tab regains
  // focus so a reading session that just ended shows up immediately.
  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
      qc.invalidateQueries({ queryKey: ['payout', 'account'] });
      qc.invalidateQueries({ queryKey: ['payouts', 'transactions'] });
    }, [qc]),
  );

  const balance = meQ.data?.points_balance ?? 0;
  const tier = meQ.data?.tier ?? 'free';
  const getTierLabel = (tier: string) => {
    const key = tier as 'free' | 'premium_monthly' | 'premium_yearly';
    return t(`wallet.tier.${key}`, { defaultValue: tier });
  };
  const transactions = txQ.data ?? [];
  const withdrawals = withdrawalsQ.data ?? [];
  const payoutAccount = payoutQ.data ?? null;
  const belowMin = balance < MIN_WITHDRAWAL_KOBO;

  const onRefresh = () => {
    qc.invalidateQueries({ queryKey: ['me'] });
    qc.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
    qc.invalidateQueries({ queryKey: ['payout', 'account'] });
    qc.invalidateQueries({ queryKey: ['payouts', 'transactions'] });
  };

  const handleWithdrawPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!payoutAccount) {
      setPendingWithdraw(true);
      setShowLink(true);
      return;
    }
    if (pinStatusQ.data?.has_pin) {
      router.push('/pin/verify?mode=verify&redirect=/(tabs)/wallet');
      return;
    }
    setShowWithdraw(true);
  }, [payoutAccount, pinStatusQ.data, router]);

  const handleLinkSaved = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['payout', 'account'] });
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
    // If the user backed out of the link flow, drop the pending intent
    // so a future visit to Wallet doesn't auto-open Withdraw.
    setPendingWithdraw(false);
  }, []);

  const handleWithdrawn = useCallback(
    (_resp: WithdrawalResponse) => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['payouts', 'transactions'] });
      void qc.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
    },
    [qc],
  );

  // The list renders a unified transaction history: reading-session earnings
  // on top, then withdrawals below. Combining them in a single FlatList
  // keeps the visual order consistent (newest first across both sources)
  // and avoids an awkward second card with its own header.
  const combinedItems: ListItem[] = [];
  for (const t of transactions) combinedItems.push({ kind: 'session', data: t });
  for (const w of withdrawals) combinedItems.push({ kind: 'withdrawal', data: w });
  // Both endpoints already return newest-first; we don't re-sort.

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <FlatList
        data={combinedItems}
        keyExtractor={(item, index) => {
          if (item.kind === 'session') return `s-${item.data.id}`;
          return `w-${item.data.reference}-${index}`;
        }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={meQ.isFetching || txQ.isFetching}
            onRefresh={onRefresh}
            tintColor={c.mint}
          />
        }
        ListHeaderComponent={
          <View>
            {/* Brand */}
            <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 32 }}>
              <PageMark />
              <Text
                style={{
                  fontFamily: Fonts.display,
                  fontSize: 22,
                  color: c.mint,
                  marginTop: 8,
                  letterSpacing: -0.5,
                }}
              >
                {t('wallet.title')}
              </Text>
            </View>

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
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                {t('wallet.balance_label')}
              </Text>
              {meQ.isLoading ? (
                <SkeletonBalanceCard />
              ) : (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                    <Text
                      style={{
                        fontFamily: Fonts.display,
                        fontSize: 48,
                        color: c.ink,
                        letterSpacing: -1.2,
                        lineHeight: 52,
                      }}
                    >
                      {formatPoints(balance)}
                    </Text>
                    <Text style={{ fontSize: 18, color: c.inkMuted, fontFamily: undefined, marginLeft: 4 }}>
                      {t('wallet.points_suffix')}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 13, color: c.inkMuted, marginTop: 4 }}>
                    {t('wallet.approx')} {formatKobo(balance)}
                  </Text>
                </>
              )}
              <View style={{ height: 1, backgroundColor: c.border, marginVertical: 16 }} />
              <Text style={{ fontSize: 13, color: c.inkMuted, marginBottom: 14 }}>
                {getTierLabel(tier)}
              </Text>

              {meQ.isLoading || payoutQ.isLoading ? (
                <ActivityIndicator color={c.mint} style={{ alignSelf: 'flex-start' }} />
              ) : (
                <View style={{ gap: 10 }}>
                  {/* Fund Wallet Button */}
                  <PrimaryButton
                    title={t('wallet.fund_wallet')}
                    onPress={() => router.push('/fund-wallet')}
                  />

                  {/* Withdraw Button */}
                  {belowMin ? (
                    <View style={{ gap: 4 }}>
                      <PrimaryButton
                        title={t('wallet.withdraw')}
                        onPress={handleWithdrawPress}
                        disabled
                      />
                      <Text
                        style={{
                          fontSize: 12,
                          color: c.inkMuted,
                          textAlign: 'center',
                        }}
                      >
                        {t('wallet.min_withdraw')}
                      </Text>
                    </View>
                  ) : (
                    <PrimaryButton title={t('wallet.withdraw')} onPress={handleWithdrawPress} />
                  )}
                </View>
              )}
            </View>

            {/* ── Pay Bills & Earn ──────────────────────────── */}
            <View style={{ marginBottom: 12 }}>
              <Text
                style={{
                  fontFamily: Fonts.display,
                  fontSize: 18,
                  color: c.ink,
                  letterSpacing: -0.3,
                }}
              >
                {t('wallet.pay_bills')}
              </Text>
              <Text style={{ fontSize: 12, color: c.inkMuted, marginTop: 2, marginBottom: 12 }}>
                {t('wallet.pay_bills_subtitle')}
              </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <BillsService
                    icon="phone-portrait-outline"
                    label={t('wallet.services.airtime')}
                    earn="3%"
                    color={c}
                    onPress={() => router.push('/buy-airtime')}
                  />
                  <BillsService
                    icon="wifi-outline"
                    label={t('wallet.services.data')}
                    earn="4%"
                    color={c}
                    onPress={() => router.push('/buy-data')}
                  />
                  <BillsService
                    icon="flash-outline"
                    label={t('wallet.services.electricity')}
                    earn="1%"
                    color={c}
                    onPress={() => router.push('/buy-electricity')}
                  />
                  <BillsService
                    icon="tv-outline"
                    label={t('wallet.services.tv')}
                    earn="1.5%"
                    color={c}
                    onPress={() => router.push('/buy-tv')}
                  />
                </View>
             </View>

            {/* Section title */}
            <Text
              style={{
                fontFamily: Fonts.display,
                fontSize: 18,
                color: c.ink,
                marginTop: 16,
                marginBottom: 12,
                letterSpacing: -0.3,
              }}
            >
              {t('wallet.history_title')}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          // Inject native ad every 4th transaction
          const shouldShowAd = (index + 1) % 4 === 0 && nativeAdUnit;

          return (
            <View>
              {item.kind === 'withdrawal' ? (
                <WithdrawalRow row={item.data} tokens={c} />
              ) : (
                <SessionRow item={item.data} tokens={c} />
              )}
              {shouldShowAd && (
                <NativeAdBanner
                  adUnit={nativeAdUnit}
                  sessionId={null}
                />
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          txQ.isLoading || withdrawalsQ.isLoading ? (
            <View>
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonTransactionRow key={i} />
              ))}
            </View>
          ) : (
            <View
              style={{
                backgroundColor: c.card,
                borderRadius: 14,
                padding: 28,
                borderWidth: 1,
                borderColor: c.border,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontFamily: Fonts.display,
                  fontSize: 16,
                  color: c.ink,
                  marginBottom: 4,
                }}
              >
                {t('wallet.no_transactions')}
              </Text>
              <Text style={{ fontSize: 13, color: c.inkMuted, textAlign: 'center' }}>
                {t('wallet.no_transactions_hint')}
              </Text>
            </View>
          )
        }
      />

      <WithdrawModal
        visible={showWithdraw}
        balancePoints={balance}
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

// ── Row components ──────────────────────────────────────────────────

type ListItem =
  | { kind: 'session'; data: Transaction }
  | { kind: 'withdrawal'; data: WithdrawalRecord };

function SessionRow({
  item,
  tokens,
}: {
  item: Transaction;
  tokens: (typeof PagePay)['light'];
}) {
  const { t } = useTranslation();

  const showPending = item.type === 'pending' && item.points > 0;
  const isEarn = item.type === 'earn';

  return (
    <View
      style={[
        rowStyles.row,
        { backgroundColor: tokens.card, borderColor: tokens.border },
      ]}
    >
      <View
        style={[
          rowStyles.icon,
          {
            backgroundColor: tokens.mintSoft,
          },
        ]}
      >
        <Ionicons
          name="book-outline"
          size={16}
          color={tokens.mint}
        />
      </View>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text
          style={{ fontSize: 14, fontWeight: '500', color: tokens.ink, marginBottom: 2 }}
          numberOfLines={1}
        >
          {item.description}
        </Text>
        <Text style={{ fontSize: 12, color: tokens.inkMuted }}>{formatDate(item.date)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text
          style={{
            fontSize: 15,
            fontWeight: '600',
            color: showPending
              ? tokens.signal
              : isEarn
                ? tokens.mint
                : tokens.inkMuted,
          }}
        >
          {item.points > 0 ? '+' : ''}
          {item.points} {t('wallet.points_suffix')}
        </Text>
        {showPending ? (
          <Text
            style={{
              fontSize: 10,
              color: tokens.inkMuted,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginTop: 2,
            }}
          >
            {t('wallet.session_pending')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function WithdrawalRow({
  row,
  tokens,
}: {
  row: WithdrawalRecord;
  tokens: (typeof PagePay)['light'];
}) {
  const { t } = useTranslation();
  
  const isPending = row.status === 'pending';
  const isSuccess = row.status === 'success';
  const isFailed = row.status === 'failed';

  return (
    <View
      style={[
        rowStyles.row,
        { backgroundColor: tokens.card, borderColor: tokens.border },
      ]}
    >
      <View
        style={[
          rowStyles.icon,
          {
            backgroundColor: isFailed ? tokens.signalSoft : tokens.mintSoft,
          },
        ]}
      >
        <Ionicons
          name={
            isFailed
              ? 'alert-circle'
              : isSuccess
                ? 'checkmark-circle'
                : 'paper-plane'
          }
          size={16}
          color={isFailed ? tokens.signal : tokens.mint}
        />
      </View>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text
          style={{ fontSize: 14, fontWeight: '500', color: tokens.ink, marginBottom: 2 }}
          numberOfLines={1}
        >
          {isFailed
            ? t('wallet.withdrawal_failed')
            : isPending
              ? t('wallet.withdrawal_pending')
              : t('wallet.withdrawal_success')}
        </Text>
        <Text style={{ fontSize: 12, color: tokens.inkMuted }}>
          {formatDate(row.settled_at ?? row.created_at)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text
          style={{
            fontSize: 15,
            fontWeight: '600',
            color: isFailed ? tokens.signal : tokens.mint,
          }}
        >
          −{formatPoints(row.amount_kobo)} {t('wallet.points_suffix')}
        </Text>
        {row.fee_kobo > 0 ? (
          <Text
            style={{
              fontSize: 10,
              color: tokens.inkMuted,
              letterSpacing: 0.4,
              marginTop: 2,
            }}
          >
            {t('wallet.fee_label', { amount: formatKobo(row.fee_kobo) })}
          </Text>
        ) : null}
        {isPending ? (
          <Text
            style={{
              fontSize: 10,
              color: tokens.inkMuted,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginTop: 2,
            }}
          >
            {t('wallet.session_pending')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ── Bills & Earn service button ──────────────────────────────────

function BillsService({
  icon,
  label,
  earn,
  color: c,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  earn: string;
  color: (typeof PagePay)['light'];
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flex: 1,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 6,
        alignItems: 'center',
        gap: 8,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: c.mintSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={16} color={c.mint} />
      </View>
      <Text style={{ fontSize: 11, fontWeight: '600', color: c.ink, textAlign: 'center' }}>
        {label}
      </Text>
      <View
        style={{
          backgroundColor: c.mintSoft,
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: 6,
        }}
      >
        <Text style={{ fontSize: 9, fontWeight: '600', color: c.mint }}>{earn}</Text>
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
});
