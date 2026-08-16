import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { fetchSponsorTasks, type TaskResponseFull } from '@/src/features/sponsor/api';
import { SkeletonPage } from '@/components/skeletons';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

export default function SponsorDashboardScreen() {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'draft' | 'active' | 'completed'>('all');
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const { data: tasks, isLoading, refetch } = useQuery({
    queryKey: ['sponsorTasks', filter],
    queryFn: () => fetchSponsorTasks(filter === 'all' ? undefined : filter),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const renderTask = ({ item }: { item: TaskResponseFull }) => {
    const completionRate = item.max_completions > 0
      ? ((item.completed_count / item.max_completions) * 100).toFixed(0)
      : 0;

    return (
      <TouchableOpacity
        style={[styles.taskCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}
        onPress={() => router.push(`/sponsor/tasks/${item.id}`)}
      >
        <View style={styles.taskHeader}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status, tokens) }]}>
            <Text style={[styles.statusText, { color: tokens.mintText }]}>{t(`sponsor_dashboard.status_${item.status}`)}</Text>
          </View>
          <Text style={[styles.rewardText, { color: tokens.mint }]}>{t('sponsor_dashboard.reward_each', { amount: (item.reward_amount / 100).toFixed(2) })}</Text>
        </View>

        <Text style={[styles.taskTitle, { color: tokens.ink }]} numberOfLines={2}>{item.title}</Text>

        <View style={[styles.statsRow, { borderColor: tokens.border }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: tokens.ink }]}>{t('sponsor_dashboard.completed_of', { completed: item.completed_count, total: item.max_completions })}</Text>
            <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('sponsor_dashboard.completed_label')}</Text>
          </View>

          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: tokens.ink }]}>{t('sponsor_dashboard.pending_count', { count: item.pending_count })}</Text>
            <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('sponsor_dashboard.pending_label')}</Text>
          </View>

          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: tokens.ink }]}>{t('sponsor_dashboard.progress_percent', { percent: completionRate })}</Text>
            <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>{t('sponsor_dashboard.progress_label')}</Text>
          </View>
        </View>

        <View style={styles.taskFooter}>
          <View style={styles.taskMeta}>
            <Ionicons name="calendar-outline" size={14} color={tokens.inkMuted} />
            <Text style={[styles.taskMetaText, { color: tokens.inkMuted }]}>{t('sponsor_dashboard.expires_date', { date: new Date(item.expires_at).toLocaleDateString() })}</Text>
          </View>

          <View style={styles.taskMeta}>
            <Ionicons name="cash-outline" size={14} color={tokens.inkMuted} />
            <Text style={[styles.taskMetaText, { color: tokens.inkMuted }]}>{t('sponsor_dashboard.spent_label', { amount: (item.total_spent / 100).toFixed(2) })}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return <SkeletonPage count={4} header={false} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.paper }]}>
      <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
        <Text style={[styles.headerTitle, { color: tokens.ink }]}>{t('sponsor_dashboard.title')}</Text>
        <TouchableOpacity onPress={() => router.push('/sponsor/tasks/create')}>
          <Ionicons name="add-circle" size={32} color={tokens.mint} />
        </TouchableOpacity>
      </View>

      <View style={[styles.filterContainer, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
        {['all', 'draft', 'active', 'completed'].map((status) => (
          <TouchableOpacity
            key={status}
            style={[
              styles.filterPill,
              {
                backgroundColor: filter === status ? tokens.mint : tokens.paper,
                borderColor: filter === status ? tokens.mint : tokens.border,
              },
            ]}
            onPress={() => setFilter(status as any)}
          >
            <Text style={[styles.filterText, { color: filter === status ? tokens.mintText : tokens.inkMuted }]}>
              {t(`sponsor_dashboard.filter_${status}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={tasks || []}
        renderItem={renderTask}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.mint} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="briefcase-outline" size={64} color={tokens.border} />
            <Text style={[styles.emptyText, { color: tokens.ink }]}>{t('sponsor_dashboard.empty_title')}</Text>
            <TouchableOpacity
              style={[styles.createButton, { backgroundColor: tokens.mint }]}
              onPress={() => router.push('/sponsor/tasks/create')}
            >
              <Ionicons name="add" size={20} color={tokens.mintText} />
              <Text style={[styles.createButtonText, { color: tokens.mintText }]}>{t('sponsor_dashboard.create_first')}</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

function getStatusColor(status: string, tokens: (typeof PagePay)['light']) {
  switch (status) {
    case 'draft': return tokens.inkMuted;
    case 'active': return tokens.mint;
    case 'paused': return '#FFA500'; // keep orange — no dedicated token
    case 'completed': return tokens.mint;
    case 'expired': return tokens.signal;
    default: return tokens.inkMuted;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  filterContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 8,
    borderBottomWidth: 1,
  },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
  },
  taskCard: {
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
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  rewardText: {
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginBottom: 12,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
  },
  taskFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  taskMetaText: {
    fontSize: 12,
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
    marginBottom: 24,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
