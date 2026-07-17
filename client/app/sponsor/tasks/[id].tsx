import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { fetchTaskSubmissions, approveSubmission, rejectSubmission, type TaskSubmissionDetail } from '@/src/features/sponsor/api';
import { SkeletonDetailPage } from '@/components/skeletons';

export default function SponsorTaskDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  const { data: submissions, isLoading } = useQuery({
    queryKey: ['taskSubmissions', id],
    queryFn: () => fetchTaskSubmissions(Number(id)),
    enabled: !!id,
  });

  const approveMutation = useMutation({
    mutationFn: approveSubmission,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskSubmissions', id] });
      Alert.alert(t('sponsor_task_detail.approved_title'), t('sponsor_task_detail.approved_message'));
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ submissionId, reason }: { submissionId: number; reason: string }) =>
      rejectSubmission(submissionId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskSubmissions', id] });
      setRejectingId(null);
      setRejectionReason('');
      Alert.alert(t('sponsor_task_detail.rejected_title'), t('sponsor_task_detail.rejected_message'));
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message);
    },
  });

  const handleApprove = (submissionId: number) => {
    Alert.alert(
      t('sponsor_task_detail.approve_title'),
      t('sponsor_task_detail.approve_message'),
      [
        { text: t('sponsor_task_detail.cancel'), style: 'cancel' },
        { text: t('sponsor_task_detail.approve_button'), onPress: () => approveMutation.mutate(submissionId) },
      ]
    );
  };

  const handleReject = (submissionId: number) => {
    if (!rejectionReason.trim()) {
      Alert.alert(t('sponsor_task_detail.reason_required'));
      return;
    }
    rejectMutation.mutate({ submissionId, reason: rejectionReason });
  };

  const renderSubmission = ({ item }: { item: TaskSubmissionDetail }) => {
    const isRejecting = rejectingId === item.id;

    return (
      <View style={styles.submissionCard}>
        <View style={styles.submissionHeader}>
          <View>
            <Text style={styles.workerEmail}>{item.worker_email}</Text>
            <Text style={styles.submittedDate}>
              {new Date(item.submitted_at).toLocaleString()}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
            <Text style={styles.statusText}>{t(`sponsor_task_detail.status.${item.status}`)}</Text>
          </View>
        </View>

        {item.ai_confidence !== null && (
          <View style={styles.aiScore}>
            <Ionicons name="analytics" size={16} color="#6C5CE7" />
            <Text style={styles.aiScoreText}>
              {t('sponsor_task_detail.ai_confidence', { percent: (item.ai_confidence * 100).toFixed(1) })}
            </Text>
          </View>
        )}

        {item.proof_image_url && (
          <View style={styles.proofItem}>
            <Ionicons name="image" size={16} color="#666" />
            <Text style={styles.proofText}>{t('sponsor_task_detail.screenshot_provided')}</Text>
          </View>
        )}

        {item.proof_url && (
          <View style={styles.proofItem}>
            <Ionicons name="link" size={16} color="#666" />
            <Text style={styles.proofText} numberOfLines={1}>{item.proof_url}</Text>
          </View>
        )}

        {item.proof_text && (
          <View style={styles.proofItem}>
            <Ionicons name="document-text" size={16} color="#666" />
            <Text style={styles.proofText} numberOfLines={2}>{item.proof_text}</Text>
          </View>
        )}

        {item.status === 'pending' && (
          <View>
            {!isRejecting ? (
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={() => handleApprove(item.id)}
                >
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.approveButtonText}>{t('sponsor_task_detail.approve_button')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.rejectButton}
                  onPress={() => setRejectingId(item.id)}
                >
                  <Ionicons name="close-circle" size={20} color="#fff" />
                  <Text style={styles.rejectButtonText}>{t('sponsor_task_detail.reject_button')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.rejectForm}>
                <TextInput
                  style={styles.rejectInput}
                  placeholder={t('sponsor_task_detail.rejection_reason_label')}
                  value={rejectionReason}
                  onChangeText={setRejectionReason}
                  multiline
                />
                <View style={styles.rejectActions}>
                  <TouchableOpacity onPress={() => setRejectingId(null)}>
                    <Text style={styles.cancelText}>{t('sponsor_task_detail.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.confirmRejectButton}
                    onPress={() => handleReject(item.id)}
                    disabled={rejectMutation.isPending}
                  >
                    {rejectMutation.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.confirmRejectText}>{t('sponsor_task_detail.confirm_reject')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {item.rejection_reason && (
          <View style={styles.rejectionBox}>
            <Text style={styles.rejectionLabel}>{t('sponsor_task_detail.rejection_reason_title')}</Text>
            <Text style={styles.rejectionText}>{item.rejection_reason}</Text>
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('sponsor_task_detail.title')}</Text>
      </View>

      <FlatList
        data={submissions || []}
        renderItem={renderSubmission}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="documents-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>{t('sponsor_task_detail.no_submissions')}</Text>
          </View>
        }
      />
    </View>
  );
}

function getStatusColor(status: string) {
  switch (status) {
    case 'pending': return '#FFA500';
    case 'validating': return '#00B894';
    case 'approved': return '#00B894';
    case 'rejected': return '#ff6b6b';
    default: return '#999';
  }
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
    marginBottom: 12,
  },
  workerEmail: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  submittedDate: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'capitalize',
  },
  aiScore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  aiScoreText: {
    fontSize: 13,
    color: '#6C5CE7',
    fontWeight: '600',
  },
  proofItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  proofText: {
    flex: 1,
    fontSize: 13,
    color: '#666',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  approveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#00B894',
    padding: 12,
    borderRadius: 8,
  },
  approveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#ff6b6b',
    padding: 12,
    borderRadius: 8,
  },
  rejectButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  rejectForm: {
    marginTop: 12,
  },
  rejectInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#333',
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 8,
  },
  rejectActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cancelText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  confirmRejectButton: {
    backgroundColor: '#ff6b6b',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  confirmRejectText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  rejectionBox: {
    backgroundColor: '#FFF0F0',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  rejectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ff6b6b',
    marginBottom: 4,
  },
  rejectionText: {
    fontSize: 13,
    color: '#333',
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
});
