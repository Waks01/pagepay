import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { fetchMySubmissions, type TaskSubmission } from '@/src/features/tasks/api';
import { SkeletonPage } from '@/components/skeletons';

const StatusBadge = ({ status }: { status: TaskSubmission['status'] }) => {
  const { t } = useTranslation();
  const statusConfig = {
    pending: { color: '#FFA500', icon: 'hourglass-outline', label: t('task_history.status.pending') },
    validating: { color: '#00B894', icon: 'sync-outline', label: t('task_history.status.validating') },
    approved: { color: '#00B894', icon: 'checkmark-circle', label: t('task_history.status.approved') },
    rejected: { color: '#ff6b6b', icon: 'close-circle', label: t('task_history.status.rejected') },
  };

  const config = statusConfig[status];

  return (
    <View style={[styles.statusBadge, { backgroundColor: config.color }]}>
      <Ionicons name={config.icon as any} size={14} color="#fff" />
      <Text style={styles.statusText}>{config.label}</Text>
    </View>
  );
};

export default function SubmissionHistoryScreen() {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<TaskSubmission['status'] | 'all'>('all');

  const { data: submissions, isLoading, refetch } = useQuery({
    queryKey: ['submissions'],
    queryFn: fetchMySubmissions,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const filteredSubmissions = submissions?.filter(
    (sub) => filter === 'all' || sub.status === filter
  );

  const renderSubmission = ({ item }: { item: TaskSubmission }) => {
    const netReward = Math.floor(item.reward_amount * 0.85);
    const submittedDate = new Date(item.submitted_at);
    const verifiedDate = item.verified_at ? new Date(item.verified_at) : null;

    return (
      <View style={styles.submissionCard}>
        <View style={styles.submissionHeader}>
          <View style={styles.taskInfo}>
            <Text style={styles.taskTitle} numberOfLines={1}>
              {item.task_title}
            </Text>
            <Text style={styles.taskMeta}>
              {item.task_type} · {item.platform}
            </Text>
          </View>
          <StatusBadge status={item.status} />
        </View>

        <View style={styles.submissionBody}>
          <View style={styles.rewardRow}>
            <Ionicons name="cash-outline" size={20} color="#00B894" />
            <Text style={styles.rewardText}>₦{(netReward / 100).toFixed(2)}</Text>
          </View>

          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={16} color="#666" />
            <Text style={styles.dateText}>
              {t('task_history.submitted', { date: `${submittedDate.toLocaleDateString()} ${submittedDate.toLocaleTimeString()}` })}
            </Text>
          </View>

          {verifiedDate && (
            <View style={styles.dateRow}>
              <Ionicons name="checkmark-done-outline" size={16} color="#666" />
              <Text style={styles.dateText}>
                {t('task_history.verified', { date: `${verifiedDate.toLocaleDateString()} ${verifiedDate.toLocaleTimeString()}` })}
              </Text>
            </View>
          )}

          {item.ai_confidence !== null && (
            <View style={styles.confidenceRow}>
              <Ionicons name="analytics-outline" size={16} color="#6C5CE7" />
              <Text style={styles.confidenceText}>
                {t('task_history.ai_confidence', { percent: (item.ai_confidence * 100).toFixed(1) })}
              </Text>
            </View>
          )}

          {item.rejection_reason && (
            <View style={styles.rejectionBox}>
              <Ionicons name="alert-circle" size={18} color="#ff6b6b" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rejectionText, { fontWeight: '600', marginBottom: 4 }]}>
                  {t('task_history.rejection_reason')}
                </Text>
                <Text style={styles.rejectionText}>{item.rejection_reason}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Proof Preview */}
        <View style={styles.proofSection}>
          {item.proof_image_url && (
            <View style={styles.proofRow}>
              <Ionicons name="image-outline" size={16} color="#666" />
              <Text style={styles.proofLabel}>{t('task_history.screenshot_provided')}</Text>
            </View>
          )}
          {item.proof_url && (
            <View style={styles.proofRow}>
              <Ionicons name="link-outline" size={16} color="#666" />
              <Text style={styles.proofLabel} numberOfLines={1}>
                {item.proof_url}
              </Text>
            </View>
          )}
          {item.proof_text && (
            <View style={styles.proofRow}>
              <Ionicons name="document-text-outline" size={16} color="#666" />
              <Text style={styles.proofLabel} numberOfLines={2}>
                {item.proof_text}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  if (isLoading) {
    return <SkeletonPage count={4} />;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('task_history.title')}</Text>
      </View>

      {/* Filter Pills */}
      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterPill, filter === 'all' && styles.filterPillActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
            {t('task_history.filter_all')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterPill, filter === 'pending' && styles.filterPillActive]}
          onPress={() => setFilter('pending')}
        >
          <Text style={[styles.filterText, filter === 'pending' && styles.filterTextActive]}>
            {t('task_history.filter_pending')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterPill, filter === 'validating' && styles.filterPillActive]}
          onPress={() => setFilter('validating')}
        >
          <Text style={[styles.filterText, filter === 'validating' && styles.filterTextActive]}>
            {t('task_history.filter_validating')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterPill, filter === 'approved' && styles.filterPillActive]}
          onPress={() => setFilter('approved')}
        >
          <Text style={[styles.filterText, filter === 'approved' && styles.filterTextActive]}>
            {t('task_history.filter_approved')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterPill, filter === 'rejected' && styles.filterPillActive]}
          onPress={() => setFilter('rejected')}
        >
          <Text style={[styles.filterText, filter === 'rejected' && styles.filterTextActive]}>
            {t('task_history.filter_rejected')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Submissions List */}
      <FlatList
        data={filteredSubmissions || []}
        renderItem={renderSubmission}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="documents-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>{t('task_history.no_submissions')}</Text>
            <Text style={styles.emptySubtext}>
              {filter === 'all'
                ? t('task_history.empty_all')
                : t('task_history.empty_filtered', { status: filter })}
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
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  filterContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  filterPillActive: {
    backgroundColor: '#6C5CE7',
    borderColor: '#6C5CE7',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: 16,
  },
  submissionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  submissionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  taskInfo: {
    flex: 1,
    marginRight: 12,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  taskMeta: {
    fontSize: 12,
    color: '#666',
    textTransform: 'capitalize',
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
  },
  submissionBody: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  rewardText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00B894',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  dateText: {
    fontSize: 12,
    color: '#666',
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  confidenceText: {
    fontSize: 12,
    color: '#6C5CE7',
    fontWeight: '600',
  },
  rejectionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFF0F0',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  rejectionText: {
    flex: 1,
    fontSize: 13,
    color: '#ff6b6b',
    lineHeight: 18,
  },
  proofSection: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
    marginTop: 12,
  },
  proofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  proofLabel: {
    flex: 1,
    fontSize: 12,
    color: '#666',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    textAlign: 'center',
  },
});
