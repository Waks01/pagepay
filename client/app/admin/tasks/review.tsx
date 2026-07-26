import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { adminListSubmissions, adminApproveSubmission, adminRejectSubmission, type AdminSubmission } from '@/src/features/admin/api';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';
import { SkeletonPage } from '@/components/skeletons';

const STATUS_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  pending: { color: '#C2410C', icon: 'hourglass-outline', label: 'Pending' },
  validating: { color: '#0E7C66', icon: 'sync-outline', label: 'Validating' },
  approved: { color: '#0E7C66', icon: 'checkmark-circle', label: 'Approved' },
  rejected: { color: '#C2410C', icon: 'close-circle', label: 'Rejected' },
};

export default function AdminReviewQueueScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>('pending');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'submissions', filter],
    queryFn: () => adminListSubmissions({ status: filter, task_source: 'admin', limit: 50 }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const approveMutation = useMutation({
    mutationFn: adminApproveSubmission,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'submissions'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => adminRejectSubmission(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'submissions'] });
    },
  });

  const handleApprove = (submission: AdminSubmission) => {
    Alert.alert(
      'Approve Submission',
      `Approve and credit ${submission.reward_amount} points to this user?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => approveMutation.mutate(submission.submission_id),
        },
      ]
    );
  };

  const handleReject = (submission: AdminSubmission) => {
    Alert.prompt(
      'Reject Submission',
      'Enter rejection reason (min 10 characters):',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: (reason?: string) => {
            const trimmed = (reason ?? '').trim();
            if (!trimmed || trimmed.length < 10) {
              Alert.alert('Invalid reason', 'Please provide at least 10 characters.');
              return;
            }
            rejectMutation.mutate({ id: submission.submission_id, reason: trimmed });
          },
        },
      ],
      'plain-text',
      '',
      'default'
    );
  };

  const renderItem = ({ item }: { item: AdminSubmission }) => {
    const status = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
    return (
      <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.taskTitle, { color: tokens.ink }]} numberOfLines={1}>
              {item.task_title}
            </Text>
            <Text style={[styles.taskMeta, { color: tokens.inkMuted }]}>
              {item.worker_email} · {item.platform}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
            <Ionicons name={status.icon as any} size={14} color="#fff" />
            <Text style={styles.statusText}>{status.label}</Text>
          </View>
        </View>

        <View style={styles.proofSection}>
          <Text style={[styles.proofLabel, { color: tokens.inkMuted }]}>Proof type:</Text>
          <Text style={[styles.proofValue, { color: tokens.ink }]}>{item.proof_type}</Text>
        </View>

        {item.proof_image_url && (
          <View style={styles.proofSection}>
            <Text style={[styles.proofLabel, { color: tokens.inkMuted }]}>Screenshot:</Text>
            <TouchableOpacity onPress={() => router.push(`/modal?imageUrl=${encodeURIComponent(item.proof_image_url ?? '')}`)}>
              <Text style={[styles.proofLink, { color: tokens.mint }]}>View Image</Text>
            </TouchableOpacity>
          </View>
        )}

        {item.proof_url && (
          <View style={styles.proofSection}>
            <Text style={[styles.proofLabel, { color: tokens.inkMuted }]}>URL:</Text>
            <Text style={[styles.proofValue, { color: tokens.ink }]} numberOfLines={1}>
              {item.proof_url}
            </Text>
          </View>
        )}

        {item.proof_text && (
          <View style={styles.proofSection}>
            <Text style={[styles.proofLabel, { color: tokens.inkMuted }]}>Text:</Text>
            <Text style={[styles.proofValue, { color: tokens.ink }]} numberOfLines={2}>
              {item.proof_text}
            </Text>
          </View>
        )}

        {item.rejection_reason && (
          <View style={[styles.rejectionBox, { backgroundColor: '#FDEFE7' }]}>
            <Ionicons name="alert-circle" size={18} color="#C2410C" />
            <Text style={[styles.rejectionText, { color: '#C2410C' }]}>{item.rejection_reason}</Text>
          </View>
        )}

        <View style={styles.cardFooter}>
          <Text style={[styles.rewardText, { color: tokens.mint }]}>
            {item.reward_amount} pts
          </Text>
          <Text style={[styles.timeText, { color: tokens.inkMuted }]}>
            {new Date(item.submitted_at).toLocaleString()}
          </Text>
        </View>

        {item.status === 'pending' && (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.approveButton, { backgroundColor: tokens.mint }]}
              onPress={() => handleApprove(item)}
              disabled={approveMutation.isPending}
            >
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.actionButtonText}>Approve + {item.reward_amount} pts</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.rejectButton, { borderColor: '#FDEFE7' }]}
              onPress={() => handleReject(item)}
              disabled={rejectMutation.isPending}
            >
              <Ionicons name="close" size={18} color="#C2410C" />
              <Text style={[styles.actionButtonText, { color: '#C2410C' }]}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return <SkeletonPage count={4} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.paper }]}>
      <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={tokens.ink} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: tokens.ink }]}>Review Queue</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.filterRow}>
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[
              styles.filterPill,
              filter === s && { backgroundColor: tokens.mint, borderColor: tokens.mint },
            ]}
            onPress={() => setFilter(s)}
          >
            <Text
              style={[
                styles.filterPillText,
                { color: filter === s ? '#fff' : tokens.inkMuted },
              ]}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={data?.items || []}
        renderItem={renderItem}
        keyExtractor={(item) => item.submission_id.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.mint} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-done-outline" size={64} color={tokens.border} />
            <Text style={[styles.emptyText, { color: tokens.ink }]}>No submissions</Text>
            <Text style={[styles.emptySubtext, { color: tokens.inkMuted }]}>
              {filter === 'pending'
                ? 'All caught up! No pending submissions.'
                : `No ${filter} submissions yet.`}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E2DA',
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_600',
  },
  listContent: {
    padding: 16,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 4,
  },
  taskMeta: {
    fontSize: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    fontFamily: 'SpaceGrotesk_600',
  },
  proofSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  proofLabel: {
    fontSize: 12,
    fontWeight: '600',
    width: 80,
  },
  proofValue: {
    flex: 1,
    fontSize: 13,
  },
  proofLink: {
    fontSize: 13,
    fontWeight: '600',
  },
  rejectionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  rejectionText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E5E2DA',
    paddingTop: 12,
    marginTop: 12,
  },
  rewardText: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  timeText: {
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  approveButton: {
    backgroundColor: '#0E7C66',
  },
  rejectButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#FDEFE7',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_700Bold',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
});
