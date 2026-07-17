import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PLATFORM_ENV } from '@/src/shared/lib/ads';
import { useCatalogFilter } from '@/src/shared/lib/catalog-filter';
import { ContentCard, ContentItem } from '@/components/ContentCard';
import { ResumeCard } from '@/components/ResumeCard';
import { SkeletonContentCard } from '@/components/skeletons';
import { CategoryChip } from '@/components/CategoryChip';
import { NativeAdBanner } from '@/components/ads/NativeAdBanner';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

// Education level options for the catalog level grid. Each entry has
// a label (English, the i18n key is for future localization) and a
// short label for the expanded grid card. The order is from primary
// education up to research — a 6-cell row that fits the spec.
const LEVEL_OPTIONS: ReadonlyArray<{ value: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { value: 'creche', label: 'Creche', icon: 'happy-outline' },
  { value: 'primary', label: 'Primary', icon: 'pencil-outline' },
  { value: 'secondary', label: 'Secondary', icon: 'flask-outline' },
  { value: 'tertiary', label: 'University', icon: 'school-outline' },
  { value: 'research', label: 'Research', icon: 'document-text-outline' },
];

// Class-level vocabulary per v3 §1.2. International Grade 1-12 + Year 1-4.
// `creche` and `research` are bucket-only (no grade system), so the picker
// is empty for those levels. Returning [] from the lookup makes the
// class grid render an empty-state message instead of an empty grid.
const CLASS_LEVELS_BY_EDUCATION: Readonly<Record<string, ReadonlyArray<string>>> = {
  creche: [],
  primary: [
    'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
  ],
  secondary: [
    'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12',
  ],
  tertiary: ['Year 1', 'Year 2', 'Year 3', 'Year 4'],
  research: [],
};

// Anonymous-browse fallback for the per-user sponsored shuffle. Any
// fixed value works — the shuffle is stable per-id so the same
// anonymous user sees the same ad order between page refreshes.
// 0 is reserved server-side (no user has id=0) so it's a safe sentinel.
const ANONYMOUS_USER_ID = 0;

