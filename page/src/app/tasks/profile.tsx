import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchWorkerStats, fetchTasks } from '@/src/features/tasks/api';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { SkeletonDetailPage } from '@/components/skeletons';
import { koboToPoints, koboToNairaString } from '@/src/shared/lib/money';

export default function WorkerProfileScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['workerStats'],
    queryFn: fetchWorkerStats,
  });
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: fetchTasks,
  });

  const isLoading = statsLoading || tasksLoading;

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

  const availableTasksCount = tasks.length;
  const potentialEarnings = tasks.reduce((sum, t) => {
    const netKobo = Math.floor(t.reward_amount * (t.reward_multiplier ?? 1) * 0.85);
    return sum + koboToPoints(netKobo);
  }, 0);

  const approvalRate = stats.approval_rate.toFixed(1);
  const totalEarned = (stats.total_earned / 100).toFixed(2);
  const progressPercent = (stats.worker_xp / (stats.worker_xp + stats.xp_to_next_level)) * 100;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.ink }]}>{t('task_profile.title')}</Text>
        </View>

        {/* Level Card */}
        <View style={[styles.levelCard, { backgroundColor: tokens.mint }]}>
          <View style={[styles.levelBadge, { backgroundColor: tokens.mintText }]}>
            <Text style={[styles.levelNumber, { color: tokens.mint }]}>{stats.worker_level}</Text>
          </View>
          <Text style={[styles.levelLabel, { color: tokens.mintText }]}>{t('task_profile.level_label')}</Text>
          <View style={styles.xpContainer}>
            <View style={[styles.xpBar, { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
              <View style={[styles.xpFill, { width: `${progressPercent}%`, backgroundColor: tokens.mintText }]} />
            </View>
            <Text style={[styles.xpText, { color: tokens.mintText }]}>
              {t('task_profile.xp_label', { current: stats.worker_xp, total: stats.worker_xp + stats.xp_to_next_level })}
            </Text>
          </View>
        </View>

        {/* Available Tasks Summary */}
        <View style={[styles.section, { backgroundColor: tokens.card }]}>
          <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
            <Ionicons name="briefcase-outline" size={20} color={tokens.mint} />{' '}
            {t('tasks.title')}
          </Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Ionicons name="list-outline" size={28} color={tokens.mint} />
              <Text style={[styles.statValue, { color: tokens.ink }]}>{availableTasksCount}</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('tasks.stats.available')}</Text>
            </View>
            <View style={styles.statCard}>
              <Ionicons name="cash-outline" size={28} color={tokens.mint} />
              <Text style={[styles.statValue, { color: tokens.ink }]}>
                {potentialEarnings.toLocaleString()}
              </Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>
                {t('tasks.stats.potential_earnings')}
              </Text>
            </View>
          </View>
        </View>

        {/* Worker Stats Grid */}
        <View style={[styles.section, { backgroundColor: tokens.card }]}>
          <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
            <Ionicons name="stats-chart-outline" size={20} color={tokens.mint} />{' '}
            {t('task_profile.stats.title', { defaultValue: 'Your Stats' })}
          </Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Ionicons name="checkmark-circle-outline" size={28} color={tokens.mint} />
              <Text style={[styles.statValue, { color: tokens.ink }]}>{stats.tasks_completed}</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('task_profile.stats.completed')}</Text>
            </View>

            <View style={styles.statCard}>
              <Ionicons name="trending-up-outline" size={28} color={tokens.mint} />
              <Text style={[styles.statValue, { color: tokens.ink }]}>{approvalRate}%</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('task_profile.stats.approval_rate')}</Text>
            </View>

            <View style={styles.statCard}>
              <Ionicons name="cash-outline" size={28} color={tokens.mint} />
              <Text style={[styles.statValue, { color: tokens.ink }]}>₦{totalEarned}</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('task_profile.stats.total_earned')}</Text>
            </View>

            <View style={styles.statCard}>
              <Ionicons name="close-circle-outline" size={28} color={tokens.signal} />
              <Text style={[styles.statValue, { color: tokens.ink }]}>{stats.tasks_rejected}</Text>
              <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('task_profile.stats.rejected')}</Text>
            </View>
          </View>
        </View>

        {/* Streak Section */}
        <View style={[styles.section, { backgroundColor: tokens.card }]}>
          <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
            <Ionicons name="flame" size={20} color="#FF6B35" /> {t('task_profile.streaks_title')}
          </Text>
          <View style={styles.streakRow}>
            <View style={styles.streakItem}>
              <Text style={[styles.streakValue, { color: tokens.ink }]}>{stats.current_streak}</Text>
              <Text style={[styles.streakLabel, { color: tokens.inkMuted }]}>{t('task_profile.current_streak')}</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: tokens.border }]} />
            <View style={styles.streakItem}>
              <Text style={[styles.streakValue, { color: tokens.ink }]}>{stats.longest_streak}</Text>
              <Text style={[styles.streakLabel, { color: tokens.inkMuted }]}>{t('task_profile.longest_streak')}</Text>
            </View>
          </View>
        </View>

        {/* Badges */}
        {stats.badges && stats.badges.length > 0 && (
          <View style={[styles.section, { backgroundColor: tokens.card }]}>
            <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
              <Ionicons name="ribbon" size={20} color="#FFD700" /> {t('task_profile.badges_title')}
            </Text>
            <View style={styles.badgesGrid}>
              {stats.badges.map((badge, index) => (
                <View key={index} style={styles.badge}>
                  <Ionicons name="star" size={24} color="#FFD700" />
                  <Text style={[styles.badgeText, { color: tokens.ink }]}>{badge}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Action Buttons */}
        <TouchableOpacity
          style={[styles.historyButton, { borderColor: tokens.mint }]}
          onPress={() => router.push('/tasks/history')}
        >
          <Ionicons name="list" size={24} color={tokens.mint} />
          <Text style={[styles.historyButtonText, { color: tokens.mint }]}>{t('task_profile.history_button')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tasksButton, { backgroundColor: tokens.mint }]}
          onPress={() => router.push('/tasks')}
        >
          <Ionicons name="briefcase" size={24} color={tokens.mintText} />
          <Text style={[styles.tasksButtonText, { color: tokens.mintText }]}>{t('task_profile.browse_tasks_button')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  levelCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  levelBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  levelNumber: {
    fontSize: 36,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  levelLabel: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  xpContainer: {
    width: '100%',
  },
  xpBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  xpFill: {
    height: '100%',
    borderRadius: 4,
  },
  xpText: {
    fontSize: 14,
    textAlign: 'center',
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
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
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 8,
  },
  streakLabel: {
    fontSize: 14,
  },
  divider: {
    width: 1,
    height: 40,
    marginHorizontal: 16,
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyButton: {
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
    borderWidth: 2,
  },
  historyButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  tasksButton: {
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tasksButtonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  errorText: {
    fontSize: 16,
  },
});
