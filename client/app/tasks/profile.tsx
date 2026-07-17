import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { fetchWorkerStats } from '@/src/features/tasks/api';
import { SkeletonDetailPage } from '@/components/skeletons';

export default function WorkerProfileScreen() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useQuery({
    queryKey: ['workerStats'],
    queryFn: fetchWorkerStats,
  });

  if (isLoading) {
    return <SkeletonDetailPage />;
  }

  if (!stats) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{t('task_profile.load_error')}</Text>
      </View>
    );
  }

  const approvalRate = stats.approval_rate.toFixed(1);
  const totalEarned = (stats.total_earned / 100).toFixed(2);
  const progressPercent = (stats.worker_xp / (stats.worker_xp + stats.xp_to_next_level)) * 100;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('task_profile.title')}</Text>
      </View>

      {/* Level Card */}
      <View style={styles.levelCard}>
        <View style={styles.levelBadge}>
          <Text style={styles.levelNumber}>{stats.worker_level}</Text>
        </View>
        <Text style={styles.levelLabel}>{t('task_profile.level_label')}</Text>
        <View style={styles.xpContainer}>
          <View style={styles.xpBar}>
            <View style={[styles.xpFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.xpText}>
            {t('task_profile.xp_label', { current: stats.worker_xp, total: stats.worker_xp + stats.xp_to_next_level })}
          </Text>
        </View>
      </View>

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Ionicons name="checkmark-circle" size={32} color="#00B894" />
          <Text style={styles.statValue}>{stats.tasks_completed}</Text>
          <Text style={styles.statLabel}>{t('task_profile.stats.completed')}</Text>
        </View>

        <View style={styles.statCard}>
          <Ionicons name="trending-up" size={32} color="#6C5CE7" />
          <Text style={styles.statValue}>{approvalRate}%</Text>
          <Text style={styles.statLabel}>{t('task_profile.stats.approval_rate')}</Text>
        </View>

        <View style={styles.statCard}>
          <Ionicons name="cash" size={32} color="#00B894" />
          <Text style={styles.statValue}>₦{totalEarned}</Text>
          <Text style={styles.statLabel}>{t('task_profile.stats.total_earned')}</Text>
        </View>

        <View style={styles.statCard}>
          <Ionicons name="close-circle" size={32} color="#ff6b6b" />
          <Text style={styles.statValue}>{stats.tasks_rejected}</Text>
          <Text style={styles.statLabel}>{t('task_profile.stats.rejected')}</Text>
        </View>
      </View>

      {/* Streak Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          <Ionicons name="flame" size={20} color="#FF6B35" /> {t('task_profile.streaks_title')}
        </Text>
        <View style={styles.streakRow}>
          <View style={styles.streakItem}>
            <Text style={styles.streakValue}>{stats.current_streak}</Text>
            <Text style={styles.streakLabel}>{t('task_profile.current_streak')}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.streakItem}>
            <Text style={styles.streakValue}>{stats.longest_streak}</Text>
            <Text style={styles.streakLabel}>{t('task_profile.longest_streak')}</Text>
          </View>
        </View>
      </View>

      {/* Badges */}
      {stats.badges && stats.badges.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="ribbon" size={20} color="#FFD700" /> {t('task_profile.badges_title')}
          </Text>
          <View style={styles.badgesGrid}>
            {stats.badges.map((badge, index) => (
              <View key={index} style={styles.badge}>
                <Ionicons name="star" size={24} color="#FFD700" />
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Action Buttons */}
      <TouchableOpacity
        style={styles.historyButton}
        onPress={() => router.push('/tasks/history')}
      >
        <Ionicons name="list" size={24} color="#6C5CE7" />
        <Text style={styles.historyButtonText}>{t('task_profile.history_button')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.tasksButton}
        onPress={() => router.push('/(tabs)/tasks')}
      >
        <Ionicons name="briefcase" size={24} color="#fff" />
        <Text style={styles.tasksButtonText}>{t('task_profile.browse_tasks_button')}</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  levelCard: {
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
  levelBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  levelNumber: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#6C5CE7',
  },
  levelLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  xpContainer: {
    width: '100%',
  },
  xpBar: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  xpFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 4,
  },
  xpText: {
    fontSize: 14,
    color: '#fff',
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  streakItem: {
    flex: 1,
    alignItems: 'center',
  },
  streakValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FF6B35',
    marginBottom: 8,
  },
  streakLabel: {
    fontSize: 14,
    color: '#666',
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: '#e0e0e0',
    marginHorizontal: 16,
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  badge: {
    backgroundColor: '#FFF9E6',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  historyButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#6C5CE7',
  },
  historyButtonText: {
    color: '#6C5CE7',
    fontSize: 16,
    fontWeight: '600',
  },
  tasksButton: {
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
  tasksButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
  },
});
