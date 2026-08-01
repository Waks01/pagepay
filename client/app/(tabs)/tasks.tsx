import { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, TextInput, ScrollView, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { fetchTasks, type TaskListItem } from '@/src/features/tasks/api';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import NotificationBell from '@/components/NotificationBell';
import { Skeleton } from '@/components/Skeleton';
import { koboToPoints, koboToNairaString } from '@/src/shared/lib/money';

const CATEGORIES = [
  { key: 'all', labelKey: 'tasks.categories.all', icon: 'apps-outline' },
  { key: 'social_media', labelKey: 'tasks.categories.social_media', icon: 'people-outline' },
  { key: 'engagement', labelKey: 'tasks.categories.engagement', icon: 'heart-outline' },
  { key: 'website', labelKey: 'tasks.categories.website', icon: 'globe-outline' },
  { key: 'app', labelKey: 'tasks.categories.app', icon: 'phone-portrait-outline' },
  { key: 'content_creation', labelKey: 'tasks.categories.content_creation', icon: 'create-outline' },
  { key: 'surveys', labelKey: 'tasks.categories.surveys', icon: 'clipboard-outline' },
  { key: 'data_collection', labelKey: 'tasks.categories.data_collection', icon: 'server-outline' },
  { key: 'other', labelKey: 'tasks.categories.other', icon: 'ellipsis-horizontal' },
] as const;

const SORT_OPTIONS = [
  { key: 'newest', labelKey: 'tasks.sort.newest', icon: 'time-outline' },
  { key: 'highest_reward', labelKey: 'tasks.sort.highest_reward', icon: 'cash-outline' },
  { key: 'quickest', labelKey: 'tasks.sort.quickest', icon: 'flash-outline' },
  { key: 'popular', labelKey: 'tasks.sort.popular', icon: 'trending-up-outline' },
] as const;

const PLATFORM_ICONS: Record<string, string> = {
  twitter: 'logo-twitter',
  x: 'logo-twitter',
  instagram: 'logo-instagram',
  tiktok: 'logo-tiktok',
  youtube: 'logo-youtube',
  facebook: 'logo-facebook',
  linkedin: 'logo-linkedin',
  pinterest: 'logo-pinterest',
  telegram: 'send-outline',
  snapchat: 'logo-snapchat',
  reddit: 'logo-reddit',
  discord: 'logo-discord',
  website: 'globe-outline',
  app: 'phone-portrait-outline',
  web: 'globe-outline',
  android: 'logo-android',
  ios: 'logo-apple',
};

const TASK_TYPE_LABELS: Record<string, string> = {
  twitter_follow: 'Follow',
  twitter_like: 'Like',
  twitter_retweet: 'Retweet',
  twitter_comment: 'Comment',
  twitter_share: 'Share',
  instagram_follow: 'Follow',
  instagram_like: 'Like',
  instagram_comment: 'Comment',
  instagram_repost: 'Repost',
  tiktok_follow: 'Follow',
  tiktok_like: 'Like',
  tiktok_comment: 'Comment',
  tiktok_share: 'Share',
  youtube_subscribe: 'Subscribe',
  youtube_like: 'Like',
  youtube_watch: 'Watch',
  youtube_comment: 'Comment',
  youtube_share: 'Share',
  facebook_follow: 'Follow',
  facebook_like: 'Like',
  linkedin_follow: 'Follow',
  linkedin_like: 'Like',
  linkedin_comment: 'Comment',
  pinterest_follow: 'Follow',
  pinterest_like: 'Like',
  pinterest_repin: 'Repin',
  pinterest_comment: 'Comment',
  telegram_join: 'Join',
  telegram_view: 'View',
  snapchat_add_friend: 'Add Friend',
  snapchat_view_story: 'View Story',
  reddit_follow: 'Follow',
  reddit_upvote: 'Upvote',
  reddit_comment: 'Comment',
  discord_join_server: 'Join Server',
  discord_verify: 'Verify',
  discord_message: 'Message',
  website_visit: 'Visit',
  website_signup: 'Sign Up',
  app_download: 'Download',
  app_review: 'Review',
  photo_upload: 'Upload Photo',
  video_upload: 'Upload Video',
  written_review: 'Write Review',
  survey: 'Survey',
  custom: 'Custom',
};

export default function TasksScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [refreshing, setRefreshing] = useState(false);

  const { data: tasks = [], isLoading, refetch } = useQuery({
    queryKey: ['tasks'],
    queryFn: fetchTasks,
  });

  const categories = useMemo(() => {
    const cats = Array.from(new Set(tasks.map((t) => t.category).filter(Boolean)));
    return ['all', ...cats];
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    if (activeCategory !== 'all') {
      result = result.filter((t) => t.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.task_type.toLowerCase().includes(q) ||
        t.platform.toLowerCase().includes(q)
      );
    }

    switch (sortBy) {
      case 'highest_reward':
        result.sort((a, b) => b.reward_amount - a.reward_amount);
        break;
      case 'quickest':
        result.sort((a, b) => (a.time_estimate_minutes || 999) - (b.time_estimate_minutes || 999));
        break;
      case 'popular':
        result.sort((a, b) => b.completed_count - a.completed_count);
        break;
      default:
        result.sort((a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime());
    }

    return result;
  }, [tasks, activeCategory, searchQuery, sortBy]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const renderSkeleton = () => (
    <View style={{ padding: 16, gap: 16 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <View
          key={i}
          style={{
            backgroundColor: tokens.card,
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: tokens.border,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Skeleton height={14} width="35%" borderRadius={6} />
            <Skeleton height={32} width={100} borderRadius={8} />
          </View>
          <Skeleton height={20} width="90%" />
          <Skeleton height={14} width="100%" />
          <Skeleton height={14} width="75%" />
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
            <Skeleton height={14} width={70} />
            <Skeleton height={14} width={90} />
            <Skeleton height={14} width={80} />
          </View>
        </View>
      ))}
    </View>
  );

  const renderTask = ({ item }: { item: TaskListItem }) => {
    const netRewardKobo = Math.floor(item.reward_amount * (item.reward_multiplier ?? 1) * 0.85);
    const remaining = item.max_completions - item.completed_count;
    const points = koboToPoints(netRewardKobo);
    const naira = koboToNairaString(netRewardKobo);
    const platformIcon = PLATFORM_ICONS[item.platform.toLowerCase()] || 'briefcase-outline';
    const taskLabel = TASK_TYPE_LABELS[item.task_type] || item.task_type.replace(/_/g, ' ');
    const remainingPercent = Math.round((item.completed_count / Math.max(1, item.max_completions)) * 100);
    const isAlmostFull = remainingPercent > 80;
    const expiresDate = new Date(item.expires_at);
    const isExpiringSoon = expiresDate.getTime() - Date.now() < 86400000 * 2;

    return (
      <TouchableOpacity
        style={[styles.taskCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}
        onPress={() => router.push(`/tasks/${item.id}`)}
        activeOpacity={0.7}
      >
        {/* Top row: badge + reward */}
        <View style={styles.taskHeader}>
          <View style={styles.taskHeaderLeft}>
            <View style={[styles.taskTypeBadge, { backgroundColor: tokens.mintSoft }]}>
              <Ionicons name={platformIcon as any} size={12} color={tokens.mint} />
              <Text style={[styles.taskTypeBadgeText, { color: tokens.mint }]}>
                {taskLabel}
              </Text>
            </View>
            {item.task_source === 'admin' && (
              <View style={[styles.sourceBadge, { backgroundColor: tokens.signalSoft }]}>
                <Text style={[styles.sourceBadgeText, { color: tokens.signal }]}>Official</Text>
              </View>
            )}
          </View>

          <View style={[styles.rewardBadge, { backgroundColor: tokens.mint }]}>
            <Text style={[styles.rewardPointsText, { color: tokens.mintText }]}>
              +{points.toLocaleString()}
            </Text>
            <Text style={[styles.rewardNairaText, { color: tokens.mintText }]}>
              ≈ {naira}
            </Text>
          </View>
        </View>

        {/* Title + description */}
        <Text style={[styles.taskTitle, { color: tokens.ink }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.taskDescription, { color: tokens.inkMuted }]} numberOfLines={2}>
          {item.description}
        </Text>

        {/* Progress bar */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { backgroundColor: tokens.border }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: isAlmostFull ? tokens.signal : tokens.mint,
                  width: `${Math.min(remainingPercent, 100)}%`,
                },
              ]}
            />
          </View>
          <Text style={[styles.progressText, { color: tokens.inkMuted }]}>
            {remaining} {t('tasks.remaining', { count: remaining })}
          </Text>
        </View>

        {/* Footer meta */}
        <View style={styles.taskFooter}>
          <View style={styles.taskMeta}>
            <Ionicons name="time-outline" size={14} color={tokens.inkMuted} />
            <Text style={[styles.taskMetaText, { color: tokens.inkMuted }]}>
              {item.time_estimate_minutes} min
            </Text>
          </View>

          <View style={styles.taskMeta}>
            <Ionicons name="calendar-outline" size={14} color={isExpiringSoon ? tokens.signal : tokens.inkMuted} />
            <Text style={[styles.taskMetaText, { color: isExpiringSoon ? tokens.signal : tokens.inkMuted }]}>
              {expiresDate.toLocaleDateString()}
            </Text>
          </View>

          {item.sponsor_business_name && (
            <View style={styles.taskMeta}>
              <Ionicons name="business-outline" size={14} color={tokens.inkMuted} />
              <Text style={[styles.taskMetaText, { color: tokens.inkMuted }]} numberOfLines={1}>
                {item.sponsor_business_name}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconContainer, { backgroundColor: tokens.mintSoft }]}>
        <Ionicons name="briefcase-outline" size={48} color={tokens.mint} />
      </View>
      <Text style={[styles.emptyTitle, { color: tokens.ink }]}>
        {searchQuery ? t('tasks.empty_search_title') : t('tasks.empty_title')}
      </Text>
      <Text style={[styles.emptySubtitle, { color: tokens.inkMuted }]}>
        {searchQuery ? t('tasks.empty_search_subtitle') : t('tasks.empty_subtitle')}
      </Text>
      {!searchQuery && (
        <TouchableOpacity
          style={[styles.emptyCta, { backgroundColor: tokens.mint }]}
          onPress={() => router.push('/tasks/profile')}
        >
          <Text style={[styles.emptyCtaText, { color: tokens.mintText }]}>
            {t('tasks.empty_cta')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
        <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
          <View style={styles.headerRow}>
            <Image source={require('@/assets/images/icon.png')} style={styles.headerIcon} />
            <Text style={[styles.headerTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              {t('tasks.title')}
            </Text>
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.headerIconBtn}
                onPress={() => router.push('/tasks/profile')}
                accessibilityRole="button"
                accessibilityLabel={t('tasks.stats.my_stats')}
              >
                <Ionicons name="stats-chart-outline" size={22} color={tokens.ink} />
              </TouchableOpacity>
              <NotificationBell />
            </View>
          </View>
        </View>
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={20} width="60%" borderRadius={8} />
          <Skeleton height={44} width="100%" borderRadius={12} />
          <Skeleton height={40} width="100%" borderRadius={20} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Skeleton height={36} width={80} borderRadius={18} />
            <Skeleton height={36} width={100} borderRadius={18} />
            <Skeleton height={36} width={90} borderRadius={18} />
          </View>
        </View>
        {renderSkeleton()}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
        <View style={styles.headerRow}>
          <Image source={require('@/assets/images/icon.png')} style={styles.headerIcon} />
          <Text style={[styles.headerTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
            {t('tasks.title')}
          </Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => router.push('/tasks/profile')}
              accessibilityRole="button"
              accessibilityLabel={t('tasks.stats.my_stats')}
            >
              <Ionicons name="stats-chart-outline" size={22} color={tokens.ink} />
            </TouchableOpacity>
            <NotificationBell />
          </View>
        </View>
      </View>

      {/* Search + Sort row */}
      <View style={[styles.controlsRow, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
        <View style={[styles.searchBar, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Ionicons name="search-outline" size={18} color={tokens.inkMuted} />
          <TextInput
            style={[styles.searchInput, { color: tokens.ink }]}
            placeholder={t('tasks.search_placeholder')}
            placeholderTextColor={tokens.inkMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={tokens.inkMuted} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sortRow}>
          {SORT_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[
                styles.sortPill,
                sortBy === opt.key && [styles.sortPillActive, { backgroundColor: tokens.mint }],
                sortBy !== opt.key && { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
              onPress={() => setSortBy(opt.key)}
            >
              <Ionicons
                name={opt.icon as any}
                size={14}
                color={sortBy === opt.key ? tokens.mintText : tokens.inkMuted}
              />
              <Text
                style={[
                  styles.sortPillText,
                  sortBy === opt.key ? { color: tokens.mintText } : { color: tokens.inkMuted },
                ]}
              >
                {t(opt.labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Category chips - horizontal scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.categoryScroll, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}
        contentContainerStyle={styles.categoryContent}
      >
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.key;
          return (
            <TouchableOpacity
              key={cat.key}
              style={[
                styles.categoryChip,
                isActive && { backgroundColor: tokens.mint },
                !isActive && { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
              onPress={() => setActiveCategory(cat.key)}
            >
              <Ionicons
                name={cat.icon as any}
                size={16}
                color={isActive ? tokens.mintText : tokens.inkMuted}
              />
              <Text
                style={[
                  styles.categoryChipText,
                  isActive ? { color: tokens.mintText } : { color: tokens.inkMuted },
                ]}
              >
                {t(cat.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Task list */}
      <FlatList
        data={filteredTasks}
        renderItem={renderTask}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={[
          styles.listContent,
          filteredTasks.length === 0 && styles.listContentEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.mint}
          />
        }
        ListEmptyComponent={renderEmpty}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 20,
    letterSpacing: -0.2,
    flex: 1,
    textAlign: 'center',
  },
  controlsRow: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 6,
    borderBottomWidth: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    height: 36,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_400',
    paddingVertical: 0,
  },
  sortRow: {
    flexDirection: 'row',
    gap: 6,
  },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  sortPillActive: {
    borderColor: 'transparent',
  },
  sortPillText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_600',
  },
  categoryScroll: {
    maxHeight: 38,
    borderBottomWidth: 1,
    flexGrow: 0,
  },
  categoryContent: {
    paddingHorizontal: 16,
    paddingRight: 20,
    paddingVertical: 6,
    gap: 6,
    alignItems: 'center',
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 6,
    minWidth: 60,
    justifyContent: 'center',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_600',
  },
  listContent: {
    padding: 16,
  },
  listContentEmpty: {
    flex: 1,
  },
  taskCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    gap: 10,
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  taskTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  taskTypeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    textTransform: 'capitalize',
  },
  sourceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rewardBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'flex-end',
  },
  rewardPointsText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    lineHeight: 18,
  },
  rewardNairaText: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.9,
    lineHeight: 14,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    lineHeight: 22,
  },
  taskDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  progressContainer: {
    gap: 6,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_600',
  },
  taskFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  taskMetaText: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCta: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyCtaText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
});
