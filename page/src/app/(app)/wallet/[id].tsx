import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, Share, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { koboToPoints } from '@/src/shared/lib/money';
import { SkeletonTransactionRow } from '@/components/skeletons';
import { PageHeader } from '@/components/PageHeader';

type TransactionItem =
  | { kind: 'session'; data: { id: number; type: string; points: number; description: string; date: string } }
  | { kind: 'payment'; data: { id: number; tier: string; tier_name: string; amount_kobo: number; amount_naira: number; provider: string; status: string; created_at: string; confirmed_at: string | null } }
  | { kind: 'withdrawal'; data: { reference: string; amount_kobo: number; fee_kobo: number; status: string; reason: string | null; paystack_transfer_code: string | null; balance_after_debit: number; created_at: string | null; settled_at: string | null } }
  | { kind: 'bill'; data: { id: number; service: string; provider: string; phone: string | null; meter_number: string | null; smartcard_number: string | null; amount_naira: number; commission_naira: number; points_earned: number; reference: string; status: string; external_ref: string | null; error_message: string | null; created_at: string; network_name?: string | null; customer_name?: string | null; token?: string | null; units?: string | null; total_cost?: number | null } };

type HistoryTx = {
  kind: 'history';
  data: {
    id: string;
    type: string;
    description: string;
    points: number;
    date: string;
    txId: string;
    ref: string;
    status: string;
    details: Record<string, unknown>;
  };
};

type CombinedItem = TransactionItem | HistoryTx;

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const statusColor = (status: string, tokens: (typeof PagePay)['light']) => {
  switch (status) {
    case 'success': return tokens.success;
    case 'pending': return tokens.pending;
    case 'failed': return tokens.failed;
    default: return tokens.inkMuted;
  }
};

const TX_TYPE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; accentHex: string }> = {
  airtime:     { icon: 'call-outline',       color: 'mint', label: 'Airtime', accentHex: '#10B981' },
  data:        { icon: 'wifi-outline',       color: 'indigo', label: 'Data Bundle', accentHex: '#3B82F6' },
  electricity: { icon: 'flash-outline',      color: 'gold', label: 'Electricity', accentHex: '#F59E0B' },
  internet:    { icon: 'globe-outline',      color: 'indigo', label: 'Internet', accentHex: '#8B5CF6' },
  tv:          { icon: 'tv-outline',         color: 'signal', label: 'TV Subscription', accentHex: '#EC4899' },
  recharge:    { icon: 'ticket-outline',     color: 'indigo', label: 'Recharge Pin', accentHex: '#06B6D4' },
  betting:     { icon: 'diamond-outline',    color: 'mint', label: 'Betting', accentHex: '#10B981' },
  isp:         { icon: 'globe-outline',      color: 'indigo', label: 'ISP', accentHex: '#14B8A6' },
  education:   { icon: 'school-outline',     color: 'gold', label: 'Education', accentHex: '#F97316' },
  sms:         { icon: 'chatbubbles-outline',color: 'inkMuted', label: 'Bulk SMS', accentHex: '#64748B' },
  wallet:      { icon: 'wallet-outline',     color: 'mint', label: 'Wallet Funding', accentHex: '#0E7C66' },
  withdraw:    { icon: 'arrow-up-circle-outline', color: 'gold', label: 'Withdrawal', accentHex: '#F59E0B' },
  ad:          { icon: 'play-circle-outline',color: 'signal', label: 'Ad Reward', accentHex: '#EF4444' },
  read:        { icon: 'book-outline',       color: 'indigo', label: 'Reading Reward', accentHex: '#8B5CF6' },
  study:       { icon: 'school-outline',     color: 'indigo', label: 'Study Session', accentHex: '#6366F1' },
  premium:     { icon: 'star-outline',       color: 'gold', label: 'Premium Subscription', accentHex: '#D97706' },
  bonus:       { icon: 'gift-outline',       color: 'signal', label: 'Bonus Reward', accentHex: '#EC4899' },
  earn:        { icon: 'trending-up-outline',color: 'mint', label: 'Points Earned', accentHex: '#0E7C66' },
  spend:       { icon: 'trending-down-outline', color: 'inkMuted', label: 'Points Spent', accentHex: '#64748B' },
};

