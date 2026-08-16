import { useCallback, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { apiFetch } from '@/src/shared/api/client';
import { PagePay, Fonts } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { formatPoints, pointsToNairaString } from '@/src/shared/lib/money';
import NotificationBell from '@/components/NotificationBell';
import { SkeletonTransactionRow } from '@/components/skeletons';
import type { UserMe } from '@/src/shared/types';

type TxType = 'airtime' | 'data' | 'electricity' | 'internet' | 'tv' | 'recharge' | 'betting' | 'isp' | 'education' | 'sms' | 'wallet' | 'withdraw' | 'ad' | 'read' | 'study' | 'premium' | 'bonus' | 'earn' | 'spend';

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
  const map: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; accent: string }> = {
    airtime:     { label: 'Airtime',          icon: 'call-outline',       color: tokens.mint, accent: tokens.mintFaint },
    data:        { label: 'Data Bundle',      icon: 'wifi-outline',       color: tokens.indigo, accent: tokens.mintFaint },
    electricity: { label: 'Electricity',      icon: 'flash-outline',      color: tokens.gold, accent: tokens.pendingSoft },
    internet:    { label: 'Internet',         icon: 'globe-outline',      color: tokens.indigo, accent: tokens.mintFaint },
    tv:          { label: 'TV Subscription',  icon: 'tv-outline',         color: tokens.signal, accent: tokens.signalFaint },
    recharge:    { label: 'Recharge Pin',     icon: 'ticket-outline',     color: tokens.indigo, accent: tokens.mintFaint },
    betting:     { label: 'Betting',          icon: 'diamond-outline',    color: tokens.mint, accent: tokens.mintFaint },
    isp:         { label: 'ISP',              icon: 'globe-outline',      color: tokens.indigo, accent: tokens.mintFaint },
    education:   { label: 'Education',        icon: 'school-outline',     color: tokens.gold, accent: tokens.pendingSoft },
    sms:         { label: 'Bulk SMS',         icon: 'chatbubbles-outline',color: tokens.inkMuted, accent: tokens.paper2 },
    wallet:      { label: 'Wallet Funding',   icon: 'wallet-outline',     color: tokens.mint, accent: tokens.mintFaint },
    withdraw:    { label: 'Withdrawal',       icon: 'arrow-up-circle-outline', color: tokens.gold, accent: tokens.pendingSoft },
    ad:          { label: 'Ad Reward',        icon: 'play-circle-outline',color: tokens.signal, accent: tokens.signalFaint },
    read:        { label: 'Reading Reward',   icon: 'book-outline',       color: tokens.indigo, accent: tokens.mintFaint },
    study:       { label: 'Study Session',    icon: 'school-outline',     color: tokens.indigo, accent: tokens.mintFaint },
    premium:     { label: 'Premium Subscription', icon: 'star-outline',   color: tokens.gold, accent: tokens.pendingSoft },
    bonus:       { label: 'Bonus Reward',     icon: 'gift-outline',       color: tokens.signal, accent: tokens.signalFaint },
    earn:        { label: 'Points Earned',    icon: 'trending-up-outline',color: tokens.mint, accent: tokens.mintFaint },
    spend:       { label: 'Points Spent',     icon: 'trending-down-outline', color: tokens.inkMuted, accent: tokens.paper2 },
  };
  return map[type] || map['spend'];
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'earn', label: 'Earned' },
  { key: 'spend', label: 'Spent' },
  { key: 'withdraw', label: 'Withdrawals' },
  { key: 'airtime', label: 'Airtime' },
  { key: 'data', label: 'Data' },
  { key: 'electricity', label: 'Electricity' },
  { key: 'tv', label: 'TV' },
  { key: 'betting', label: 'Betting' },
  { key: 'isp', label: 'ISP' },
  { key: 'education', label: 'Education' },
  { key: 'sms', label: 'Bulk SMS' },
  { key: 'study', label: 'Study' },
  { key: 'premium', label: 'Premium' },
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

