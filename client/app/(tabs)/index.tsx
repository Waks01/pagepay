import { useCallback, useMemo, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PLATFORM_ENV } from '@/src/shared/lib/ads';
import { useCatalogFilter } from '@/src/shared/lib/catalog-filter';
import { displayName } from '@/src/shared/lib/display-name';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { useStreak } from '@/src/features/community/hooks/use-community';
import { PageMark } from '@/components/PageMark';
import { CategoryChip } from '@/components/CategoryChip';
import { ContentCard, ContentItem } from '@/components/ContentCard';
import { ResumeCard } from '@/components/ResumeCard';
import { NativeAdBanner } from '@/components/ads/NativeAdBanner';
import { PagePay } from '@/constants/theme';
import { SkeletonPage } from '@/components/skeletons';

const CATEGORIES = ['Fiction', 'Classics', 'News', 'Study'] as const;

type UserMe = {
  id: number;
  email: string | null;
  phone: string | null;
  points_balance: number;
  tier: string;
};

export default function HomeScreen() {
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { t } = useTranslation();

  const setCatalogCategory = useCatalogFilter((s) => s.setCategory);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) throw new Error('Failed to load profile');
      return (await res.json()) as UserMe;
    },
  });

  // Fetch ad config for native unit
  const [nativeAdUnit, setNativeAdUnit] = useState('');
  const { data: adConfig } = useQuery({
    queryKey: ['ads-config'],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/config/ads?env=${PLATFORM_ENV}`);
      if (!res.ok) return {};
      return (await res.json()) as Record<string, string>;
    },
  });

  useEffect(() => {
    if (adConfig) {
      const platform = Platform.OS;
      const unitKey = platform === 'android' ? 'in_feed_android' : 'in_feed_ios';
      setNativeAdUnit(adConfig[unitKey] || '');
    }
  }, [adConfig]);

  const feedQuery = useQuery({
    queryKey: ['feed', 'featured', meQuery.data?.id ?? 0],
    queryFn: async () => {
      // Phase 2: use the feed endpoint so the featured strip
      // includes the same per-user sponsored rotation the
      // catalog tab does. Anonymous users fall back to id=0
      // (the server treats 0 as a stable anonymous bucket).
      const userId = meQuery.data?.id ?? 0;
      const res = await apiFetch(`/api/v1/content/feed/${userId}?limit=10`);
      if (!res.ok) throw new Error('Failed to load feed');
      return (await res.json()) as ContentItem[];
    },
  });

  const streakQuery = useStreak();

  const onCategoryPress = useCallback(
    (category: string) => {
      setCatalogCategory(category);
      router.push('/(tabs)/catalog');
    },
    [router, setCatalogCategory],
  );

  const onCardPress = useCallback(
    (id: number) => {
      router.push(`/book/${id}` as never);
    },
    [router],
  );

  // Keep Reading section. We render a LIST of every in-progress work —
  // GET /api/v1/progress returns one WorkProgress row per unfinished work.
  // The user's progress is preserved per work, not collapsed to a single
  // "current book" that gets replaced when they switch.
  type ResumePayload = {
    workId: number;
    sliceId: number;
    title: string;
    author: string | null;
    progress: number;  // 0..1
    minutesLeft: number;
  };

  const inProgressQuery = useQuery({
    queryKey: ['progress', 'in-progress'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/progress');
      if (!res.ok) throw new Error('Failed to load in-progress works');
      const data = (await res.json()) as Array<{
        work_id: number;
        work_title: string;
        slice_title: string;
        slice_order: number;
        current_slice_id: number | null;
        total_slices: number;
        slices_completed: number;
        percent_complete: number;
        is_finished: boolean;
        last_read_at: string | null;
        author: string | null;
      }>;
      return data.filter((w) => !w.is_finished);
    },
  });

  // Derive the resume payloads. Each card navigates to its work's
  // current slice — `/reader/{sliceId}` — so the user lands in the
  // exact slice they left off. Per v3 §4.1, deep-linking is the
  // point: no more "open book, find slice, scroll to where I was."
  // If the backend didn't return a current_slice_id (legacy row,
  // missing pointer, or first-time visit), we fall back to
  // `/book/{workId}` so the user can still pick a slice manually
  // — better than a dead link.
  const resumes: ResumePayload[] = useMemo(() => {
    const list = inProgressQuery.data ?? [];
    return list.map((w) => {
      const remainingSlices = Math.max(1, w.total_slices - w.slices_completed);
      return {
        workId: w.work_id,
        sliceId: w.current_slice_id ?? 0,
        title: w.work_title,
        author: w.author ?? null,
        progress: w.percent_complete / 100,
        minutesLeft: Math.max(1, remainingSlices),
      };
    });
  }, [inProgressQuery.data]);

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([meQuery.refetch(), feedQuery.refetch(), inProgressQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }, [meQuery, feedQuery, inProgressQuery]);

  useFocusEffect(
    useCallback(() => {
      meQuery.refetch();
      feedQuery.refetch();
      inProgressQuery.refetch();
    }, [meQuery, feedQuery, inProgressQuery])
  );

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return t('home.greeting_still_up');
    if (h < 12) return t('home.greeting_morning');
    if (h < 17) return t('home.greeting_afternoon');
    if (h < 21) return t('home.greeting_evening');
    return t('home.greeting_night');
  }, [t]);

  const points = meQuery.data?.points_balance ?? 0;
  const name = displayName(meQuery.data);
  const items = feedQuery.data ?? [];
  const streakData = streakQuery.data as { current_streak: number } | undefined;

  const meError = meQuery.isError;
  const inProgressError = inProgressQuery.isError;

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: tokens.paper }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.mint}
          />
        }
      >
        {/* Top row: greeting + balance chip */}
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.greeting, { color: tokens.inkMuted, fontFamily: 'SpaceGrotesk_500Medium' }]}
            >
              {greeting},
            </Text>
            <Text
              style={[styles.name, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
            >
              {name}.
            </Text>
          </View>

          {meError && (
            <View style={[styles.stateBlock, { borderColor: tokens.signal }]}>
              <Ionicons name="cloud-offline-outline" size={20} color={tokens.signal} />
              <Text style={[styles.stateText, { color: tokens.signal }]}>
                {t('home.feed_error')}
              </Text>
              <TouchableOpacity
                onPress={() => meQuery.refetch()}
                style={[styles.retry, { borderColor: tokens.signal }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.retryText, { color: tokens.signal }]}>{t('home.try_again')}</Text>
              </TouchableOpacity>
            </View>
          )}
          {streakData && streakData.current_streak > 0 && (
            <View style={[styles.streakBadge, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}>
              <Text style={styles.streakEmoji}>🔥</Text>
              <Text style={[styles.streakText, { color: tokens.mint }]}>
                {streakData.current_streak}d
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={() => router.push('/(tabs)/wallet')}
            accessibilityRole="button"
            accessibilityLabel={t('home.wallet_access', { points })}
            style={[styles.balanceChip, { backgroundColor: tokens.card, borderColor: tokens.border }]}
            activeOpacity={0.7}
          >
            <View style={[styles.balanceDot, { backgroundColor: tokens.mint }]} />
            <Text
              style={[
                styles.balanceAmount,
                { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' },
              ]}
            >
              {meQuery.isLoading ? '—' : points.toLocaleString()}
            </Text>
            <Text style={[styles.balanceLabel, { color: tokens.inkMuted }]}>{t('home.points_label')}</Text>
          </TouchableOpacity>
        </View>

        {/* Brand mark */}
        <View style={styles.markRow}>
          <PageMark />
        </View>

         {/* Resume slot */}
        {inProgressQuery.isLoading ? (
          <View style={styles.section}>
            <Text
              style={[styles.sectionTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
            >
              {t('home.keep_reading')}
            </Text>
            <View style={{ height: 140 }} />
          </View>
        ) : inProgressQuery.isError ? (
          <View style={styles.section}>
            <Text
              style={[styles.sectionTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
            >
              {t('home.keep_reading')}
            </Text>
            <View style={[styles.stateBlock, { borderColor: tokens.signal }]}>
              <Ionicons name="cloud-offline-outline" size={20} color={tokens.signal} />
              <Text style={[styles.stateText, { color: tokens.signal }]}>
                {t('home.feed_error')}
              </Text>
              <TouchableOpacity
                onPress={() => inProgressQuery.refetch()}
                style={[styles.retry, { borderColor: tokens.signal }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.retryText, { color: tokens.signal }]}>{t('home.try_again')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : resumes.length > 0 ? (
          <View style={styles.section}>
            <Text
              style={[styles.sectionTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
            >
              {t('home.keep_reading')}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingRight: 16 }}
              decelerationRate="fast"
              snapToInterval={272}
              snapToAlignment="start"
            >
              {resumes.map((r) => (
                <ResumeCard
                  key={r.workId}
                  title={r.title}
                  author={r.author}
                  progress={r.progress}
                  minutesLeft={r.minutesLeft}
                  onPress={() =>
                    router.push(
                      r.sliceId
                        ? (`/reader/${r.sliceId}` as never)
                        : (`/book/${r.workId}` as never),
                    )
                  }
                />
              ))}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.section}>
            <Text
              style={[styles.sectionTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
            >
              {t('home.keep_reading')}
            </Text>
            <View style={[styles.stateBlock, { borderColor: tokens.border }]}>
              <Text style={[styles.stateText, { color: tokens.inkMuted }]}>
                {t('home.empty_feed')}
              </Text>
            </View>
          </View>
        )}

        {/* Browse by category */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
          >
            {t('home.browse')}
          </Text>
          <View style={styles.chipsRow}>
            {CATEGORIES.map((c) => (
              <CategoryChip 
                key={c} 
                label={t(`home.categories.${c.toLowerCase()}`)} 
                onPress={() => onCategoryPress(c)} 
              />
            ))}
          </View>
        </View>

        {/* Trending today */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text
              style={[styles.sectionTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
            >
              {t('home.trending')}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setCatalogCategory(null);
                router.push('/(tabs)/catalog');
              }}
              hitSlop={6}
              accessibilityRole="link"
              accessibilityLabel="See all content in catalog"
            >
              <Text style={[styles.seeAll, { color: tokens.mint }]}>{t('home.see_all')}</Text>
            </TouchableOpacity>
          </View>

          {feedQuery.isLoading && items.length === 0 ? (
            <SkeletonPage count={2} header={false} />
          ) : feedQuery.isError ? (
            <View style={[styles.stateBlock, { borderColor: tokens.signal }]}>
              <Ionicons name="cloud-offline-outline" size={20} color={tokens.signal} />
              <Text style={[styles.stateText, { color: tokens.signal }]}>
                {t('home.feed_error')}
              </Text>
              <TouchableOpacity
                onPress={() => feedQuery.refetch()}
                style={[styles.retry, { borderColor: tokens.signal }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.retryText, { color: tokens.signal }]}>{t('home.try_again')}</Text>
              </TouchableOpacity>
            </View>
          ) : items.length === 0 ? (
            <View style={[styles.stateBlock, { borderColor: tokens.border }]}>
              <Text style={[styles.stateText, { color: tokens.inkMuted }]}>
                {t('home.empty_feed')}
              </Text>
            </View>
          ) : (
            <View style={styles.feed}>
              {items.map((item, index) => {
                // Inject native ad every 4th position
                const shouldShowAd = (index + 1) % 4 === 0 && nativeAdUnit;
                
                return (
                  <View key={`feed-${item.id}-${index}`}>
                    <ContentCard
                      item={item}
                      onPress={() => onCardPress(item.id)}
                    />
                    {shouldShowAd && (
                      <NativeAdBanner
                        adUnit={nativeAdUnit}
                        sessionId={null}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 24,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  greeting: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
  },
  name: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    marginTop: 2,
  },
  balanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  balanceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  balanceAmount: {
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: -0.2,
  },
  balanceLabel: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  markRow: {
    marginTop: -8,
  },
  section: {
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  seeAll: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  feed: {
    gap: 12,
  },
  stateBlock: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  stateText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  retry: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '600',
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  streakEmoji: {
    fontSize: 14,
  },
  streakText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
