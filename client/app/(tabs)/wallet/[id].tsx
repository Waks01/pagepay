import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PagePay, Fonts } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { formatKobo, formatPoints, pointsToNairaString } from '@/src/shared/lib/money';

type TransactionItem =
  | { kind: 'session'; data: { id: number; type: string; points: number; description: string; date: string } }
  | { kind: 'payment'; data: { id: number; tier: string; tier_name: string; amount_kobo: number; amount_naira: number; provider: string; status: string; created_at: string; confirmed_at: string | null } }
  | { kind: 'withdrawal'; data: { reference: string; amount_kobo: number; fee_kobo: number; status: string; reason: string | null; paystack_transfer_code: string | null; balance_after_debit: number; created_at: string | null; settled_at: string | null } };

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const statusColor = (status: string) => {
  switch (status) {
    case 'success':
      return '#34C759';
    case 'pending':
      return '#FF9500';
    case 'failed':
      return '#FF3B30';
    default:
      return '#666';
  }
};

export default function TransactionDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const params = useLocalSearchParams<{ id: string; kind: string; item: string }>();
  const itemJson = params.item;

  const item: TransactionItem | null = useMemo(() => {
    if (!itemJson) return null;
    try {
      return JSON.parse(itemJson) as TransactionItem;
    } catch {
      return null;
    }
  }, [itemJson]);

  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.paper }}>
        <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={tokens.ink} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
              Transaction
            </Text>
            <View style={{ width: 36 }} />
          </View>
        </View>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: tokens.inkMuted }]}>
            Transaction not found
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={{ color: tokens.mint, fontWeight: '600' }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderStatusBadge = (status: string) => {
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return (
      <View style={[styles.statusBadge, { backgroundColor: statusColor(status) + '18', borderColor: statusColor(status) + '40' }]}>
        <View style={[styles.statusDot, { backgroundColor: statusColor(status) }]} />
        <Text style={[styles.statusText, { color: statusColor(status) }]}>{label}</Text>
      </View>
    );
  };

  const renderDetailRow = (label: string, value: string | React.ReactNode, mono?: boolean) => (
    <View style={[styles.detailRow, { borderBottomColor: tokens.border }]}>
      <Text style={[styles.detailLabel, { color: tokens.inkMuted }]}>{label}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        {typeof value === 'string' ? (
          <Text style={[styles.detailValue, { color: tokens.ink }, mono && { fontFamily: 'monospace', fontSize: 12 }]} numberOfLines={3}>
            {value}
          </Text>
        ) : (
          value
        )}
      </View>
    </View>
  );

  if (item.kind === 'session') {
    const d = item.data;
    const isPending = d.type === 'pending';
    const isEarn = d.type === 'earn';

    return (
      <View style={{ flex: 1, backgroundColor: tokens.paper }}>
        <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={tokens.ink} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
              Transaction
            </Text>
            <View style={{ width: 36 }} />
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.iconBox, { backgroundColor: tokens.mintSoft }]}>
                <Ionicons name="book-outline" size={24} color={tokens.mint} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.cardTitle, { color: tokens.ink }]} numberOfLines={2}>
                  {d.description}
                </Text>
                <Text style={[styles.cardDate, { color: tokens.inkMuted }]}>
                  {formatDate(d.date)}
                </Text>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: tokens.border }]} />

            <View style={styles.pointsRow}>
              <Text style={[styles.pointsLabel, { color: tokens.inkMuted }]}>Points earned</Text>
              <Text style={[
                styles.pointsValue,
                { color: isEarn ? tokens.mint : isPending ? tokens.signal : tokens.inkMuted },
              ]}>
                {d.points > 0 ? '+' : ''}{d.points} {t('wallet.points_suffix', { defaultValue: 'pts' })}
              </Text>
            </View>

            {renderDetailRow('Type', d.type === 'earn' ? 'Earned' : d.type === 'pending' ? 'Pending' : d.type)}
            {renderDetailRow('Date', formatDate(d.date))}
            {renderDetailRow('Transaction ID', String(d.id), true)}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (item.kind === 'payment') {
    const d = item.data;
    return (
      <View style={{ flex: 1, backgroundColor: tokens.paper }}>
        <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={tokens.ink} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
              Payment
            </Text>
            <View style={{ width: 36 }} />
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.iconBox, { backgroundColor: tokens.mintSoft }]}>
                <Ionicons name="wallet-outline" size={24} color={tokens.mint} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.cardTitle, { color: tokens.ink }]}>
                  {d.tier_name}
                </Text>
                <Text style={[styles.cardDate, { color: tokens.inkMuted }]}>
                  {formatDate(d.created_at)}
                </Text>
              </View>
              {renderStatusBadge(d.status)}
            </View>

            <View style={[styles.divider, { backgroundColor: tokens.border }]} />

            <View style={styles.pointsRow}>
              <Text style={[styles.pointsLabel, { color: tokens.inkMuted }]}>Amount</Text>
              <Text style={[styles.pointsValue, { color: tokens.ink }]}>
                {d.status === 'success' ? '+' : ''}₦{d.amount_naira.toLocaleString()}
              </Text>
            </View>

            {renderDetailRow('Status', d.status)}
            {renderDetailRow('Provider', d.provider)}
            {renderDetailRow('Created', formatDate(d.created_at))}
            {d.confirmed_at && renderDetailRow('Confirmed', formatDate(d.confirmed_at))}
            {renderDetailRow('Transaction ID', String(d.id), true)}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (item.kind === 'withdrawal') {
    const d = item.data;
    const netKobo = d.amount_kobo + d.fee_kobo;
    return (
      <View style={{ flex: 1, backgroundColor: tokens.paper }}>
        <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={tokens.ink} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
              Withdrawal
            </Text>
            <View style={{ width: 36 }} />
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <View style={styles.cardHeader}>
              <View style={[
                styles.iconBox,
                { backgroundColor: d.status === 'failed' ? tokens.signalSoft : tokens.mintSoft }
              ]}>
                <Ionicons
                  name={d.status === 'failed' ? 'alert-circle' : 'arrow-up-circle-outline'}
                  size={24}
                  color={d.status === 'failed' ? tokens.signal : tokens.mint}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.cardTitle, { color: tokens.ink }]}>
                  {d.status === 'failed' ? 'Withdrawal Failed' : d.status === 'pending' ? 'Withdrawal Pending' : 'Withdrawal Successful'}
                </Text>
                <Text style={[styles.cardDate, { color: tokens.inkMuted }]}>
                  {formatDate(d.settled_at ?? d.created_at)}
                </Text>
              </View>
              {renderStatusBadge(d.status)}
            </View>

            <View style={[styles.divider, { backgroundColor: tokens.border }]} />

            <View style={styles.pointsRow}>
              <Text style={[styles.pointsLabel, { color: tokens.inkMuted }]}>Amount</Text>
              <Text style={[styles.pointsValue, { color: d.status === 'failed' ? tokens.signal : tokens.mint }]}>
                −{formatPoints(d.amount_kobo)} {t('wallet.points_suffix', { defaultValue: 'pts' })}
              </Text>
            </View>

            {d.fee_kobo > 0 && renderDetailRow('Fee', `${formatKobo(d.fee_kobo)} (${formatPoints(d.fee_kobo)} pts)`)}
            {renderDetailRow('Total debited', `${formatPoints(netKobo)} pts`)}
            {d.balance_after_debit > 0 && renderDetailRow('Balance after', `${formatPoints(d.balance_after_debit)} pts`)}
            {renderDetailRow('Status', d.status)}
            {d.reason && renderDetailRow('Reason', d.reason)}
            {d.paystack_transfer_code && renderDetailRow('Transfer code', d.paystack_transfer_code, true)}
            {renderDetailRow('Reference', d.reference, true)}
            {renderDetailRow('Created', formatDate(d.created_at))}
            {d.settled_at && renderDetailRow('Settled', formatDate(d.settled_at))}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper }}>
      <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.ink, fontFamily: Fonts.display }]}>
            Transaction
          </Text>
          <View style={{ width: 36 }} />
        </View>
      </View>
      <View style={styles.center}>
        <Text style={[styles.errorText, { color: tokens.inkMuted }]}>
          Unknown transaction type
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },
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
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  cardDate: {
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  pointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  pointsLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  pointsValue: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  detailLabel: {
    fontSize: 13,
    width: 100,
    flexShrink: 0,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginLeft: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
