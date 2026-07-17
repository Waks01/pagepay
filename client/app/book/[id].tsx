import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PLATFORM_ENV } from '@/src/shared/lib/ads';
import { NativeAdBanner } from '@/components/ads/NativeAdBanner';
import { AttributionCard } from '@/components/AttributionCard';
import { SocialBar } from '@/components/SocialBar';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { SkeletonDetailPage } from '@/components/skeletons';
import { useWorkSocial, useLogWorkShare } from '@/src/features/works/hooks/use-works';

type SliceSummary = {
  id: number;
  title: string;
  read_order: number;
  total_slices: number;
  estimated_read_minutes: number;
};

type BookDetail = {
  id: number;
  title: string;
  author: string | null;
  category: string;
  estimated_read_minutes: number;
  content_type: string;
  is_sliced: boolean;
  slices: SliceSummary[];
  // Education + attribution fields, populated on OpenStax content.
  source: string | null;
  education_level: string | null;
  subject: string | null;
  license_type: string | null;
  attribution_text: string | null;
};

type ResumeState = {
  work_id: number;
  current_slice_id: number | null;
  slices_completed: number;
  total_slices: number;
  percent_complete: number;
  is_finished: boolean;
};

/**
 * Book detail screen — shows the work's title, total minutes, and the
 * ordered list of 1-minute sessions (slices). Sessions the user hasn't
 * unlocked yet are visible but visually locked. Tapping a locked card
 * shows a hint rather than navigating.
 *
 * Lock model:
 *   - `currentSliceId` is the user's "next read" — the unlock frontier.
 *   - Any slice whose `id` is in `unlockedIds` is tappable.
 *   - All others show a lock icon and an explanatory line.
 *   - When the user finishes a slice in the reader, the next slice's id
 *     becomes `currentSliceId`, so the lock state naturally advances.
 *
 * We compute `unlockedIds` from the resume state, not from a fixed list,
 * because the user can be anywhere in the book depending on history.
 */
