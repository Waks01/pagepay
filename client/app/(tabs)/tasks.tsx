import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { fetchTasks, type Task } from '@/src/features/tasks/api';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';
import AppHeader from '@/components/AppHeader';
import { SkeletonPage } from '@/components/skeletons';
import { koboToPoints, koboToNairaString } from '@/src/shared/lib/money';

export default function TasksScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { t } = useTranslation();

  const { data: tasksData, isLoading, refetch } = useQuery({
    queryKey: ['tasks'],
    queryFn: fetchTasks,
  });

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const categories = Array.from(
    new Set((tasksData?.items || []).map((t) => t.category).filter(Boolean))
  );

  const getPlatformIcon = (platform: string): any => {
    const platformLower = platform.toLowerCase();
    switch (platformLower) {
      case 'twitter':
      case 'x':
        return 'logo-twitter';
      case 'instagram':
        return 'logo-instagram';
      case 'tiktok':
        return 'logo-tiktok';
      case 'youtube':
        return 'logo-youtube';
      case 'facebook':
        return 'logo-facebook';
      case 'linkedin':
        return 'logo-linkedin';
      case 'pinterest':
        return 'logo-pinterest';
      case 'telegram':
        return 'logo-telegram';
      case 'snapchat':
        return 'logo-snapchat';
      case 'reddit':
        return 'logo-reddit';
      case 'discord':
        return 'logo-discord';
      case 'website':
        return 'globe-outline';
      case 'app':
        return 'phone-portrait-outline';
      default:
        return 'briefcase-outline';
    }
  };

  const renderTask = ({ item }: { item: Task }) => {
    const netRewardKobo = Math.floor(item.reward_amount * (item.reward_multiplier ?? 1) * 0.85);
    const remaining = item.max_completions - item.completed_count;
    const taskTypeKey = item.task_type as keyof typeof t extends `tasks.task_types.${infer K}` ? K : string;
    // Worker display follows the JumpTask pattern: primary unit is the
    // in-app points balance (which the user sees everywhere else in
    // the app), with the actual naira equivalent shown alongside so
    // they understand the real-world value.
    //
    // Both conversions read from the same env rate via money.ts, so a
    // revaluation only needs updating POINTS_PER_NAIRA in
    // backend/.env AND EXPO_PUBLIC_POINTS_PER_NAIRA in client/.env.
    const points = koboToPoints(netRewardKobo);
    const naira = koboToNairaString(netRewardKobo);

    return (
      <TouchableOpacity
        style={[styles.taskCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}
        onPress={() => router.push(`/tasks/${item.id}`)}
      >
        <View style={styles.taskHeader}>
          <View style={[styles.taskTypeBadge, { backgroundColor: tokens.mint }]}>
            <Text style={[styles.taskTypeBadgeText, { color: tokens.mintText }]}>
              {t(`tasks.task_types.${item.task_type}`, { defaultValue: item.task_type.replace('_', ' ') })}
            </Text>
          </View>
          <View style={[styles.rewardBadge, { backgroundColor: tokens.mintSoft }]}>
            <Text style={[styles.rewardPointsText, { color: tokens.mint }]}>
              +{points.toLocaleString()} {t('tasks.points_unit')}
            </Text>
            <Text style={[styles.rewardNairaText, { color: tokens.mint }]}>
              ≈ {naira}
            </Text>
          </View>
        </View>

        <Text style={[styles.taskTitle, { color: tokens.ink }]} numberOfLines={2}>
          {item.title}
        </Text>

        <Text style={[styles.taskDescription, { color: tokens.inkMuted }]} numberOfLines={2}>
          {item.description}
        </Text>

        <View style={styles.taskFooter}>
          <View style={styles.taskMeta}>
            <Ionicons name={getPlatformIcon(item.platform)} size={14} color={tokens.inkMuted} />
            <Text style={[styles.taskMetaText, { color: tokens.inkMuted }]}>
              {t(`tasks.platforms.${item.platform.toLowerCase()}`, { defaultValue: item.platform })}
            </Text>
          </View>

          <View style={styles.taskMeta}>
            <Ionicons name="people-outline" size={14} color={tokens.inkMuted} />
            <Text style={[styles.taskMetaText, { color: tokens.inkMuted }]}>
              {t('tasks.remaining', { count: remaining })}
            </Text>
          </View>

          <View style={styles.taskMeta}>
            <Ionicons name="time-outline" size={14} color={tokens.inkMuted} />
            <Text style={[styles.taskMetaText, { color: tokens.inkMuted }]}>
              {new Date(item.expires_at).toLocaleDateString()}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: tokens.paper }]}>
        <ActivityIndicator size="large" color={tokens.mint} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: tokens.paper }]}>
      <AppHeader title={t('tasks.title')} />
      <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
        <Text style={[styles.headerTitle, { color: tokens.ink }]}>{t('tasks.title')}</Text>
        <TouchableOpacity onPress={() => router.push('/tasks/profile')}>
          <Ionicons name="stats-chart" size={24} color={tokens.mint} />
        </TouchableOpacity>
      </View>

      {categories.length > 0 && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterPill, !categoryFilter && styles.filterPillActive]}
            onPress={() => setCategoryFilter(null)}
          >
            <Text style={[styles.filterPillText, !categoryFilter && styles.filterPillTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.filterPill, categoryFilter === cat && styles.filterPillActive]}
              onPress={() => setCategoryFilter(cat)}
            >
              <Text style={[styles.filterPillText, categoryFilter === cat && styles.filterPillTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={(tasksData?.items || []).filter(
          (t) => !categoryFilter || t.category === categoryFilter
        )}
        renderItem={renderTask}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.mint}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="briefcase-outline" size={64} color={tokens.border} />
            <Text style={[styles.emptyText, { color: tokens.ink }]}>{t('tasks.empty_title')}</Text>
            <Text style={[styles.emptySubtext, { color: tokens.inkMuted }]}>
              {t('tasks.empty_subtitle')}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  listContent: {
    padding: 16,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E2DA',
  },
  filterPillActive: {
    backgroundColor: '#0E7C66',
    borderColor: '#0E7C66',
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    fontFamily: 'SpaceGrotesk_600',
  },
  filterPillTextActive: {
    color: '#fff',
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
  taskTypeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  taskTypeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  rewardBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'flex-end',
  },
  rewardPointsText: {
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  rewardNairaText: {
    fontSize: 11,
    opacity: 0.8,
    marginTop: 1,
  },
  rewardText: {
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 6,
  },
  taskDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
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
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
  },
});