export default function CatalogScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const queryClient = useQueryClient();

  // The store is the source of truth for category. Home writes to it when the
  // user taps a "Browse" chip, and we read it here so the screen comes up
  // already filtered.
  const storeCategory = useCatalogFilter((s) => s.category);
  const setStoreCategory = useCatalogFilter((s) => s.setCategory);

  // Education filters. We keep these as local state rather than
  // store state because they're transient — the user picks a level
  // for one browse session, not as a global preference. Local state
  // is also cleared when the user navigates away and back. Per v3
  // §4.2 the class-level filter is session-only for the same reason
  // (persisting it across launches is noise).
  const [educationLevel, setEducationLevel] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<string | null>(null);
  const [levelGridExpanded, setLevelGridExpanded] = useState(false);

  // Search: typed value + debounced value. We type into `searchInput`
  // and feed `searchDebounced` to the query, so each keystroke doesn't
  // refire the network. 300ms is the sweet spot — fast enough to feel
  // instant, slow enough to coalesce bursts.
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearchDebounced(searchInput.trim());
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchInput]);

  // Reset classLevel if educationLevel changes — the class grid depends
  // on the level, and stale class values from a previous level are
  // confusing. The check `c.startsWith(LEVEL_OPTIONS…)` would also
  // work but this is more explicit and tolerant of future level
  // additions.
  useEffect(() => {
    setClassLevel(null);
  }, [educationLevel]);

  const [refreshing, setRefreshing] = useState(false);

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

  // Phase 2: switch the catalog list source to `/content/feed/:user_id`
  // so the in-feed sponsored rotation lands every 4th item per the
  // spec. The legacy `/content/catalog` endpoint is kept (admin + raw
  // browse) but the user-facing tab now goes through the feed.
  //
  // We need the user_id for the per-user ad shuffle. Auth'd users
  // pass their real id (read from the `me` cache that the layout
  // populates on app start). Anonymous browsers fall back to a
  // fixed id so the shuffle is stable across refreshes.
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const token = await (await import('@/src/shared/lib/storage')).getToken();
      if (!token) return null;
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) return null;
      return (await res.json()) as { id: number };
    },
    staleTime: 5 * 60 * 1000,
  });
  const userId = meQuery.data?.id ?? ANONYMOUS_USER_ID;

  // In-progress works (for the "Keep Reading" carousel, v3 §4.1).
  // We only show the carousel when the catalog is unfiltered — when
  // the user has picked a subject/level/search, they're looking for
  // something specific and the resume list would be noise. Same data
  // shape the home tab uses, so the deep-link fix from the home
  // fix carries over.
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
    enabled: !!meQuery.data, // only fetch when we have a user
  });

  const resumes = useMemo(() => {
    const list = inProgressQuery.data ?? [];
    return list.map((w) => ({
      workId: w.work_id,
      sliceId: w.current_slice_id ?? 0,
      title: w.work_title,
      author: w.author ?? null,
      progress: w.percent_complete / 100,
      minutesLeft: Math.max(1, w.total_slices - w.slices_completed),
    }));
  }, [inProgressQuery.data]);

  // A catalog is "unfiltered" when no chip / level / class / search
  // is active. That's when the resume carousel earns its place.
  const catalogUnfiltered =
    !storeCategory &&
    !educationLevel &&
    !classLevel &&
    !searchDebounced;

  // Fetch distinct categories from the backend for filter chips
  const { data: categories = [] } = useQuery<string[]>({
    queryKey: ['content', 'categories'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/content/categories');
      if (!res.ok) return [];
      return (await res.json()) as string[];
    },
    staleTime: 10 * 60 * 1000,
  });

  const filters = useMemo(() => [t('catalog.filter_all'), ...categories] as const, [categories, t]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['feed', userId, storeCategory, educationLevel, classLevel, searchDebounced],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (storeCategory) params.set('category', storeCategory);
      if (educationLevel) params.set('education_level', educationLevel);
      if (classLevel) params.set('class_level', classLevel);
      if (searchDebounced) params.set('search', searchDebounced);
      params.set('limit', '50');
      const url = `/api/v1/content/feed/${userId}?${params.toString()}`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('Failed to load catalog');
      return (await res.json()) as ContentItem[];
    },
  });

  // On-demand refresh: import a fresh page of Gutendex and re-slice the
  // entire catalog. Used by the empty-state CTA — when the user has
  // finished everything we have, this is the way to get more.
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch('/api/v1/content/refresh', { method: 'POST' });
      if (!res.ok) throw new Error('Refresh failed');
      return (await res.json()) as { imported: number; resliced: { children_added: number; parents_resliced: number } };
    },
    onSuccess: () => {
      // Invalidate every catalog-shaped query so the new books show up.
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      queryClient.invalidateQueries({ queryKey: ['book'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const onClearFilter = useCallback(() => {
    setStoreCategory(null);
  }, [setStoreCategory]);

  const items = data ?? [];
  const isInitialLoad = isLoading && !refreshing && items.length === 0;

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: tokens.paper }]}>
      <View style={styles.header}>
        <Text
          style={[
            styles.headline,
            { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' },
          ]}
        >
          {t('catalog.title')}
        </Text>
        <Text style={[styles.subline, { color: tokens.inkMuted }]}>
          {storeCategory ? t('catalog.subtitle_filtered', { category: storeCategory }) : t('catalog.subtitle_default')}
        </Text>
      </View>

      {/* Search bar (v3 §4.3). Server-side filtered on
          (education_level, class_level, subject, search). Debounced
          300ms in the parent state. Empty + blur = no filter. */}
      <View
        style={[
          styles.searchWrap,
          {
            backgroundColor: tokens.card,
            borderColor: tokens.border,
          },
        ]}
      >
        <Ionicons name="search-outline" size={16} color={tokens.inkMuted} />
        <TextInput
          style={[styles.searchInput, { color: tokens.ink }]}
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder={t('catalog.search_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel={t('catalog.search_placeholder')}
        />
        {searchInput.length > 0 ? (
          <TouchableOpacity
            onPress={() => setSearchInput('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('catalog.search_clear')}
          >
            <Ionicons name="close-circle" size={16} color={tokens.inkMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.filterRow}>
        {/* Subject chips — the primary filter. A student searches by
            subject first ("I need Physics"), then narrows by
            education level + class. Keeping subject as a horizontal
            chip strip (not collapsed) is intentional: it's the
            axis users filter on most. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        >
          {filters.map((f) => {
            const value = f === t('catalog.filter_all') ? null : f;
            return (
              <CategoryChip
                key={f}
                label={f}
                selected={storeCategory === value}
                onPress={() => setStoreCategory(value)}
              />
            );
          })}
        </ScrollView>

        {/* Education level pill — collapsed by default. Tap to expand
            the 5-cell grid; tap a cell to filter by that level. The
            pill text reflects the current selection. */}
        <TouchableOpacity
          style={[
            styles.levelPill,
            {
              backgroundColor: educationLevel ? tokens.mint : tokens.card,
              borderColor: educationLevel ? tokens.mint : tokens.border,
            },
          ]}
          onPress={() => setLevelGridExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={educationLevel ? `Level: ${educationLevel}. Tap to change.` : 'Browse by education level'}
        >
          <Ionicons name="school-outline" size={14} color={educationLevel ? tokens.mintText : tokens.inkMuted} />
          <Text style={[
            styles.levelPillText,
            { color: educationLevel ? tokens.mintText : tokens.inkMuted },
          ]}>
            {educationLevel
              ? LEVEL_OPTIONS.find((l) => l.value === educationLevel)?.label ?? 'Education'
              : 'Education'}
          </Text>
          <Ionicons
            name={levelGridExpanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={educationLevel ? tokens.mintText : tokens.inkMuted}
          />
        </TouchableOpacity>
      </View>

      {/* Expanded level grid. The grid is only mounted when expanded
          to keep the collapsed state cheap. Each cell is 1/3 of the
          row width on small phones, 1/5 on larger. */}
      {levelGridExpanded && (
        <View style={styles.levelGrid}>
          {LEVEL_OPTIONS.map((opt) => {
            const selected = educationLevel === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.levelCell,
                  {
                    borderColor: selected ? tokens.mint : tokens.border,
                    backgroundColor: selected ? tokens.mintSoft : tokens.card,
                  },
                ]}
                onPress={() => {
                  setEducationLevel(selected ? null : opt.value);
                  setLevelGridExpanded(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Filter by ${opt.label}`}
              >
                <Ionicons 
                  name={opt.icon} 
                  size={24} 
                  color={selected ? tokens.mint : tokens.inkMuted} 
                  style={styles.levelIcon}
                />
                <Text style={[
                  styles.levelLabel,
                  { color: selected ? tokens.mint : tokens.ink },
                ]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Class-level picker (v3 §4.2). Only visible when an
          education_level with a class vocabulary (primary, secondary,
          tertiary) is selected. Uses SegmentedControl because the
          class list is long enough that a horizontal scroll would
          make a single tap uncertain — segments are equal-width and
          always fit. The "All" pseudo-segment clears the filter. */}
      {educationLevel && (CLASS_LEVELS_BY_EDUCATION[educationLevel]?.length ?? 0) > 0 ? (
        <View style={styles.classPickerWrap}>
          <Text style={[styles.classPickerLabel, { color: tokens.inkMuted }]}>
            {t('catalog.class_picker_label')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}
          >
            <SegmentedControl
              options={[
                { value: '__all__' as never, label: t('catalog.class_all') },
                ...(CLASS_LEVELS_BY_EDUCATION[educationLevel] ?? []).map((c) => ({
                  value: c as never,
                  label: c,
                })),
              ]}
              value={classLevel as never}
              onChange={(v) => setClassLevel(v === ('__all__' as never) ? null : (v as string))}
              activeBackground={tokens.mint}
              activeText={tokens.mintText}
              inactiveBackground={tokens.card}
              inactiveText={tokens.inkMuted}
              borderColor={tokens.border}
              accessibilityLabel={t('catalog.class_picker_label')}
            />
          </ScrollView>
        </View>
      ) : null}

      {storeCategory ? (
        <TouchableOpacity
          onPress={onClearFilter}
          accessibilityRole="button"
          accessibilityLabel={t('catalog.clear_filter')}
          style={styles.clearRow}
          hitSlop={6}
        >
          <Ionicons name="close-circle" size={14} color={tokens.inkMuted} />
          <Text style={[styles.clearText, { color: tokens.inkMuted }]}>
            {t('catalog.clear_filter')}
          </Text>
        </TouchableOpacity>
      ) : null}

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
        {/* "Keep Reading" carousel. Only shown when the catalog is
            unfiltered (per the v3 §4.1 rule that the home tab is the
            primary surface for resume and the catalog adds it as a
            shortcut when the user lands with no filters applied). The
            carousel is mounted only when there's actually progress to
            show, so the empty case is just "no row here". */}
        {catalogUnfiltered && resumes.length > 0 ? (
          <View style={styles.resumeRow}>
            <Text
              style={[
                styles.resumeTitle,
                { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' },
              ]}
            >
              {t('catalog.keep_reading')}
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
        ) : null}

        {isInitialLoad ? (
          <View style={styles.list}>
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonContentCard key={i} />
            ))}
          </View>
        ) : isError ? (
          <View style={[styles.stateBlock, { borderColor: tokens.signal }]}>
            <Ionicons name="cloud-offline-outline" size={20} color={tokens.signal} />
            <Text style={[styles.stateText, { color: tokens.signal }]}>
              {t('catalog.error_load')}
            </Text>
            <TouchableOpacity
              onPress={() => refetch()}
              style={[styles.retry, { borderColor: tokens.signal }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.retryText, { color: tokens.signal }]}>{t('catalog.try_again')}</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={[styles.stateBlock, { borderColor: tokens.border }]}>
            <Ionicons name="library-outline" size={28} color={tokens.mint} />
            <Text style={[styles.stateText, { color: tokens.inkMuted }]}>
              {storeCategory
                ? t('catalog.empty_filtered', { category: storeCategory })
                : t('catalog.empty_finished')}
            </Text>
            <TouchableOpacity
              onPress={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel={t('catalog.refresh_catalog')}
              activeOpacity={0.9}
              style={[
                styles.refreshBtn,
                {
                  backgroundColor: refreshMutation.isPending ? tokens.border : tokens.mint,
                },
              ]}
            >
              {refreshMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.refreshBtnText}>
                  {storeCategory ? t('catalog.pull_more') : t('catalog.refresh_catalog')}
                </Text>
              )}
            </TouchableOpacity>
            {refreshMutation.isError ? (
              <Text style={[styles.stateText, { color: tokens.signal, fontSize: 12 }]}>
                {t('catalog.refresh_error')}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((item, index) => {
              // Inject native ad every 4th position
              const shouldShowAd = (index + 1) % 4 === 0 && nativeAdUnit;
              
              return (
                <View key={`catalog-${item.id}-${index}`}>
                  <ContentCard
                    item={item}
                    onPress={() => router.push(`/book/${item.id}` as never)}
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
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 4,
  },
  headline: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  subline: {
    fontSize: 14,
    lineHeight: 20,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  levelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  levelPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  levelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  levelCell: {
    flex: 1,
    minWidth: 64,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  levelIcon: {
    marginBottom: 4,
  },
  levelLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    gap: 8,
  },
  resumeRow: {
    paddingTop: 4,
    paddingBottom: 12,
    gap: 6,
  },
  resumeTitle: {
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0, // RN default adds padding that misaligns the row
  },
  classPickerWrap: {
    paddingTop: 4,
    paddingBottom: 8,
    gap: 6,
  },
  classPickerLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
  },
  clearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
    alignSelf: 'flex-start',
  },
  clearText: {
    fontSize: 12,
    lineHeight: 16,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  list: {
    gap: 12,
  },
  stateBlock: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 32,
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
  refreshBtn: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
