import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  SectionList,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/src/shared/api/client';
import { PagePay, Fonts } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { formatPoints, pointsToNairaString, koboToPoints } from '@/src/shared/lib/money';
import NotificationBell from '@/components/NotificationBell';
import { SkeletonTransactionRow, SkeletonBalanceCard } from '@/components/skeletons';
import { PageHeader } from '@/components/PageHeader';
import type { HistoryItem, UserMe } from '@/src/shared/types';

type TxType = HistoryItem['type'] | 'airtime' | 'data' | 'electricity' | 'internet' | 'tv' | 'recharge' | 'betting' | 'isp' | 'education' | 'sms' | 'wallet' | 'withdraw' | 'ad' | 'read' | 'study' | 'premium' | 'bonus' | 'earn' | 'spend';

type TxItem = {
  id: string;
  type: TxType;
  description: string;
  amount: number;
  status: 'success' | 'pending' | 'failed';
  date: string;
  txId: string;
  ref: string;
  details: Record<string, unknown>;
};

const getTxMeta = (type: string, tokens: (typeof PagePay)['light']) => {
  const map: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; accent: string; accentHex: string }> = {
    airtime:     { label: 'Airtime',          icon: 'call-outline',       color: tokens.mint, accent: tokens.mintFaint,    accentHex: '#10B981' },
    data:        { label: 'Data Bundle',      icon: 'wifi-outline',       color: tokens.indigo, accent: tokens.mintFaint,   accentHex: '#3B82F6' },
    electricity: { label: 'Electricity',      icon: 'flash-outline',      color: tokens.gold, accent: tokens.signalSoft,  accentHex: '#F59E0B' },
    internet:    { label: 'Internet',         icon: 'globe-outline',      color: tokens.indigo, accent: tokens.mintFaint,   accentHex: '#8B5CF6' },
    tv:          { label: 'TV Subscription',  icon: 'tv-outline',         color: tokens.signal, accent: tokens.signalFaint, accentHex: '#EC4899' },
    recharge:    { label: 'Recharge Pin',     icon: 'ticket-outline',     color: tokens.indigo, accent: tokens.mintFaint,   accentHex: '#06B6D4' },
    betting:     { label: 'Betting',          icon: 'diamond-outline',    color: tokens.mint, accent: tokens.mintFaint,    accentHex: '#10B981' },
    isp:         { label: 'ISP',              icon: 'globe-outline',      color: tokens.indigo, accent: tokens.mintFaint,   accentHex: '#14B8A6' },
    education:   { label: 'Education',        icon: 'school-outline',     color: tokens.gold, accent: tokens.signalSoft,  accentHex: '#F97316' },
    sms:         { label: 'Bulk SMS',         icon: 'chatbubbles-outline',color: tokens.inkMuted, accent: tokens.paper2,   accentHex: '#64748B' },
    wallet:      { label: 'Wallet Funding',   icon: 'wallet-outline',     color: tokens.mint, accent: tokens.mintFaint,    accentHex: '#0E7C66' },
    withdraw:    { label: 'Withdrawal',       icon: 'arrow-up-circle-outline', color: tokens.gold, accent: tokens.signalSoft, accentHex: '#F59E0B' },
    ad:          { label: 'Ad Reward',        icon: 'play-circle-outline',color: tokens.signal, accent: tokens.signalFaint, accentHex: '#EF4444' },
    read:        { label: 'Reading Reward',   icon: 'book-outline',       color: tokens.indigo, accent: tokens.mintFaint,   accentHex: '#8B5CF6' },
    study:       { label: 'Study Session',    icon: 'school-outline',     color: tokens.indigo, accent: tokens.mintFaint,   accentHex: '#6366F1' },
    premium:     { label: 'Premium Subscription', icon: 'star-outline',   color: tokens.gold, accent: tokens.signalSoft,  accentHex: '#D97706' },
    bonus:       { label: 'Bonus Reward',     icon: 'gift-outline',       color: tokens.signal, accent: tokens.signalFaint, accentHex: '#EC4899' },
    earn:        { label: 'Points Earned',    icon: 'trending-up-outline',color: tokens.mint, accent: tokens.mintFaint,    accentHex: '#0E7C66' },
    spend:       { label: 'Points Spent',     icon: 'trending-down-outline', color: tokens.inkMuted, accent: tokens.paper2, accentHex: '#64748B' },
  };
  return map[type] || { ...map['spend'] };
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'earn', label: 'Earned' },
  { key: 'spend', label: 'Spent' },
  { key: 'airtime', label: 'Airtime' },
  { key: 'data', label: 'Data' },
  { key: 'electricity', label: 'Electricity' },
  { key: 'internet', label: 'Internet' },
  { key: 'tv', label: 'TV' },
  { key: 'recharge', label: 'Recharge' },
  { key: 'betting', label: 'Betting' },
  { key: 'isp', label: 'ISP' },
  { key: 'education', label: 'Education' },
  { key: 'sms', label: 'Bulk SMS' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'withdraw', label: 'Withdrawals' },
  { key: 'ad', label: 'Ad Reward' },
  { key: 'read', label: 'Reading' },
  { key: 'study', label: 'Study' },
  { key: 'premium', label: 'Premium' },
  { key: 'bonus', label: 'Bonus' },
] as const;