export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { t } = useTranslation();

  const workId = Number(id);

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

  const bookQuery = useQuery({
    queryKey: ['book', workId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/content/works/${workId}`);
      if (!res.ok) throw new Error('Failed to load book');
      return (await res.json()) as BookDetail;
    },
  });

  const resumeQuery = useQuery({
    queryKey: ['book', workId, 'resume'],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/content/works/${workId}/resume`);
      if (!res.ok) throw new Error('Failed to load resume');
      return (await res.json()) as ResumeState;
    },
    retry: false, // 401 for anonymous users — handle in render
  });

  // Re-fetch progress when the user returns from the reader (router.back()).
  // Without this, the stale resumeQuery would keep the next slice locked.
  useFocusEffect(
    useCallback(() => {
      resumeQuery.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Compute the set of unlocked slice ids. The current slice is always
  const unlockedIds = useMemo(() => {
    const book = bookQuery.data;
    const resume = resumeQuery.data;
    if (!book) return new Set<number>();
    if (!resume) {
      // No resume state → user is brand new to this book. First slice
      // unlocked, rest locked.
      return new Set(book.slices.slice(0, 1).map((s) => s.id));
    }
    if (resume.is_finished) {
      // Whole book is done — every slice is unlocked but tap shows
      // "Already completed" copy.
      return new Set(book.slices.map((s) => s.id));
    }
    // Current slice is unlocked; everything before it by read_order
    // is also unlocked. Everything after is locked.
    const currentSlice = book.slices.find((s) => s.id === resume.current_slice_id);
    const frontier = currentSlice?.read_order ?? 1;
    return new Set(
      book.slices.filter((s) => s.read_order <= frontier).map((s) => s.id),
    );
  }, [bookQuery.data, resumeQuery.data]);

  const onSlicePress = (slice: SliceSummary) => {
    if (!unlockedIds.has(slice.id)) return;
    router.push(`/reader/${slice.id}`);
  };

  const onRefreshAll = async () => {
    await Promise.all([bookQuery.refetch(), resumeQuery.refetch()]);
  };

  const loading = bookQuery.isLoading;
  const errored = bookQuery.isError;

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: tokens.paper }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('book_detail.go_back')}
          hitSlop={8}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={tokens.ink} />
        </TouchableOpacity>
        <Text
          style={[styles.headerTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
          numberOfLines={1}
        >
          {bookQuery.data?.title ?? t('book_detail.book_title')}
        </Text>
        <View style={styles.headerRight} />
      </View>

      {loading ? (
        <SkeletonDetailPage />
      ) : errored ? (
        <View style={[styles.stateBlock, { borderColor: tokens.signal }]}>
          <Ionicons name="cloud-offline-outline" size={20} color={tokens.signal} />
          <Text style={[styles.stateText, { color: tokens.signal }]}>
            {t('book_detail.load_error')}
          </Text>
          <TouchableOpacity
            onPress={onRefreshAll}
            style={[styles.retry, { borderColor: tokens.signal }]}
          >
            <Text style={[styles.retryText, { color: tokens.signal }]}>{t('book_detail.try_again')}</Text>
          </TouchableOpacity>
        </View>
      ) : bookQuery.data ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={undefined}
        >
          {/* Title block */}
          <View style={styles.titleBlock}>
            <Text
              style={[styles.category, { color: tokens.mint, fontFamily: 'SpaceGrotesk_500Medium' }]}
            >
              {t('book_detail.reading_category')}
            </Text>
            <Text
              style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}
            >
              {bookQuery.data.title}
            </Text>
            {bookQuery.data.author ? (
              <Text style={[styles.author, { color: tokens.inkMuted }]}>
                {bookQuery.data.author}
              </Text>
            ) : null}
            <View style={styles.metaRow}>
              <View style={[styles.metaPill, { borderColor: tokens.border }]}>
                <Ionicons name="time-outline" size={14} color={tokens.inkMuted} />
                <Text style={[styles.metaText, { color: tokens.inkMuted }]}>
                  {t('book_detail.min_total', { minutes: bookQuery.data.estimated_read_minutes })}
                </Text>
              </View>
              <View style={[styles.metaPill, { borderColor: tokens.border }]}>
                <Ionicons name="layers-outline" size={14} color={tokens.inkMuted} />
                <Text style={[styles.metaText, { color: tokens.inkMuted }]}>
                  {t(`book_detail.session_${bookQuery.data.slices.length === 1 ? 'one' : 'other'}`, { count: bookQuery.data.slices.length })}
                </Text>
              </View>
            </View>
          </View>

          {/* Slice list */}
          <View style={styles.listHeader}>
            <Text
              style={[
                styles.listTitle,
                { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' },
              ]}
            >
              {t('book_detail.sessions_title')}
            </Text>
            <Text style={[styles.listHint, { color: tokens.inkMuted }]}>
              {t('book_detail.sessions_hint')}
            </Text>
          </View>

          {bookQuery.data.slices.map((slice, idx) => {
            const unlocked = unlockedIds.has(slice.id);
            const completed =
              resumeQuery.data?.is_finished ||
              (resumeQuery.data?.slices_completed ?? 0) >= slice.read_order;
            const isCurrent =
              !resumeQuery.data?.is_finished &&
              resumeQuery.data?.current_slice_id === slice.id;
            
            // Show native ad every 4th slice
            const shouldShowAd = (idx + 1) % 4 === 0 && nativeAdUnit;

            return (
              <View key={`slice-${slice.id}`}>
                <TouchableOpacity
                  activeOpacity={unlocked ? 0.7 : 1}
                  disabled={!unlocked}
                  onPress={() => onSlicePress(slice)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    unlocked
                      ? t(`book_detail.session_label${slice.estimated_read_minutes === 1 ? '' : '_plural'}`, {
                          order: slice.read_order,
                          total: slice.total_slices,
                          minutes: slice.estimated_read_minutes
                        })
                      : t('book_detail.locked_session', { order: slice.read_order })
                  }
                  style={[
                    styles.sliceCard,
                    {
                      backgroundColor: unlocked ? tokens.card : tokens.mintSoft,
                      borderColor: isCurrent ? tokens.mint : tokens.border,
                      borderWidth: isCurrent ? 2 : 1,
                    },
                  ]}
                >
                  <View style={styles.sliceRow}>
                    <View
                      style={[
                        styles.sliceIndex,
                        {
                          backgroundColor: unlocked ? tokens.mint : tokens.border,
                        },
                      ]}
                    >
                      {completed ? (
                        <Ionicons name="checkmark" size={14} color="#fff" />
                      ) : unlocked ? (
                        <Text style={styles.sliceIndexText}>{slice.read_order}</Text>
                      ) : (
                        <Ionicons name="lock-closed" size={12} color={tokens.inkMuted} />
                      )}
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.sliceTitle,
                          {
                            color: unlocked ? tokens.ink : tokens.inkMuted,
                            fontFamily: unlocked ? 'SpaceGrotesk_700Bold' : undefined,
                          },
                        ]}
                      >
                        {slice.title}
                      </Text>
                      <Text
                        style={[
                          styles.sliceSub,
                          { color: tokens.inkMuted },
                        ]}
                      >
                        {unlocked
                          ? `${t('book_detail.min_read', { minutes: slice.estimated_read_minutes })} · ${t('book_detail.session_of', { order: slice.read_order, total: slice.total_slices })}`
                          : isCurrent
                          ? t('book_detail.continue_here')
                          : t('book_detail.unlocks_after', { order: Math.max(1, slice.read_order - 1) })}
                      </Text>
                    </View>

                    {unlocked ? (
                      <Ionicons name="chevron-forward" size={18} color={tokens.mint} />
                    ) : null}
                  </View>
                </TouchableOpacity>
                
                {shouldShowAd && (
                  <NativeAdBanner
                    adUnit={nativeAdUnit}
                    sessionId={null}
                  />
                )}
              </View>
            );
          })}

          <View style={{ height: 24 }} />
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  headerRight: { width: 36 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
    gap: 16,
  },
  stateBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  stateText: { fontSize: 14, textAlign: 'center' },
  retry: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  retryText: { fontSize: 13, fontWeight: '600' },
  titleBlock: { gap: 6, marginBottom: 8 },
  category: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  author: {
    fontSize: 14,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  metaText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  listHeader: {
    gap: 2,
    marginTop: 8,
  },
  listTitle: {
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  listHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  sliceCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  sliceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sliceIndex: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliceIndexText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  sliceTitle: {
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  sliceSub: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});