function DetailRow(label: string, value: string, mono: boolean = false, tokens?: (typeof PagePay)['light'], isLast: boolean = false) {
  const t = tokens || PagePay.light;
  return (
    <View style={[styles.detailRow, { borderBottomColor: t.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }]}>
      <Text style={[styles.detailLabel, { color: t.inkMuted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: t.ink }, mono && { fontFamily: 'monospace', fontSize: 12 }]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

function DetailSection({ title, children, tokens }: { title: string; children: React.ReactNode; tokens: (typeof PagePay)['light'] }) {
  return (
    <View style={[styles.detailSection, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <Text style={[styles.detailSectionTitle, { color: tokens.inkMuted }]}>{title}</Text>
      {children}
    </View>
  );
}

export default function TransactionDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; kind: string; item: string }>();
  const [item, setItem] = useState<CombinedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showShare, setShowShare] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (params.item) {
      try {
        const parsed = JSON.parse(params.item) as CombinedItem;
        if (!cancelled) {
          setItem(parsed);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Transaction not found');
          setLoading(false);
        }
      }
      return () => { cancelled = true; };
    }

    const fetchDetail = async () => {
      const itemId = params.id;
      if (!itemId) {
        setError('Transaction not found');
        setLoading(false);
        return;
      }
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const url = `/api/v1/wallet/history/${encodeURIComponent(params.kind || 'history')}/${encodeURIComponent(itemId)}`;
        const res = await apiFetch(url, {
          signal: controller.signal as any,
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error('Failed to fetch transaction detail');
        const data = await res.json();
        if (!cancelled) {
          setItem(data as CombinedItem);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Transaction not found');
          setLoading(false);
        }
      }
    };
    fetchDetail();
    return () => { cancelled = true; };
  }, [params.id, params.kind, params.item]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.paper }}>
        <PageHeader
          title="Transaction"
          showBack
          backgroundColor={tokens.card}
          borderBottomColor={tokens.border}
          marginTop={insets.top}
          tokens={tokens}
        />
        <View style={{ padding: 16 }}>
          <SkeletonTransactionRow />
          <SkeletonTransactionRow />
          <SkeletonTransactionRow />
        </View>
      </View>
    );
  }

  if (error || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.paper }}>
        <PageHeader
          title="Transaction"
          showBack
          backgroundColor={tokens.card}
          borderBottomColor={tokens.border}
          marginTop={insets.top}
          tokens={tokens}
        />
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: tokens.inkMuted }]}>{error || 'Transaction not found'}</Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: tokens.card, borderColor: tokens.border }]}
          >
            <Text style={{ color: tokens.mint, fontWeight: '600' }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isHistory = item.kind === 'history';
  const d = (item as any).data || (item as any);
  const txType = d.type || d.tier || 'unknown';
  const meta = TX_TYPE_META[txType] || { icon: 'receipt-outline', color: 'inkMuted', label: 'Transaction', accentHex: '#64748B' };
  const status = d.status || 'success';
  // Status badge backgrounds per the design preview:
  //   success → mint-soft + dark mint text
  //   pending → gold-soft + amber-900 text
  //   failed  → signal-soft + red-900 text
  const statusColors = {
    success: { bg: tokens.mintSoft, text: tokens.mint },
    pending: { bg: '#FFFBEB', text: '#92400E' },
    failed:  { bg: tokens.signalSoft, text: '#991B1B' },
  };
  const sc = statusColors[status as keyof typeof statusColors] || statusColors.success;

  // Normalise the hero amount to signed points (same logic as history.tsx).
  // `points` is reliable for earn/spend types; `amount` is in kobo for fiat
  // (bill / payment / withdrawal) so convert via koboToPoints.
  const FIAT_KINDS = new Set(['bill', 'payment', 'withdrawal']);
  const rawAmount = (d.amount ?? 0) as number;
  const signedPoints = FIAT_KINDS.has(item.kind)
    ? Math.sign(rawAmount) * koboToPoints(Math.abs(rawAmount))
    : (d.points ?? rawAmount);
  const absPoints = Math.abs(signedPoints);
  const isPositive = signedPoints > 0;
  const dateStr = formatDate(d.date);
  const timeStr = new Date(d.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const openShare = () => setShowShare(true);
  const closeShare = () => setShowShare(false);

  const handleShareAction = async (action: 'share-image' | 'save-image' | 'share-pdf' | 'save-pdf') => {
    setSharing(true);
    try {
      if (action === 'share-image' || action === 'save-image') {
        await Share.share({
          message: `PagePay Receipt\n${meta.label}: ${d.description}\nAmount: ${isPositive ? '+' : '-'}${absPoints} pts\nStatus: ${status}\nDate: ${dateStr}`,
          title: 'PagePay Receipt',
        });
      } else if (action === 'share-pdf' || action === 'save-pdf') {
        await Share.share({
          message: `PagePay Receipt\n${meta.label}: ${d.description}\nAmount: ${isPositive ? '+' : '-'}${absPoints} pts\nStatus: ${status}\nDate: ${dateStr}`,
          title: 'PagePay Receipt PDF',
        });
      }
    } catch {
      // User cancelled
    } finally {
      setSharing(false);
      closeShare();
    }
  };

  const renderTypeDetails = () => {
    const details = (d as any).details || {};
    switch (txType) {
      case 'airtime':
        return (
          <DetailSection title="Airtime Details" tokens={tokens}>
            {DetailRow('Network', details.network as string || 'N/A', false, tokens)}
            {DetailRow('Phone Number', details.phone as string || 'N/A', false, tokens)}
            {DetailRow('Amount Paid', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'data':
        return (
          <DetailSection title="Data Bundle Details" tokens={tokens}>
            {DetailRow('Network', details.network as string || 'N/A', false, tokens)}
            {DetailRow('Phone Number', details.phone as string || 'N/A', false, tokens)}
            {DetailRow('Plan', details.plan as string || 'N/A', false, tokens)}
            {DetailRow('Validity', details.validity as string || 'N/A', false, tokens)}
            {DetailRow('Amount Paid', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'electricity':
        return (
          <DetailSection title="Electricity Bill Details" tokens={tokens}>
            {DetailRow('Disco', details.disco as string || 'N/A', false, tokens)}
            {DetailRow('Meter Number', details.meterNumber as string || 'N/A', false, tokens)}
            {DetailRow('Units Purchased', `${details.units as number || 0} kWh`, false, tokens)}
            {DetailRow('Amount Paid', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'internet':
        return (
          <DetailSection title="Internet Payment Details" tokens={tokens}>
            {DetailRow('Provider', details.provider as string || 'N/A', false, tokens)}
            {DetailRow('Account', details.account as string || 'N/A', false, tokens)}
            {DetailRow('Plan', details.plan as string || 'N/A', false, tokens)}
            {DetailRow('Amount Paid', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'tv':
        return (
          <DetailSection title="TV Subscription Details" tokens={tokens}>
            {DetailRow('Provider', details.provider as string || 'N/A', false, tokens)}
            {DetailRow('Smartcard No.', details.smartcard as string || 'N/A', false, tokens)}
            {DetailRow('Package', details.package as string || 'N/A', false, tokens)}
            {DetailRow('Amount Paid', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'recharge':
        return (
          <DetailSection title="Recharge Pin Details" tokens={tokens}>
            {DetailRow('Pin Code', details.pin as string || 'N/A', false, tokens)}
            {DetailRow('Pin Value', `₦${((details.value as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'betting':
        return (
          <DetailSection title="Betting Funding Details" tokens={tokens}>
            {DetailRow('Platform', details.site as string || 'N/A', false, tokens)}
            {DetailRow('Username', details.username as string || 'N/A', false, tokens)}
            {DetailRow('Amount Funded', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'isp':
        return (
          <DetailSection title="ISP Payment Details" tokens={tokens}>
            {DetailRow('Provider', details.provider as string || 'N/A', false, tokens)}
            {DetailRow('Account', details.account as string || 'N/A', false, tokens)}
            {DetailRow('Plan', details.plan as string || 'N/A', false, tokens)}
            {DetailRow('Amount Paid', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'education':
        return (
          <DetailSection title="Education Payment Details" tokens={tokens}>
            {DetailRow('Exam Type', details.examType as string || 'N/A', false, tokens)}
            {DetailRow('Registration ID', details.registrationId as string || 'N/A', false, tokens)}
            {DetailRow('Amount Paid', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'sms':
        return (
          <DetailSection title="Bulk SMS Details" tokens={tokens}>
            {DetailRow('Sender ID', details.senderId as string || 'N/A', false, tokens)}
            {DetailRow('Units Purchased', `${details.units as number || 0}`, false, tokens)}
            {DetailRow('Amount Paid', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'wallet':
        return (
          <DetailSection title="Wallet Funding Details" tokens={tokens}>
            {DetailRow('Source', details.source as string || 'N/A', false, tokens)}
            {DetailRow('Amount', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Reference', details.reference as string || 'N/A', false, tokens, true)}
          </DetailSection>
        );
      case 'withdraw':
        return (
          <>
            <DetailSection title="Withdrawal Details" tokens={tokens}>
              {DetailRow('Amount', `${absPoints} pts`, false, tokens)}
              {DetailRow('Fee', `${(details.fee || 0).toLocaleString()} pts`, false, tokens)}
              {DetailRow('Total Debited', `${(absPoints + (details.fee || 0)).toLocaleString()} pts`, false, tokens)}
              {DetailRow('Balance After', `${(details.balanceAfter || 0).toLocaleString()} pts`, false, tokens, true)}
            </DetailSection>
            <DetailSection title="Bank Details" tokens={tokens}>
              {DetailRow('Bank', (details.bank as string) || 'N/A', false, tokens)}
              {DetailRow('Account', `****${(details.accountLast4 as string) || '0000'}`, false, tokens, true)}
            </DetailSection>
          </>
        );
      case 'ad':
        return (
          <DetailSection title="Ad Reward Details" tokens={tokens}>
            {DetailRow('Ad Type', details.adType as string || 'N/A', false, tokens)}
            {DetailRow('Reward Earned', `+${absPoints} pts`, false, tokens)}
            {DetailRow('Campaign ID', details.campaign as string || 'N/A', false, tokens, true)}
          </DetailSection>
        );
      case 'read':
        return (
          <DetailSection title="Reading Reward Details" tokens={tokens}>
            {DetailRow('Book Title', details.title as string || 'N/A', false, tokens)}
            {DetailRow('Pages Read', `${details.pages as number || 0}`, false, tokens)}
            {DetailRow('Reward Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'study':
        return (
          <DetailSection title="Study Session Details" tokens={tokens}>
            {DetailRow('Topic', details.topic as string || 'N/A', false, tokens)}
            {DetailRow('Duration', details.duration as string || 'N/A', false, tokens)}
            {DetailRow('Points Earned', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      case 'premium':
        return (
          <DetailSection title="Subscription Details" tokens={tokens}>
            {DetailRow('Plan', details.plan as string || 'N/A', false, tokens)}
            {DetailRow('Amount Paid', `₦${((details.amountNaira as number) || 0).toLocaleString()}`, false, tokens)}
            {DetailRow('Next Billing', details.nextBilling as string || 'N/A', false, tokens, true)}
          </DetailSection>
        );
      case 'bonus':
        return (
          <DetailSection title="Bonus Details" tokens={tokens}>
            {DetailRow('Reason', details.reason as string || 'N/A', false, tokens)}
            {DetailRow('Bonus Points', `+${absPoints} pts`, false, tokens, true)}
          </DetailSection>
        );
      default:
        return null;
    }
  };

  const txId = (d as any).txId || (d as any).id || 'N/A';
  const ref = (d as any).ref || 'N/A';

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper }}>
      <PageHeader
        title={`${meta.label} Details`}
        showBack
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        marginTop={insets.top}
        tokens={tokens}
      />

      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero — accent left border (3px) matches the design's per-type accent. */}
        <View
          style={[
            styles.hero,
            { backgroundColor: tokens.card, borderColor: tokens.border, borderLeftColor: meta.accentHex, borderLeftWidth: 3 },
          ]}
        >
          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.statusText, { color: sc.text }]}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </View>
          <Text style={[styles.heroAmount, { color: isPositive ? tokens.mint : tokens.ink }]}>
            {isPositive ? '+' : '-'}{absPoints.toLocaleString()}
          </Text>
          <Text style={[styles.heroLabel, { color: tokens.inkMuted }]}>Points</Text>
          <Text style={[styles.heroDesc, { color: tokens.inkMuted }]} numberOfLines={1}>
            {d.description as string}
          </Text>
        </View>

        {/* Type-specific details */}
        {renderTypeDetails()}

        {/* Transaction Information */}
        <DetailSection title="Transaction Information" tokens={tokens}>
          {DetailRow('Transaction ID', txId as string, true, tokens)}
          {DetailRow('Reference', ref as string, true, tokens)}
          {DetailRow('Date & Time', `${dateStr} · ${timeStr}`, false, tokens)}
          {DetailRow('Type', meta.label, false, tokens)}
          {DetailRow('Status', status.charAt(0).toUpperCase() + status.slice(1), false, tokens, true)}
        </DetailSection>

        {/* Actions — wrapped in a card section per the design preview. */}
        <View style={[styles.detailSection, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              onPress={openShare}
              style={[styles.actionBtn, { backgroundColor: tokens.card, borderColor: tokens.border }]}
            >
              <Ionicons name="share-outline" size={18} color={tokens.ink} />
              <Text style={[styles.actionBtnText, { color: tokens.ink }]}>Share Receipt</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {}}
              style={[styles.actionBtn, { backgroundColor: tokens.card, borderColor: tokens.border }]}
            >
              <Ionicons name="chatbubble-outline" size={18} color={tokens.ink} />
              <Text style={[styles.actionBtnText, { color: tokens.ink }]}>Support</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      </View>

      {/* Share Sheet Modal */}
      <Modal visible={showShare} transparent animationType="slide" onRequestClose={closeShare}>
        <View style={styles.shareOverlay}>
          <Pressable style={styles.shareBackdrop} onPress={closeShare} />
          <View style={[styles.shareSheet, { backgroundColor: tokens.card }]}>
            <View style={[styles.shareHandle, { backgroundColor: tokens.border }]} />
            <Text style={[styles.shareTitle, { color: tokens.ink }]}>Share Receipt</Text>

            <TouchableOpacity
              style={[styles.shareOption, { backgroundColor: tokens.paper, borderColor: tokens.border }]}
              onPress={() => handleShareAction('share-image')}
              disabled={sharing}
            >
              <View style={[styles.shareIcon, { backgroundColor: tokens.mintFaint }]}>
                <Ionicons name="image-outline" size={22} color={tokens.mint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shareOptionTitle, { color: tokens.ink }]}>Share as Image</Text>
                <Text style={[styles.shareOptionDesc, { color: tokens.inkMuted }]}>Send receipt as an image</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={tokens.inkMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.shareOption, { backgroundColor: tokens.paper, borderColor: tokens.border }]}
              onPress={() => handleShareAction('save-image')}
              disabled={sharing}
            >
              <View style={[styles.shareIcon, { backgroundColor: tokens.mintFaint }]}>
                <Ionicons name="download-outline" size={22} color={tokens.mint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shareOptionTitle, { color: tokens.ink }]}>Save as Image</Text>
                <Text style={[styles.shareOptionDesc, { color: tokens.inkMuted }]}>Save receipt image to gallery</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={tokens.inkMuted} />
            </TouchableOpacity>

            <View style={[styles.shareDivider, { backgroundColor: tokens.border }]} />

            <TouchableOpacity
              style={[styles.shareOption, { backgroundColor: tokens.paper, borderColor: tokens.border }]}
              onPress={() => handleShareAction('share-pdf')}
              disabled={sharing}
            >
              <View style={[styles.shareIcon, { backgroundColor: tokens.failedFaint }]}>
                <Ionicons name="document-outline" size={22} color={tokens.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shareOptionTitle, { color: tokens.ink }]}>Share as PDF</Text>
                <Text style={[styles.shareOptionDesc, { color: tokens.inkMuted }]}>Send receipt as PDF document</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={tokens.inkMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.shareOption, { backgroundColor: tokens.paper, borderColor: tokens.border }]}
              onPress={() => handleShareAction('save-pdf')}
              disabled={sharing}
            >
              <View style={[styles.shareIcon, { backgroundColor: tokens.failedFaint }]}>
                <Ionicons name="download-outline" size={22} color={tokens.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shareOptionTitle, { color: tokens.ink }]}>Save as PDF</Text>
                <Text style={[styles.shareOptionDesc, { color: tokens.inkMuted }]}>Save receipt PDF to files</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={tokens.inkMuted} />
            </TouchableOpacity>

            <TouchableOpacity onPress={closeShare} style={styles.shareCancel}>
              <Text style={[styles.shareCancelText, { color: tokens.inkMuted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
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
  hero: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroAmount: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 38,
    fontWeight: '700',
    letterSpacing: -1,
    lineHeight: 44,
  },
  heroLabel: {
    fontSize: 13,
  },
  heroDesc: {
    fontSize: 14,
    marginTop: 4,
  },
  detailSection: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 4,
    marginBottom: 12,
  },
  detailSectionTitle: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  detailLabel: {
    fontSize: 13,
    width: 100,
    flexShrink: 0,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    gap: 6,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  shareOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  shareBackdrop: {
    flex: 1,
  },
  shareSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  shareHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  shareTitle: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  shareOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  shareIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  shareOptionDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  shareDivider: {
    height: 1,
    marginVertical: 8,
  },
  shareCancel: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 8,
  },
  shareCancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
