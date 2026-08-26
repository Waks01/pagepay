import { useCallback, useMemo, useState, useEffect } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import { apiFetch } from "@/src/shared/api/client";
import { fetchDailyRewardStatus } from "@/src/features/rewards/api";
import { useCatalogFilter } from "@/src/shared/lib/catalog-filter";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { useAdsConfig } from "@/src/shared/hooks/use-ads-config";
import {
  useCurrentUser,
  useCurrentUserStore,
} from "@/src/shared/lib/current-user";
import { useStreak } from "@/src/features/community/hooks/use-community";
import { displayName } from "@/src/shared/lib/display-name";
import { formatPointsCompact, POINTS_PER_NAIRA_VALUE } from "@/src/shared/lib/money";
import { CategoryChip } from "@/components/CategoryChip";
import { ContentCard, ContentItem } from "@/components/ContentCard";
import { ResumeCard } from "@/components/ResumeCard";
import { VTUServiceCard } from "@/components/VTUServiceCard";
import { UserAvatar } from "@/components/UserAvatar";
import NotificationBell from "@/components/NotificationBell";
import { NativeAdBanner } from "@/components/ads/NativeAdBanner";
import { PagePay } from "@/constants/theme";
import { SkeletonPage } from "@/components/skeletons";
import { StateBlock } from "@/components/StateBlock";

const CATEGORIES = ["Fiction", "Classics", "News", "Study"] as const;

