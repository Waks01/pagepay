import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { View, Text, FlatList, RefreshControl, ActivityIndicator, StyleSheet, Platform, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiFetch } from '@/src/shared/api/client';
import { consumePendingWithdrawAfterPin } from '@/src/shared/lib/pin-verify-flag';
import { formatKobo, formatPoints, pointsToNairaString, koboToPoints } from '@/src/shared/lib/money';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { useAdsConfig } from '@/src/shared/hooks/use-ads-config';
import { useCurrentUser, useCurrentUserStore } from '@/src/shared/lib/current-user';
import { PagePay, Fonts } from '@/constants/theme';
import { PrimaryButton } from '@/components/PrimaryButton';
import NotificationBell from '@/components/NotificationBell';
import { WithdrawModal } from '@/components/WithdrawModal';
import {
  LinkPayoutAccountModal,
  type PayoutAccount,
} from '@/components/LinkPayoutAccountModal';
import { SkeletonBalanceCard, SkeletonTransactionRow } from '@/components/skeletons';
import { NativeAdBanner } from '@/components/ads/NativeAdBanner';

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
  status: 'pending' | 'success' | 'failed';
  new_balance_points: number;
  fee_kobo: number;
  amount_kobo: number;
};

const MIN_WITHDRAWAL_POINTS = koboToPoints(100_000); // ₦1,000 minimum → 10,000 points at 10 pts/₦

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
  const params = useLocalSearchParams<{ welcomeBonus?: string }>();
  const welcomeBonus = Number(params.welcomeBonus ?? 0);
  const insets = useSafeAreaInsets();

  // Fetch ad config for native unit. useAdsConfig has its own
  // 1-hour staleTime and is shared with the AdSlotProvider, home,
  // and catalog — fetched once and reused.
  const [nativeAdUnit, setNativeAdUnit] = useState('');
  const { data: adConfig } = useAdsConfig();

  useEffect(() => {
    if (adConfig) {
      const platform = Platform.OS;
      const unitKey = platform === 'android' ? 'in_feed_android' : 'in_feed_ios';
      setNativeAdUnit(adConfig[unitKey] || '');
    }
  }, [adConfig]);

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

  const txQ = useQuery({
    queryKey: ['wallet', 'transactions'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/wallet/transactions');
      if (!res.ok) throw new Error('Failed to load transactions');
      return (await res.json()) as Transaction[];
    },
  });

  const pinStatusQ = useQuery({
    queryKey: ['pin', 'status'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/pin/status');
      if (!res.ok) throw new Error('Failed to load PIN status');
      return (await res.json()) as { has_pin: boolean };
    },
  });

  const withdrawalsQ = useQuery({
    queryKey: ['payouts', 'transactions'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/payouts/transactions');
      if (!res.ok) throw new Error('Failed to load withdrawals');
      const body = (await res.json()) as { data: WithdrawalRecord[]; meta: { total: number } };
      return body.data;
    },
  });

  const paymentsQ = useQuery({
    queryKey: ['payments', 'history'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/payments/history');
      if (!res.ok) throw new Error('Failed to load payments');
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
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['payouts', 'transactions'] });
      void qc.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
    },
    [qc],
  );

  const balance = meQ?.points_balance ?? 0;
  const tier = meQ?.tier ?? 'free';
  const getTierLabel = (tier: string) => {
    const key = tier as 'free' | 'premium_monthly' | 'premium_yearly';
    return t(`wallet.tier.${key}`, { defaultValue: tier });
  };
  const transactions = txQ.data ?? [];
  const withdrawals = withdrawalsQ.data ?? [];
  const belowMin = balance < MIN_WITHDRAWAL_POINTS;

  const onRefresh = () => {
    // The user object is in the global store — refresh it explicitly
    // (instead of going through TanStack Query's invalidation, which
    // doesn't know about the store). The other wallet queries below
    // are still TanStack-Query-managed and use invalidation.
    void useCurrentUserStore.getState().refresh();
    qc.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
    qc.invalidateQueries({ queryKey: ['payout', 'account'] });
    qc.invalidateQueries({ queryKey: ['payouts', 'transactions'] });
    qc.invalidateQueries({ queryKey: ['payments', 'history'] });
  };

  const handleWithdrawPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!payoutAccount) {
      setPendingWithdraw(true);
      setShowLink(true);
      return;
    }
    if (pinStatusQ.data?.has_pin) {
      router.push('/pin/verify?mode=verify&redirect=/(app)/wallet');
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

  const combinedItems: ListItem[] = [];
  for (const t of transactions) combinedItems.push({ kind: 'session', data: t });
  for (const p of paymentsQ.data ?? []) combinedItems.push({ kind: 'payment', data: p });
  for (const w of withdrawals) combinedItems.push({ kind: 'withdrawal', data: w });
  combinedItems.sort((a, b) => {
    const da = a.kind === 'session' ? a.data.date : a.data.created_at ?? '';
    const db = b.kind === 'session' ? b.data.date : b.data.created_at ?? '';
    return db.localeCompare(da);
  });

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border, marginTop: insets.top }]}>
        <View style={styles.headerRow}>
          <Image source={require('@/assets/images/icon.png')} style={styles.headerIcon} />
          <Text style={[styles.headerTitle, { color: c.ink, fontFamily: Fonts.display }]}>
            {t('wallet.title')}
          </Text>
          <NotificationBell />
        </View>
      </View>
      <FlatList
        data={combinedItems}
        keyExtractor={(item, index) => {
          if (item.kind === 'session') return `s-${item.data.id}`;
          if (item.kind === 'payment') return `p-${item.data.id}-${index}`;
          return `w-${item.data.reference}-${index}`;
        }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={txQ.isFetching || paymentsQ.isFetching}
            onRefresh={onRefresh}
            tintColor={c.mint}
          />
        }
        ListHeaderComponent={
          <View>
            {/* One-time welcome bonus banner — appears after a fresh
                signup+verification lands on this tab. Driven by the
                `welcomeBonus` route param set by verify-email-code.tsx.
                `welcomeNaira` is computed from EXPO_PUBLIC_POINTS_PER_NAIRA
                via pointsToNairaString so the value is in lockstep with
                the backend at POINTS_PER_NAIRA env var. */}
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="gift" size={22} color={c.mint} />
                  <Text style={{ fontFamily: Fonts.display, fontSize: 16, color: c.ink, flex: 1 }}>
                    {t('verify_email.welcome_title')}
                  </Text>
                </View>
                <Text style={{ fontSize: 14, color: c.inkMuted, lineHeight: 20 }}>
                  {t('verify_email.welcome_bonus', {
                    points: welcomeBonus.toLocaleString(),
                    naira: pointsToNairaString(welcomeBonus).replace(/^₦/, ''),
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
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                {t('wallet.balance_label')}
              </Text>
              {userLoading ? (
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
                    {t('wallet.approx')} {pointsToNairaString(balance)}
                  </Text>
                </>
              )}
              <View style={{ height: 1, backgroundColor: c.border, marginVertical: 16 }} />
              <Text style={{ fontSize: 13, color: c.inkMuted, marginBottom: 14 }}>
                {getTierLabel(tier)}
              </Text>

              {userLoading || payoutQ.isLoading ? (
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

            {/* Section title */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
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
              <TouchableOpacity onPress={() => router.push('/wallet/history')} hitSlop={8}>
                <Text style={{ color: c.mint, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13 }}>
                  View All
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        renderItem={({ item, index }) => {
          // Inject native ad every 4th transaction
          const shouldShowAd = (index + 1) % 4 === 0 && nativeAdUnit;

          const handlePress = () => {
            const txType = item.kind === 'withdrawal' ? 'withdrawal' : item.kind === 'payment' ? 'payment' : 'session';
            const txId = item.kind === 'withdrawal' ? item.data.reference : String(item.data.id);
            router.push({
              pathname: '/(app)/wallet/[id]',
              params: {
                id: txId,
                kind: txType,
              },
            });
          };

          return (
            <View>
              {item.kind === 'withdrawal' ? (
                <WithdrawalRow row={item.data} tokens={c} onPress={handlePress} />
              ) : item.kind === 'payment' ? (
                <PaymentRow item={item.data} tokens={c} onPress={handlePress} />
              ) : (
                <SessionRow item={item.data} tokens={c} onPress={handlePress} />
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
          txQ.isLoading || withdrawalsQ.isLoading || paymentsQ.isLoading ? (
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
  | { kind: 'payment'; data: PaymentRecord }
  | { kind: 'withdrawal'; data: WithdrawalRecord };

function PaymentRow({
  item,
  tokens,
  onPress,
}: {
  item: PaymentRecord;
  tokens: (typeof PagePay)['light'];
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const isSuccess = item.status === 'success';
  const isPending = item.status === 'pending';
  const isFailed = item.status === 'failed';

  const iconName = isSuccess ? 'checkmark-circle' : isPending ? 'time' : 'close-circle';
  const iconColor = isSuccess ? tokens.mint : isPending ? tokens.inkMuted : tokens.signal;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
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
            backgroundColor: isSuccess ? tokens.mintSoft : tokens.mintSoft,
          },
        ]}
      >
        <Ionicons name={iconName as any} size={16} color={iconColor} />
      </View>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text
          style={{ fontSize: 14, fontWeight: '500', color: tokens.ink, marginBottom: 2 }}
          numberOfLines={1}
        >
          {item.tier_name}
        </Text>
        <Text style={{ fontSize: 12, color: tokens.inkMuted }}>
          {formatDate(item.created_at)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text
          style={{
            fontSize: 15,
            fontWeight: '600',
            color: isSuccess ? tokens.mint : isPending ? tokens.inkMuted : tokens.signal,
          }}
        >
          {isSuccess ? '+' : ''}₦{item.amount_naira.toLocaleString()}
        </Text>
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
            Pending
          </Text>
        ) : null}
      </View>
    </View>
    </TouchableOpacity>
  );
}

function SessionRow({
  item,
  tokens,
  onPress,
}: {
  item: Transaction;
  tokens: (typeof PagePay)['light'];
  onPress?: () => void;
}) {
  const { t } = useTranslation();

  const showPending = item.type === 'pending' && item.points > 0;
  const isEarn = item.type === 'earn';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
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
    </TouchableOpacity>
  );
}

function WithdrawalRow({
  row,
  tokens,
  onPress,
}: {
  row: WithdrawalRecord;
  tokens: (typeof PagePay)['light'];
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  
  const isPending = row.status === 'pending';
  const isSuccess = row.status === 'success';
  const isFailed = row.status === 'failed';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
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
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    textAlign: 'center',
  },
});

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