export default function TransactionHistoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();

  const [transactions, setTransactions] = useState<TxItem[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTransactions = useCallback(async () => {
    try {
      const res = await apiFetch('/wallet/history');
      if (!res.ok) throw new Error('history endpoint not available');
      const data = await res.json();
      const mapped: TxItem[] = (data || []).map((tx: any) => ({
        id: tx.txId || tx.ref || String(tx.date),
        type: tx.type || 'spend',
        description: tx.description || 'Transaction',
        amount: tx.amount ?? 0,
        status: tx.status || 'success',
        date: tx.date ? (typeof tx.date === 'string' ? tx.date : new Date(tx.date).toISOString()) : new Date().toISOString(),
        txId: tx.txId || '',
        ref: tx.ref || '',
        details: tx.details || {},
      }));
      setTransactions(mapped);
    } catch {
      try {
        const res = await apiFetch('/wallet/transactions');
        if (!res.ok) throw new Error('transactions endpoint not available');
        const data = await res.json();
        const mapped: TxItem[] = (Array.isArray(data) ? data : []).map((tx: any) => ({
          id: String(tx.id),
          type: tx.type === 'ad_reward' ? 'ad' : tx.type === 'pending' ? 'spend' : 'earn',
          description: tx.description || 'Transaction',
          amount: tx.points || 0,
          status: 'success',
          date: tx.date ? (typeof tx.date === 'string' ? tx.date : new Date(tx.date).toISOString()) : new Date().toISOString(),
          txId: String(tx.id),
          ref: String(tx.id),
          details: {},
        }));
        setTransactions(mapped);
      } catch {
        setTransactions([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadTransactions();
  }, [loadTransactions]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadTransactions();
  }, [loadTransactions]);

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      if (filter !== 'all') {
        if (filter === 'earn' && !['earn', 'ad', 'read', 'study', 'premium', 'bonus'].includes(tx.type)) return false;
        if (filter === 'spend' && ['earn', 'ad', 'read', 'study', 'premium', 'bonus', 'wallet'].includes(tx.type)) return false;
        if (filter !== 'earn' && filter !== 'spend' && tx.type !== filter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!tx.description.toLowerCase().includes(q) && !tx.txId.toLowerCase().includes(q) && !tx.ref.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [transactions, filter, search]);

  const grouped = useMemo(() => {
    const map: Record<string, TxItem[]> = {};
    filtered.forEach((tx) => {
      const label = dateLabel(new Date(tx.date));
      if (!map[label]) map[label] = [];
      map[label].push(tx);
    });
    return map;
  }, [filtered]);

  const order = ['Today', 'Yesterday', 'This Week', 'This Month'];
  const sortedKeys = Object.keys(grouped).sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return 0;
  });

  const openDetail = (tx: TxItem) => {
    const kindMap: Record<string, string> = {
      BT: 'bill',
      PAY: 'payment',
      WD: 'withdrawal',
      RS: 'history',
      AD: 'history',
      ST: 'history',
      PC: 'bonus',
    };
    const prefix = (tx.txId || '').split('-')[0];
    const kind = kindMap[prefix] || 'history';
    router.push({
      pathname: '/(app)/wallet/[id]',
      params: {
        id: tx.txId || tx.id,
        kind,
      },
    });
  };

  const renderItem = ({ item, index }: { item: TxItem; index: number }) => {
    const meta = getTxMeta(item.type, tokens) || getTxMeta('spend', tokens);
    const isPositive = item.amount > 0;
    const amtClass = isPositive ? 'positive' : 'negative';
    const prefix = isPositive ? '+' : '';
    const iconBg = isPositive ? 'earn' : 'spend';

    return (
      <Animated.View entering={FadeInDown.delay(index * 30).duration(220)}>
        <TouchableOpacity
          onPress={() => openDetail(item)}
          activeOpacity={0.7}
          style={[
            styles.txCard,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <View style={[styles.txIcon, { backgroundColor: meta.accent }]}>
            <Ionicons name={meta.icon} size={20} color={meta.color} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.txTitle, { color: tokens.ink }]} numberOfLines={1}>
              {item.description}
            </Text>
            <Text style={[styles.txMeta, { color: tokens.inkMuted }]}>
              {fmtTime(new Date(item.date))} · {item.txId}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
            <Text style={[styles.txAmount, { color: isPositive ? tokens.mint : tokens.ink }]}>
              {prefix}{Math.abs(item.amount).toLocaleString()} pts
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: item.status === 'success' ? tokens.mintSoft : item.status === 'pending' ? tokens.signalSoft : tokens.signalFaint }]}>
              <Text style={[styles.statusText, { color: item.status === 'success' ? tokens.mint : item.status === 'pending' ? tokens.gold : tokens.error }]}>
                {item.status}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderSection = (label: string) => {
    const items = grouped[label] || [];
    if (items.length === 0) return null;
    return (
      <View style={{ marginBottom: 20 }}>
        <Text style={[styles.dateHeader, { color: tokens.inkMuted }]}>{label}</Text>
        {items.map((tx, i) => renderItem({ item: tx, index: i }))}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper }}>
      <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border, marginTop: insets.top }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
            Transaction History
          </Text>
          <NotificationBell />
        </View>
      </View>

      {loading ? (
        <View style={{ padding: 16 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonTransactionRow key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={[]}
          renderItem={null}
          ListHeaderComponent={
            <View>
              {/* Balance Card */}
              <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
                <View style={[styles.balanceCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
                  <Text style={[styles.balanceLabel, { color: tokens.inkMuted }]}>Available Balance</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                    <Text style={[styles.balanceAmount, { color: tokens.ink, fontFamily: Fonts.display }]}>
                      24,580
                    </Text>
                    <Text style={[styles.balanceSuffix, { color: tokens.inkMuted }]}> pts</Text>
                  </View>
                  <Text style={[styles.balanceSub, { color: tokens.inkMuted }]}>
                    ≈ {pointsToNairaString(24580)}
                  </Text>
                </View>
              </View>

              {/* Filters */}
              <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
                  {FILTERS.map((f) => (
                    <TouchableOpacity
                      key={f.key}
                      onPress={() => setFilter(f.key)}
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
                  onChangeText={setSearch}
                  autoCapitalize="none"
                  returnKeyType="search"
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={tokens.inkMuted} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Section Title */}
              <Text style={[styles.sectionTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
                Transaction History
              </Text>
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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.mint} />
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
    marginHorizontal: 20,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  dateHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
    paddingLeft: 4,
  },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
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
});