export default function HomeScreen() {
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { t } = useTranslation();

  const setCatalogCategory = useCatalogFilter((s) => s.setCategory);

  // Read the current user from the global store — loaded once at
  // app start by the auth gate. No per-screen /me fetch, no loading
  // state, no re-auth on tab switch.
  const user = useCurrentUser();

  // Fetch ad config for native unit. useAdsConfig has its own
  // 1-hour staleTime and the same queryKey as the AdSlotProvider
  // and the catalog tab — the data is fetched once and reused.
  const [nativeAdUnit, setNativeAdUnit] = useState("");
  const { data: adConfig } = useAdsConfig();

  useEffect(() => {
    if (adConfig) {
      const platform = Platform.OS;
      const unitKey =
        platform === "android" ? "in_feed_android" : "in_feed_ios";
      setNativeAdUnit(adConfig[unitKey] || "");
    }
  }, [adConfig]);

  // The feed query uses the cached user id from the store. If the
  // store hasn't populated yet (shouldn't happen — auth gate loads
  // it before the (app) group mounts), we fall back to 0 (anonymous)
  // so the screen still paints instead of blocking.
  const feedQuery = useQuery({
    queryKey: ["feed", "featured", user?.id ?? 0],
    queryFn: async () => {
      // Phase 2: use the feed endpoint so the featured strip
      // includes the same per-user sponsored rotation the
      // catalog tab does. Anonymous users fall back to id=0
      // (the server treats 0 as a stable anonymous bucket).
      const userId = user?.id ?? 0;
      const res = await apiFetch(`/api/v1/content/feed/${userId}?limit=10`);
      if (!res.ok) throw new Error("Failed to load feed");
      return (await res.json()) as ContentItem[];
    },
  });

  const streakQuery = useStreak();

  const dailyRewardsQuery = useQuery({
    queryKey: ["daily-reward-status"],
    queryFn: fetchDailyRewardStatus,
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  const onCategoryPress = useCallback(
    (category: string) => {
      setCatalogCategory(category);
      router.push("/catalog");
    },
    [router, setCatalogCategory],
  );

  const onCardPress = useCallback(
    (id: number) => {
      router.push(`/catalog/book/${id}` as never);
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
    progress: number; // 0..1
    minutesLeft: number;
  };

  const inProgressQuery = useQuery({
    queryKey: ["progress", "in-progress"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/progress");
      if (!res.ok) throw new Error("Failed to load in-progress works");
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
      await Promise.all([
        useCurrentUserStore.getState().refresh(),
        feedQuery.refetch(),
        inProgressQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [feedQuery, inProgressQuery]);

  useFocusEffect(
    useCallback(() => {
      void useCurrentUserStore.getState().refresh();
    }, [])
  );

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return t("home.greeting_still_up");
    if (h < 12) return t("home.greeting_morning");
    if (h < 17) return t("home.greeting_afternoon");
    if (h < 21) return t("home.greeting_evening");
    return t("home.greeting_night");
  }, [t]);

  const serviceCreditPoints = user?.service_credit_balance ?? 0;
  const cashableNaira = (user?.cashable_balance ?? 0) / POINTS_PER_NAIRA_VALUE;
  const items = feedQuery.data ?? [];
  const streakData = streakQuery.data as { current_streak: number } | undefined;

  const inProgressError = inProgressQuery.isError;

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.root, { backgroundColor: tokens.paper }]}
    >
      <View style={styles.header}>
        {/* Row 1: avatar + daily rewards + points + bell */}
        <View style={styles.iconsRow}>
          <UserAvatar size={32} />

          {/* Daily Rewards Button - shows streak if active, otherwise gift icon */}
          <TouchableOpacity
            onPress={() => router.push("/rewards/daily")}
            style={[
              streakData && streakData.current_streak > 0
                ? styles.streakBadge
                : styles.rewardsButton,
              streakData && streakData.current_streak > 0
                ? { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }
                : { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            {streakData && streakData.current_streak > 0 ? (
              <>
                <Text style={styles.streakEmoji}>🔥</Text>
                <Text style={[styles.streakText, { color: tokens.mint }]}>
                  {streakData.current_streak}d
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.rewardsEmoji}>🎁</Text>
                {dailyRewardsQuery.data?.can_claim_today && (
                  <View
                    style={[
                      styles.rewardsBadge,
                      { backgroundColor: tokens.accent },
                    ]}
                  />
                )}
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push("/wallet")}
            accessibilityRole="button"
            accessibilityLabel={t("home.wallet_access", { sp: serviceCreditPoints, cash: cashableNaira.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) })}
            style={[
              styles.balanceChip,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
            activeOpacity={0.7}
          >
            <View
              style={[styles.balanceDot, { backgroundColor: tokens.mint }]}
            />
            <Text
              style={[
                styles.balanceAmountCompact,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
              numberOfLines={1}
            >
              {formatPointsCompact(serviceCreditPoints)} SP
            </Text>
            <Text style={[styles.balanceSeparator, { color: tokens.inkMuted }]}>
              ·
            </Text>
            <Text
              style={[
                styles.balanceAmountCompact,
                { color: tokens.mint, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
              numberOfLines={1}
            >
              ₦{cashableNaira.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} C
            </Text>
          </TouchableOpacity>

          <NotificationBell />
        </View>

        {/* Row 2: greeting + username */}
        <View style={styles.greetingRow}>
          <Text
            style={[
              styles.greeting,
              { color: tokens.inkMuted, fontFamily: "SpaceGrotesk_500Medium" },
            ]}
          >
            {greeting},
          </Text>
          <Text
            style={[
              styles.greeting,
              { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
            ]}
          >
            {user?.username || displayName(user)}
          </Text>
        </View>
      </View>

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
        {/* Resume slot */}
        {inProgressQuery.isLoading ? (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {t("home.keep_reading")}
            </Text>
            <View style={{ height: 140 }} />
          </View>
        ) : inProgressQuery.isError ? (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {t("home.keep_reading")}
            </Text>
            <StateBlock
              message={t("home.feed_error")}
              onRetry={() => inProgressQuery.refetch()}
              tokens={tokens}
            />
          </View>
        ) : resumes.length > 0 ? (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {t("home.keep_reading")}
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
                        ? (`/catalog/reader/${r.sliceId}` as never)
                        : (`/catalog/book/${r.workId}` as never),
                    )
                  }
                />
              ))}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {t("home.keep_reading")}
            </Text>
            <StateBlock
              message={t("home.empty_feed")}
              tokens={tokens}
              variant="empty"
            />
          </View>
        )}

        {/* VTU Services Carousel */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text
              style={[
                styles.sectionTitle,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {t("home.services_carousel")}
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/wallet")}
              hitSlop={6}
              accessibilityRole="link"
            >
              <Text style={[styles.seeAll, { color: tokens.mint }]}>
                {t("home.services_carousel_action")}
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 16 }}
            decelerationRate="fast"
            snapToInterval={140 + 12}
            snapToAlignment="start"
          >
            <VTUServiceCard
              icon="phone-portrait-outline"
              label={t("wallet.services.airtime")}
              earn="3%"
              onPress={() => router.push("/home/buy-airtime")}
            />
            <VTUServiceCard
              icon="wifi-outline"
              label={t("wallet.services.data")}
              earn="4%"
              onPress={() => router.push("/home/buy-data")}
            />
            <VTUServiceCard
              icon="flash-outline"
              label={t("wallet.services.electricity")}
              earn="1%"
              onPress={() => router.push("/home/buy-electricity")}
            />
            <VTUServiceCard
              icon="tv-outline"
              label={t("wallet.services.tv")}
              earn="1.5%"
              onPress={() => router.push("/home/buy-tv")}
            />
            <VTUServiceCard
              icon="card-outline"
              label={t("wallet.services.recharge_pin")}
              earn="2%"
              onPress={() => router.push("/home/buy-recharge-pin")}
            />
            <VTUServiceCard
              icon="logo-bitcoin"
              label={t("wallet.services.betting")}
              earn="2%"
              onPress={() => router.push("/home/buy-betting")}
            />
            <VTUServiceCard
              icon="wifi-outline"
              label={t("wallet.services.isp")}
              earn="3%"
              onPress={() => router.push("/home/buy-isp")}
            />
            <VTUServiceCard
              icon="school-outline"
              label={t("wallet.services.education")}
              earn="2%"
              onPress={() => router.push("/home/buy-education")}
            />
            <VTUServiceCard
              icon="send-outline"
              label={t("wallet.services.sms")}
              earn="1%"
              onPress={() => router.push("/home/buy-sms")}
            />
          </ScrollView>
        </View>

        {/* Transaction History Quick Access */}
        <TouchableOpacity
          onPress={() => router.push("/home/transactions")}
          style={[
            styles.transactionCard,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
          activeOpacity={0.7}
        >
          <View style={styles.transactionLeft}>
            <View
              style={[
                styles.transactionIcon,
                { backgroundColor: tokens.mintSoft },
              ]}
            >
              <Ionicons name="receipt-outline" size={22} color={tokens.mint} />
            </View>
            <View style={styles.transactionText}>
              <Text
                style={[
                  styles.transactionTitle,
                  { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
                ]}
              >
                {t("home.transaction_history")}
              </Text>
              <Text
                style={[styles.transactionSubtitle, { color: tokens.inkMuted }]}
              >
                {t("home.transaction_history_subtitle")}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={tokens.inkMuted} />
        </TouchableOpacity>

        {/* Browse by category */}
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
            ]}
          >
            {t("home.browse")}
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
              style={[
                styles.sectionTitle,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {t("home.trending")}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setCatalogCategory(null);
                router.push("/catalog");
              }}
              hitSlop={6}
              accessibilityRole="link"
              accessibilityLabel={t("home.see_all_catalog", {
                defaultValue: "See all content in catalog",
              })}
            >
              <Text style={[styles.seeAll, { color: tokens.mint }]}>
                {t("home.see_all")}
              </Text>
            </TouchableOpacity>
          </View>

          {feedQuery.isLoading && items.length === 0 ? (
            <SkeletonPage count={2} header={false} />
          ) : feedQuery.isError ? (
            <StateBlock
              message={t("home.feed_error")}
              onRetry={() => feedQuery.refetch()}
              tokens={tokens}
            />
          ) : items.length === 0 ? (
            <StateBlock
              message={t("home.empty_feed")}
              tokens={tokens}
              variant="empty"
            />
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
                      <NativeAdBanner adUnit={nativeAdUnit} sessionId={null} />
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
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 24,
  },
  iconsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  greetingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginTop: 10,
  },
  greeting: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
  },
  username: {
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  balanceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  balanceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  balanceAmountCompact: {
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: -0.2,
  },
  balanceSeparator: {
    fontSize: 12,
    lineHeight: 14,
    marginHorizontal: 2,
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
    textTransform: "uppercase",
  },
  section: {
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  seeAll: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  feed: {
    gap: 12,
  },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
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
    fontWeight: "700",
  },
  rewardsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  rewardsEmoji: {
    fontSize: 16,
  },
  rewardsBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  vtuCard: {
    width: 140,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  vtuIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  vtuName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
  },
  vtuEarn: {
    fontSize: 11,
    fontWeight: "700",
    color: "#059669",
    backgroundColor: "#f0fdf4",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  transactionCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  transactionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  transactionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  transactionText: {
    flex: 1,
    gap: 4,
  },
  transactionTitle: {
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  transactionSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