const DATE_FILTERS = [
  { key: 'all', label: 'All Dates' },
  { key: 'Today', label: 'Today' },
  { key: 'Yesterday', label: 'Yesterday' },
  { key: 'This Week', label: 'This Week' },
  { key: 'This Month', label: 'This Month' },
] as const;

function dateLabel(d: Date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (target.getTime() === today.getTime()) return 'Today';
  if (target.getTime() === yesterday.getTime()) return 'Yesterday';
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000);
  if (diffDays < 7) return 'This Week';
  if (diffDays < 30) return 'This Month';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

const fmtTime = (d: Date) => {
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function TransactionHistoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();

  const [filter, setFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  const resetPage = () => setPage(0);

  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const res = await apiFetch('/api/v1/auth/me');
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Server returned ${res.status}`);
        }
        return (await res.json()) as UserMe;
      } catch (e) {
        if (e instanceof Error) throw e;
        throw new Error(typeof e === 'string' ? e : 'Failed to load profile');
      }
    },
  });
  const balance = meQ.data?.points_balance ?? 0;

   const historyQ = useQuery({
    queryKey: ['wallet', 'history', filter, dateFilter, search, page],
    queryFn: async () => {
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        if (filter !== 'all') {
          if (filter === 'earn' || filter === 'spend') {
            params.set('direction', filter);
          } else {
            params.set('type', filter);
          }
        }
        if (dateFilter !== 'all') params.set('date', dateFilter);
        if (search) params.set('search', search);
        const res = await apiFetch(`/api/v1/wallet/history?${params.toString()}`);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Server returned ${res.status}`);
        }
        return (await res.json()) as HistoryItem[];
      } catch (e) {
        if (e instanceof Error) throw e;
        throw new Error(typeof e === 'string' ? e : 'Failed to load history');
      }
    },
  });

  const loadMore = () => setPage((p) => p + 1);
  const hasMore = historyQ.data ? historyQ.data.length >= PAGE_SIZE : false;

  const transactions: TxItem[] = useMemo(() => {
    return (historyQ.data ?? []).map((tx, index) => {
      // The backend returns `amount` in two different units depending on the
      // transaction kind:
      //   - 'read' | 'ad' | 'study' | 'bonus' → POINTS (signed: +earn / -spend)
      //   - 'bill' | 'payment' | 'withdrawal'  → KOBO   (signed: +credit / -debit)
      // Normalise both to a signed points value so the list always shows "pts".
      const FIAT_KINDS = new Set(['bill', 'payment', 'withdrawal']);
      const rawAmount = tx.amount ?? 0;
      const signedPoints = FIAT_KINDS.has(tx.kind)
        ? Math.sign(rawAmount) * koboToPoints(Math.abs(rawAmount))
        : rawAmount;

      return {
        id: tx.txId || tx.ref || `tx-${index}`,
        type: tx.type as TxType,
        description: tx.description || 'Transaction',
        amount: signedPoints,
        status: tx.status || 'success',
        date: typeof tx.date === 'string' ? tx.date : new Date(tx.date).toISOString(),
        txId: tx.txId || '',
        ref: tx.ref || '',
        details: tx.details || {},
      };
    });
  }, [historyQ.data]);

  const grouped = useMemo(() => {
    const map: Record<string, TxItem[]> = {};
    transactions.forEach((tx) => {
      const label = dateLabel(new Date(tx.date));
      if (!map[label]) map[label] = [];
      map[label].push(tx);
    });
    return map;
  }, [transactions]);

  const order = ['Today', 'Yesterday', 'This Week', 'This Month'];
  const sortedKeys = Object.keys(grouped).sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return 0;
  });

  const sections = useMemo(
    () => (Array.isArray(sortedKeys) ? sortedKeys.map((label) => ({ title: label, data: grouped[label] || [] })) : []),
    [sortedKeys, grouped],
  );

  const openDetail = useCallback((tx: TxItem) => {
    const kindMap: Record<string, string> = {
      BT: 'bill',
      PAY: 'payment',
      WD: 'withdrawal',
      RS: 'session',
      AD: 'ad',
      ST: 'study',
      PC: 'bonus',
    };
    const prefix = (tx.txId || '').split('-')[0];
    const kind = kindMap[prefix] || 'history';
    router.push({
      pathname: '/(app)/wallet/[id]',
      params: {
        id: tx.txId || tx.id,
        kind,
        // Pass the full payload so the detail screen can render immediately
        // without a second round-trip. URL-encoded JSON in a query param.
        item: JSON.stringify(tx),
      },
    });
  }, [router]);

  const renderItem = useCallback(({ item, index }: { item: TxItem; index: number }) => {
    const meta = getTxMeta(item.type, tokens) || getTxMeta('spend', tokens);
    const isPositive = item.amount > 0;
    const prefix = isPositive ? '+' : '';
    const status = item.status || 'success';
    const statusBg = status === 'success' ? tokens.mintSoft : status === 'pending' ? '#FFFBEB' : tokens.signalFaint;
    const statusColor = status === 'success' ? tokens.mint : status === 'pending' ? '#92400E' : tokens.error;
    const accentBg = meta.accent || tokens.paper2;
    const iconColor = meta.color || tokens.inkMuted;
    const cardBg = tokens.card || tokens.paper;
    const borderC = tokens.border || tokens.paper2;
    const inkC = tokens.ink || '#000';
    const mutedC = tokens.inkMuted || '#666';
    const mintC = tokens.mint || '#0E7C66';

    return (
      <View style={{ marginBottom: 8 }}>
        <TouchableOpacity
          onPress={() => openDetail(item)}
          activeOpacity={0.7}
          style={[
            styles.txCard,
            { backgroundColor: cardBg, borderColor: borderC, borderLeftColor: meta.accentHex, borderLeftWidth: 3 },
          ]}
        >
          <View style={[styles.txIcon, { backgroundColor: accentBg }]}>
            <Ionicons name={meta.icon} size={20} color={iconColor} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.txTitle, { color: inkC }]} numberOfLines={1}>
              {item.description}
            </Text>
            <Text style={[styles.txMeta, { color: mutedC }]}>
              {fmtTime(new Date(item.date))} · {item.txId}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
            <Text style={[styles.txAmount, { color: isPositive ? mintC : inkC }]}>
              {prefix}{Math.abs(item.amount).toLocaleString()} pts
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {status}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [tokens, openDetail]);

  const renderSectionHeader = useCallback(({ section }: { section: { title: string } }) => {
    const isActive = dateFilter === section.title;
    return (
      <TouchableOpacity
        onPress={() => { setDateFilter(isActive ? 'all' : section.title); resetPage(); }}
        activeOpacity={0.7}
        style={styles.dateHeaderRow}
      >
        <Text style={[styles.dateHeader, { color: isActive ? tokens.mint : tokens.inkMuted }]}>
          {section.title}
        </Text>
        {isActive && (
          <Ionicons name="close-circle" size={14} color={tokens.mint} />
        )}
      </TouchableOpacity>
    );
  }, [tokens, dateFilter, resetPage]);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper }}>
      <PageHeader
        title="Wallet"
        showBack
        right={<NotificationBell />}
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        marginTop={insets.top}
        tokens={tokens}
      />

      {historyQ.isLoading ? (
        <View style={{ padding: 16 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonTransactionRow key={i} />
          ))}
        </View>
      ) : historyQ.isError ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>⚠️</Text>
          <Text style={[styles.errorTitle, { color: tokens.ink }]}>Couldn't load transactions</Text>
          <Text style={[styles.errorText, { color: tokens.inkMuted }]}>
            {(() => {
              const err: any = historyQ.error;
              if (err && typeof err === 'object' && 'message' in err) return String(err.message);
              if (typeof err === 'string') return err;
              return 'Network error';
            })()}
          </Text>
          <TouchableOpacity
            onPress={() => historyQ.refetch()}
            style={[styles.retryBtn, { backgroundColor: tokens.mint }]}
          >
            <Text style={[styles.retryText, { color: tokens.mintText }]}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : !sections || sections.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📭</Text>
          <Text style={[styles.emptyTitle, { color: tokens.ink }]}>No transactions found</Text>
          <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
            Try adjusting your filters or search query
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.id}-${item.date}`}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          ListHeaderComponent={
            <View>
              {/* Balance Card */}
              <View style={{ paddingTop: 16, paddingBottom: 8 }}>
                {meQ.isLoading ? (
                  <SkeletonBalanceCard />
                ) : (
                  <View style={[styles.balanceCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
                    <Text style={[styles.balanceLabel, { color: tokens.inkMuted }]}>Available Balance</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={[styles.balanceAmount, { color: tokens.ink, fontFamily: Fonts.display }]}>
                        {formatPoints(balance)}
                      </Text>
                      <Text style={[styles.balanceSuffix, { color: tokens.inkMuted }]}> pts</Text>
                    </View>
                    <Text style={[styles.balanceSub, { color: tokens.inkMuted }]}>
                      ≈ {pointsToNairaString(balance)}
                    </Text>
                  </View>
                )}
              </View>

              {/* Date Filters */}
              <View style={{ marginBottom: 8 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
                  {DATE_FILTERS.map((f) => (
                    <TouchableOpacity
                      key={f.key}
                      onPress={() => { setDateFilter(f.key); resetPage(); }}
                      style={[
                        styles.filterChip,
                        dateFilter === f.key ? { backgroundColor: tokens.mint, borderColor: tokens.mint } : { backgroundColor: tokens.card, borderColor: tokens.border },
                      ]}
                    >
                      <Ionicons
                        name="calendar-outline"
                        size={12}
                        color={dateFilter === f.key ? tokens.mintText : tokens.inkMuted}
                        style={{ marginRight: 4 }}
                      />
                      <Text style={[styles.filterLabel, { color: dateFilter === f.key ? tokens.mintText : tokens.inkMuted }]}>
                        {f.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Type Filters */}
              <View style={{ marginBottom: 12 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
                  {FILTERS.map((f) => (
                    <TouchableOpacity
                      key={f.key}
                      onPress={() => { setFilter(f.key); resetPage(); }}
                      style={[
                        styles.filterChip,
                        filter === f.key ? { backgroundColor: tokens.mint, borderColor: tokens.mint } : { backgroundColor: tokens.card, borderColor: tokens.border },
                      ]}
                    >
                      <Text style={[styles.filterLabel, { color: filter === f.key ? tokens.mintText : tokens.inkMuted }]}>
                        {f.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Search */}
              <View style={[styles.searchWrap, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
                <Ionicons name="search-outline" size={16} color={tokens.inkMuted} />
                <TextInput
                  style={[styles.searchInput, { color: tokens.ink }]}
                  placeholder="Search transactions..."
                  placeholderTextColor={tokens.inkMuted}
                  value={search}
                  onChangeText={(text) => { setSearch(text); resetPage(); }}
                  autoCapitalize="none"
                  returnKeyType="search"
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={tokens.inkMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>📭</Text>
              <Text style={[styles.emptyTitle, { color: tokens.ink }]}>No transactions found</Text>
              <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
                Try adjusting your filters or search query
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={historyQ.isRefetching}
              onRefresh={() => historyQ.refetch()}
              tintColor={tokens.mint}
            />
          }
          stickySectionHeadersEnabled={false}
          initialNumToRender={12}
          windowSize={8}
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity
                onPress={loadMore}
                disabled={historyQ.isFetching}
                style={[styles.loadMoreBtn, { backgroundColor: tokens.card, borderColor: tokens.border }]}
              >
                <Text style={[styles.loadMoreText, { color: tokens.mint }]}>
                  {historyQ.isFetching ? 'Loading...' : 'Load More'}
                </Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 20,
    letterSpacing: -0.2,
    flex: 1,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  balanceCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 4,
  },
  balanceLabel: {
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1.2,
    lineHeight: 48,
  },
  balanceSuffix: {
    fontSize: 18,
    marginLeft: 4,
  },
  balanceSub: {
    fontSize: 13,
    marginTop: 4,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: 8,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  dateHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 8,
    paddingLeft: 4,
  },
  dateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    // Subtle elevation per the design preview (line 142: box-shadow).
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  txIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  txMeta: {
    fontSize: 12,
  },
  txAmount: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
  },
  loadMoreBtn: {
    marginTop: 16,
    marginBottom: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
