import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { fetchTaskDetail, startTask } from '@/src/features/tasks/api';
import { usePlatformConfig } from '@/src/shared/hooks/use-platform-config';
import { SkeletonDetailPage } from '@/components/skeletons';

export default function TaskDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [isStarting, setIsStarting] = useState(false);

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => fetchTaskDetail(Number(id)),
    enabled: !!id,
  });

  const { data: platformConfig } = usePlatformConfig();
  const taskPlatformFeePercent = Math.round((platformConfig?.task_revenue_platform_percent ?? 0.30) * 100);

  const startTaskMutation = useMutation({
    mutationFn: () => startTask(Number(id)),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      // @ts-ignore - Dynamic route typing limitation in Expo Router
      router.push(`/tasks/${id}/complete?submission_id=${data.submission_id}`);
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || t('task_detail.errors.start_failed'));
    },
  });

  const handleStartTask = async () => {
    const timeLimit = task?.time_limit_minutes ? t('task_detail.time_minutes', { minutes: task.time_limit_minutes }) : t('task_detail.time_unlimited');
    Alert.alert(
      t('task_detail.start_title'),
      t('task_detail.start_message', { timeLimit }),
      [
        { text: t('task_complete.cancel_button'), style: 'cancel' },
        {
          text: t('task_detail.start_button'),
          onPress: () => {
            setIsStarting(true);
            startTaskMutation.mutate();
          },
        },
      ]
    );
  };

  if (isLoading) {
    return <SkeletonDetailPage />;
  }

  if (!task) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{t('task_detail.task_not_found')}</Text>
      </View>
    );
  }

  const netReward = Math.floor(task.reward_amount * (task.reward_multiplier ?? 1) * (1 - (platformConfig?.task_revenue_platform_percent ?? 0.30)));
  const remaining = task.max_completions - task.completed_count;
  const expiresDate = new Date(task.expires_at);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
      </View>

      <View style={styles.badgeRow}>
        <View style={styles.taskTypeBadge}>
          <Text style={styles.taskTypeBadgeText}>{task.task_type.replace('_', ' ')}</Text>
        </View>
        <View style={styles.platformBadge}>
          <Text style={styles.platformBadgeText}>{task.platform}</Text>
        </View>
      </View>

      <Text style={styles.title}>{task.title}</Text>

      <View style={styles.rewardCard}>
        <Text style={styles.rewardLabel}>{t('task_detail.you_earn')}</Text>
        <Text style={styles.rewardAmount}>₦{(netReward / 100).toFixed(2)}</Text>
        <Text style={styles.rewardNote}>{t('task_detail.after_fee', { percent: taskPlatformFeePercent })}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('task_detail.description_title')}</Text>
        <Text style={styles.sectionText}>{task.description}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('task_detail.instructions_title')}</Text>
        <Text style={styles.sectionText}>{task.instructions}</Text>
      </View>

      {task.target_url && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('task_detail.target_title')}</Text>
          <Text style={styles.linkText}>{task.target_url}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('task_detail.proof_required_title')}</Text>
        <View style={styles.proofTypeRow}>
          <Ionicons 
            name={task.proof_type === 'screenshot' ? 'camera' : task.proof_type === 'text' ? 'document-text' : 'link'} 
            size={20} 
            color="#6C5CE7" 
          />
          <Text style={styles.proofTypeText}>{t(`task_detail.proof_types.${task.proof_type}`)}</Text>
        </View>
        {task.proof_instructions && (
          <Text style={styles.sectionText}>{task.proof_instructions}</Text>
        )}
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Ionicons name="people-outline" size={20} color="#666" />
          <Text style={styles.statLabel}>{t('task_detail.stats.remaining')}</Text>
          <Text style={styles.statValue}>{remaining}</Text>
        </View>

        <View style={styles.statItem}>
          <Ionicons name="time-outline" size={20} color="#666" />
          <Text style={styles.statLabel}>{t('task_detail.stats.time_limit')}</Text>
          <Text style={styles.statValue}>{task.time_limit_minutes || t('task_detail.time_unlimited')} {task.time_limit_minutes ? 'min' : ''}</Text>
        </View>

        <View style={styles.statItem}>
          <Ionicons name="calendar-outline" size={20} color="#666" />
          <Text style={styles.statLabel}>{t('task_detail.stats.expires')}</Text>
          <Text style={styles.statValue}>{expiresDate.toLocaleDateString()}</Text>
        </View>
      </View>

      <View style={styles.requirementsCard}>
        <Text style={styles.requirementsTitle}>{t('task_detail.requirements_title')}</Text>
        <View style={styles.requirementRow}>
          <Ionicons name="trophy-outline" size={16} color="#666" />
          <Text style={styles.requirementText}>{t('task_detail.level_requirement', { level: task.min_worker_level })}</Text>
        </View>
        <View style={styles.requirementRow}>
          <Ionicons name="checkmark-circle-outline" size={16} color="#666" />
          <Text style={styles.requirementText}>{t('task_detail.approval_rate_requirement', { rate: task.min_approval_rate })}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.startButton, (isStarting || startTaskMutation.isPending) && styles.startButtonDisabled]}
        onPress={handleStartTask}
        disabled={isStarting || startTaskMutation.isPending || remaining <= 0}
      >
        {(isStarting || startTaskMutation.isPending) ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="play-circle" size={24} color="#fff" />
            <Text style={styles.startButtonText}>
              {remaining <= 0 ? t('task_detail.task_full') : t('task_detail.start_button')}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  taskTypeBadge: {
    backgroundColor: '#6C5CE7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  taskTypeBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  platformBadge: {
    backgroundColor: '#00B894',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  platformBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 24,
    lineHeight: 36,
  },
  rewardCard: {
    backgroundColor: '#6C5CE7',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  rewardLabel: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.9,
    marginBottom: 8,
  },
  rewardAmount: {
    color: '#fff',
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  rewardNote: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.8,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  sectionText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 22,
  },
  linkText: {
    fontSize: 14,
    color: '#6C5CE7',
    textDecorationLine: 'underline',
  },
  proofTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  proofTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6C5CE7',
    textTransform: 'capitalize',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statItem: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  requirementsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  requirementsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  requirementText: {
    fontSize: 14,
    color: '#666',
  },
  startButton: {
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  startButtonDisabled: {
    backgroundColor: '#ccc',
    shadowOpacity: 0,
    elevation: 0,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
  },
});
