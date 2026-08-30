/**
 * Daily Rewards Screen - 30 Day implementation
 * Matches daily-rewards-design3.html with PagePay theme tokens
 */

import { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Dimensions,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Svg, Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as Notifications from "expo-notifications";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { getDeviceFingerprint } from "@/src/shared/lib/device-fingerprint";

import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { useCurrentUser } from "@/src/shared/lib/current-user";
import { StateBlock } from "@/components/StateBlock";
import { Skeleton } from "@/components/Skeleton";
import { PagePaySpinner } from "@/components/PagePaySpinner";
import {
  fetchDailyRewardStatus,
  claimDailyReward,
  fetchDailyRewardConfig,
  freezeStreakByPoints,
  DailyRewardStatus,
  DailyRewardInfo,
} from "@/src/features/rewards/api";

const { width } = Dimensions.get("window");
const RING_SIZE = 160;
const RING_RADIUS = 70;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function AnimatedFireEmoji() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const translateY = -progress.value * 6;
    return {
      transform: [{ translateY }],
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      <Text style={{ fontSize: 40, marginBottom: 4 }}>🔥</Text>
    </Animated.View>
  );
}

export default function DailyRewardsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const queryClient = useQueryClient();
  const [claimingReward, setClaimingReward] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const user = useCurrentUser();

  useEffect(() => {
    getDeviceFingerprint()
      .then(setDeviceId)
      .catch(() => setDeviceId(null));
  }, []);

  const {
    data: rewardStatus,
    isLoading,
    error,
    refetch,
  } = useQuery<DailyRewardStatus>({
    queryKey: ["daily-reward-status"],
    queryFn: fetchDailyRewardStatus,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });

  const { data: rewardConfig = [] } = useQuery({
    queryKey: ["daily-reward-config"],
    queryFn: fetchDailyRewardConfig,
    staleTime: 60 * 60 * 1000,
  });

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ["daily-reward-config"] });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (error) {
      console.error("[DailyRewards] status error:", error);
    }
  }, [error]);

  const claimMutation = useMutation({
    mutationFn: ({ deviceId }: { deviceId?: string }) =>
      claimDailyReward(deviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-reward-status"] });
      setShowClaimModal(false);
      console.log("[DailyRewards] Claim successful, invalidating status query");
      Notifications.scheduleNotificationAsync({
        content: {
          title: t("daily_rewards.notification_title"),
          body: t("daily_rewards.notification_body"),
        },
        trigger: null,
      }).catch((error) => {
        console.error("[DailyRewards] Failed to schedule notification:", error);
      });
    },
    onError: (error: Error) => {
      console.error("Daily reward claim error:", error.message);
    },
  });

const freezeByPointsMutation = useMutation({
    mutationFn: (deviceId?: string) => freezeStreakByPoints(deviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-reward-status"] });
    },
    onError: (error: Error) => {
      console.error("Streak freeze by points error:", error.message);
    },
  });

  const handleClaimReward = async () => {
    if (!rewardStatus?.can_claim_today) return;
    setClaimingReward(true);
    try {
      await claimMutation.mutateAsync({ deviceId: deviceId || undefined });
    } finally {
      setClaimingReward(false);
    }
  };

  const currentStreak = rewardStatus?.current_streak || 0;
  const todayReward = rewardStatus?.todays_reward;
  const canClaim = rewardStatus?.can_claim_today;
  const rewards = rewardConfig.length > 0 ? rewardConfig : [];

  // Streak is considered broken when streak is 0 and user hasn't claimed today
  // (meaning they missed yesterday and lost their streak)
  const streakBroken =
    !rewardStatus?.can_claim_today &&
    currentStreak === 0 &&
    !!rewardStatus?.last_claim_date;

const handleFreezeByPoints = async () => {
    await freezeByPointsMutation.mutateAsync(deviceId || undefined);
  };

  // Debug: Log to ensure we're using the correct streak
  useEffect(() => {
    if (rewardStatus) {
      console.log(
        "[DailyRewards] Reward streak:",
        currentStreak,
        "Can claim:",
        canClaim,
        "Next day:",
        currentStreak + 1,
      );
    }
  }, [rewardStatus, currentStreak, canClaim]);

  const weekProgress = useMemo(() => {
    const currentDayInWeek = currentStreak % 7 || 7;
    return currentDayInWeek / 7;
  }, [currentStreak]);

  const strokeDashOffset = RING_CIRCUMFERENCE * (1 - weekProgress);

  const MILESTONE_DAYS = new Set<number>([7, 14, 21, 30, 60, 100, 365]);

  const fallbackRewards: Record<
    number,
    {
      icon_emoji: string;
      reward_type: string;
      reward_value: number;
      title: string;
    }
  > = {
    1: {
      icon_emoji: "🎯",
      reward_type: "points",
      reward_value: 50,
      title: "Welcome Back!",
    },
    2: {
      icon_emoji: "⚡",
      reward_type: "points",
      reward_value: 50,
      title: "Getting Started",
    },
    3: {
      icon_emoji: "🚀",
      reward_type: "points",
      reward_value: 50,
      title: "On a Roll",
    },
    4: {
      icon_emoji: "💪",
      reward_type: "points",
      reward_value: 50,
      title: "Consistency Pays",
    },
    5: {
      icon_emoji: "🔥",
      reward_type: "points",
      reward_value: 50,
      title: "Dedication",
    },
    6: {
      icon_emoji: "⭐",
      reward_type: "points",
      reward_value: 50,
      title: "Almost There",
    },
    7: {
      icon_emoji: "🏆",
      reward_type: "points",
      reward_value: 200,
      title: "Week Warrior",
    },
    8: {
      icon_emoji: "🎯",
      reward_type: "points",
      reward_value: 50,
      title: "Day 8",
    },
    9: {
      icon_emoji: "⚡",
      reward_type: "points",
      reward_value: 50,
      title: "Day 9",
    },
    10: {
      icon_emoji: "🚀",
      reward_type: "points",
      reward_value: 50,
      title: "Day 10",
    },
    11: {
      icon_emoji: "💪",
      reward_type: "points",
      reward_value: 50,
      title: "Day 11",
    },
    12: {
      icon_emoji: "🔥",
      reward_type: "points",
      reward_value: 50,
      title: "Day 12",
    },
    13: {
      icon_emoji: "⭐",
      reward_type: "points",
      reward_value: 50,
      title: "Day 13",
    },
    14: {
      icon_emoji: "🛡️",
      reward_type: "points",
      reward_value: 350,
      title: "Two Week Champion",
    },
    15: {
      icon_emoji: "🎯",
      reward_type: "points",
      reward_value: 50,
      title: "Day 15",
    },
    16: {
      icon_emoji: "⚡",
      reward_type: "points",
      reward_value: 50,
      title: "Day 16",
    },
    17: {
      icon_emoji: "🚀",
      reward_type: "points",
      reward_value: 50,
      title: "Day 17",
    },
    18: {
      icon_emoji: "💪",
      reward_type: "points",
      reward_value: 50,
      title: "Day 18",
    },
    19: {
      icon_emoji: "🔥",
      reward_type: "points",
      reward_value: 50,
      title: "Day 19",
    },
    20: {
      icon_emoji: "⭐",
      reward_type: "points",
      reward_value: 50,
      title: "Day 20",
    },
    21: {
      icon_emoji: "👑",
      reward_type: "points",
      reward_value: 500,
      title: "Three Week Legend",
    },
    22: {
      icon_emoji: "🎯",
      reward_type: "points",
      reward_value: 50,
      title: "Day 22",
    },
    23: {
      icon_emoji: "⚡",
      reward_type: "points",
      reward_value: 50,
      title: "Day 23",
    },
    24: {
      icon_emoji: "🚀",
      reward_type: "points",
      reward_value: 50,
      title: "Day 24",
    },
    25: {
      icon_emoji: "💪",
      reward_type: "points",
      reward_value: 50,
      title: "Day 25",
    },
    26: {
      icon_emoji: "🔥",
      reward_type: "points",
      reward_value: 50,
      title: "Day 26",
    },
    27: {
      icon_emoji: "⭐",
      reward_type: "points",
      reward_value: 50,
      title: "Day 27",
    },
    28: {
      icon_emoji: "🎯",
      reward_type: "points",
      reward_value: 50,
      title: "Day 28",
    },
    29: {
      icon_emoji: "⚡",
      reward_type: "points",
      reward_value: 50,
      title: "Day 29",
    },
    30: {
      icon_emoji: "🏆",
      reward_type: "points",
      reward_value: 800,
      title: "Monthly Master",
    },
    60: {
      icon_emoji: "💍",
      reward_type: "points",
      reward_value: 1500,
      title: "Diamond Streak",
    },
    100: {
      icon_emoji: "🎖️",
      reward_type: "points",
      reward_value: 3000,
      title: "Centurion",
    },
    365: {
      icon_emoji: "👑",
      reward_type: "points",
      reward_value: 15000,
      title: "Yearly Legend",
    },
  };

  const getRewardForDay = (dayNumber: number): DailyRewardInfo | null => {
    // Source of truth: frontend fallback per reward-system-migration.md §5.
    // The backend DailyReward rows may still contain pre-migration values,
    // so we prefer the local §5 fallback for days 1-365 and only use API
    // data for days not covered by the fallback.
    const fallback = fallbackRewards[dayNumber];
    if (fallback) {
      const fallbackTitleKey = `daily_rewards.fallback_titles.day_${dayNumber}`;
      const fallbackTitle = t(fallbackTitleKey);
      return {
        id: dayNumber,
        day_number: dayNumber,
        reward_type: fallback.reward_type as "points" | "multiplier",
        reward_value: fallback.reward_value,
        title:
          fallbackTitle !== fallbackTitleKey ? fallbackTitle : fallback.title,
        description: "",
        icon_emoji: fallback.icon_emoji,
      };
    }

    const dbReward = rewards.find((r) => r.day_number === dayNumber) || null;
    if (dbReward) return dbReward;

    return null;
  };

  const allDays = useMemo(() => {
    const days = [];
    for (let day = 1; day <= 30; day++) {
      const reward = getRewardForDay(day);
      const isToday = day === currentStreak + 1;
      const isClaimed = day <= currentStreak;
      days.push({ dayNumber: day, reward, isToday, isClaimed });
    }
    return days;
  }, [rewards, currentStreak]);

  const getWeekNumber = (day: number) => Math.ceil(day / 7);
  const getWeekLabel = (weekNum: number) => {
    if (weekNum <= 4) return t("daily_rewards.week_n", { n: weekNum });
    return t("daily_rewards.month_completion");
  };

  const renderDayCard = (
    dayNumber: number,
    reward: DailyRewardInfo | null,
    isToday: boolean,
    isClaimed: boolean,
  ) => {
    const isFuture = dayNumber > currentStreak + 1;

    let cardBg = tokens.paper;
    let cardBorder = tokens.border;
    let dayNumberColor = tokens.inkMuted;
    let valueColor = tokens.mint;
    let emojiOpacity = 1;

    if (isClaimed) {
      cardBg = tokens.mint;
      cardBorder = tokens.mint;
      dayNumberColor = tokens.mintText;
      valueColor = tokens.mintText;
    } else if (isToday) {
      cardBg = tokens.gold;
      cardBorder = tokens.gold;
      dayNumberColor = tokens.mintText;
      valueColor = tokens.mintText;
    } else if (isFuture) {
      cardBg = tokens.paper;
      cardBorder = tokens.border;
      dayNumberColor = tokens.inkMuted;
      valueColor = tokens.borderStrong;
      emojiOpacity = 0.3;
    } else {
      cardBg = tokens.paper;
      cardBorder = tokens.mint;
      dayNumberColor = tokens.ink;
      valueColor = tokens.mint;
    }

    return (
      <View
        key={dayNumber}
        style={[
          styles.dayCard,
          {
            backgroundColor: cardBg,
            borderColor: cardBorder,
            shadowColor: isToday ? tokens.gold : tokens.mint,
            shadowOpacity: isToday ? 0.3 : 0.1,
            shadowRadius: isToday ? 12 : 4,
            elevation: isToday ? 8 : 2,
          },
        ]}
      >
        <Text style={[styles.dayNumber, { color: dayNumberColor }]}>
          {t("daily_rewards.day_label", { day: dayNumber })}
        </Text>

        {reward && (
          <>
            <Text style={[styles.dayEmoji, { opacity: emojiOpacity }]}>
              {reward.icon_emoji}
            </Text>
            <Text style={[styles.dayValue, { color: valueColor }]}>
              {reward.reward_type === "points"
                ? `+${reward.reward_value}`
                : `${reward.reward_value}%`}
            </Text>
          </>
        )}

        {isClaimed && (
          <View style={styles.checkBadge}>
            <Ionicons name="checkmark" size={12} color={tokens.mint} />
          </View>
        )}
      </View>
    );
  };

  const weeks = useMemo(() => {
    const grouped = [];
    for (let week = 1; week <= 5; week++) {
      const startDay = (week - 1) * 7 + 1;
      const endDay = week === 5 ? 30 : week * 7;
      const weekDays = allDays.filter(
        (d) => d.dayNumber >= startDay && d.dayNumber <= endDay,
      );
      grouped.push({
        weekNum: week,
        label: getWeekLabel(week),
        days: weekDays,
        startDay,
        endDay,
      });
    }
    return grouped;
  }, [allDays]);

  if (isLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: tokens.paper }]}
      >
        <View style={[styles.header, { borderBottomColor: tokens.border }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.ink }]}>
            {t("daily_rewards.title")}
          </Text>
          <View style={{ width: 24 }} />
        </View>

      <ScrollView
        contentContainerStyle={styles.contentContainer}
      >
          <View style={[styles.streakHero, { backgroundColor: tokens.paper }]}>
            <Skeleton
              width={RING_SIZE}
              height={RING_SIZE}
              borderRadius={RING_SIZE / 2}
            />
            <View style={{ marginTop: 16 }}>
              <Skeleton width={120} height={20} />
            </View>
          </View>

          <Skeleton
            width="100%"
            height={56}
            borderRadius={999}
            marginBottom={24}
          />

          {[...Array(5)].map((_, weekIdx) => (
            <View key={weekIdx} style={{ marginBottom: 24 }}>
              <Skeleton width={120} height={20} marginBottom={12} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View
                  style={{
                    flexDirection: "row",
                    gap: 12,
                    paddingHorizontal: 16,
                  }}
                >
                  {[...Array(7)].map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.dayCard,
                        {
                          width: 72,
                          height: 90,
                          backgroundColor: tokens.paper,
                          borderColor: tokens.border,
                        },
                      ]}
                    >
                      <Skeleton width={40} height={10} />
                      <View style={{ marginVertical: 6 }}>
                        <Skeleton width={32} height={32} />
                      </View>
                      <Skeleton width={40} height={12} />
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: tokens.paper }]}
      >
        <View style={[styles.header, { borderBottomColor: tokens.border }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.ink }]}>
            {t("daily_rewards.title")}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.content}>
          <StateBlock
            message={t("daily_rewards.load_failed")}
            onRetry={() => refetch()}
            tokens={tokens}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tokens.paper }]}>
      <ScrollView
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={tokens.mint}
            colors={[tokens.mint]}
            progressViewOffset={Platform.OS === "android" ? 0 : undefined}
          />
        }
        overScrollMode="always"
        nestedScrollEnabled={false}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: tokens.border }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.ink }]}>
            {t("daily_rewards.title")}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Streak Hero with Circular Progress */}
        <View style={styles.streakHero}>
          <View style={styles.progressRingContainer}>
            <Svg width={RING_SIZE} height={RING_SIZE}>
              <Defs>
                <LinearGradient
                  id="ringGradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <Stop offset="0%" stopColor={tokens.mint} stopOpacity="1" />
                  <Stop offset="100%" stopColor={tokens.mint} stopOpacity="1" />
                </LinearGradient>
              </Defs>
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                stroke={tokens.border}
                strokeWidth={8}
                fill="none"
              />
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                stroke="url(#ringGradient)"
                strokeWidth={8}
                fill="none"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={strokeDashOffset}
                strokeLinecap="round"
                rotation="-90"
                origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
              />
            </Svg>
            <View style={styles.progressCenter}>
              <AnimatedFireEmoji />
              <Text style={[styles.streakNumber, { color: tokens.ink }]}>
                {currentStreak}
              </Text>
              <Text style={[styles.streakLabel, { color: tokens.inkMuted }]}>
                {t("daily_rewards.day_streak")}
              </Text>
            </View>
          </View>
          <Text style={[styles.streakSubtitle, { color: tokens.inkMuted }]}>
            {currentStreak === 0
              ? t("daily_rewards.start_streak")
              : t("daily_rewards.on_fire", { days: 7 - (currentStreak % 7) })}
          </Text>
        </View>

        {/* Streak Recovery Banner - When streak is broken */}
        {streakBroken && (
          <View
            style={[
              styles.recoveryBanner,
              {
                backgroundColor: tokens.signalSoft,
                borderColor: tokens.signal,
              },
            ]}
          >
            <View style={styles.recoveryHeader}>
              <Ionicons name="warning" size={24} color={tokens.signal} />
              <View style={styles.recoveryHeaderText}>
                <Text style={[styles.recoveryTitle, { color: tokens.ink }]}>
                  {t("daily_rewards.streak_broken")}
                </Text>
                <Text
                  style={[styles.recoverySubtitle, { color: tokens.inkMuted }]}
                >
                  {t("daily_rewards.recovery_message")}
                </Text>
              </View>
            </View>

            <View style={styles.recoveryActions}>
              <TouchableOpacity
                style={[
                  styles.recoveryButton,
                  {
                    backgroundColor: tokens.gold,
                    opacity: freezeByPointsMutation.isPending ? 0.7 : 1,
                  },
                ]}
                onPress={handleFreezeByPoints}
                disabled={freezeByPointsMutation.isPending}
              >
                {freezeByPointsMutation.isPending ? (
                  <PagePaySpinner size={16} />
                ) : (
                  <Ionicons name="star" size={18} color={tokens.mintText} />
                )}
                <Text
                  style={[
                    styles.recoveryButtonText,
                    { color: tokens.mintText },
                  ]}
                >
                  {t("daily_rewards.recovery_spend_points")}
                </Text>
              </TouchableOpacity>
            </View>

            {freezeByPointsMutation.isError && (
              <View style={styles.recoveryError}>
                <Text
                  style={[styles.recoveryErrorText, { color: tokens.signal }]}
                >
                  {freezeByPointsMutation.error?.message ||
                    t("daily_rewards.recovery_failed")}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Claim Button - opens options modal */}
        {canClaim && todayReward && (
          <TouchableOpacity
            style={[
              styles.claimButton,
              {
                backgroundColor: tokens.mint,
                opacity: claimingReward ? 0.7 : 1,
              },
            ]}
            onPress={() => setShowClaimModal(true)}
            disabled={claimingReward}
            activeOpacity={0.9}
          >
            <Text style={styles.claimEmoji}>{todayReward.icon_emoji}</Text>
            <View style={styles.claimContent}>
              <Text style={[styles.claimTitle, { color: tokens.mintText }]}>
                {t("daily_rewards.claim_button")}
              </Text>
              <Text style={[styles.claimSubtitle, { color: tokens.mintText }]}>
                {t("daily_rewards.day_label", { day: currentStreak + 1 })} • +
                {todayReward.reward_value}{" "}
                {t("daily_rewards.reward_points")}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={tokens.mintText}
            />
          </TouchableOpacity>
        )}

        {/* Error Display */}
        {claimMutation.isError && (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: tokens.signalSoft,
                borderColor: tokens.signal,
              },
            ]}
          >
            <Ionicons name="alert-circle" size={20} color={tokens.signal} />
            <Text style={[styles.errorText, { color: tokens.signal }]}>
              {claimMutation.error?.message || t("daily_rewards.claim_failed")}
            </Text>
            <TouchableOpacity
              onPress={() => claimMutation.reset()}
              style={[styles.errorDismiss, { borderColor: tokens.signal }]}
            >
              <Ionicons name="close" size={16} color={tokens.signal} />
            </TouchableOpacity>
          </View>
        )}

        {/* Week Sections */}
        {weeks.map((week) => (
          <View key={week.weekNum} style={styles.weekSection}>
            <View style={styles.weekHeader}>
              <Text style={[styles.weekTitle, { color: tokens.ink }]}>
                {week.label}
              </Text>
              <View
                style={[
                  styles.weekBadge,
                  {
                    backgroundColor: tokens.border,
                    borderColor: tokens.borderStrong,
                  },
                ]}
              >
                <Text
                  style={[styles.weekBadgeText, { color: tokens.inkMuted }]}
                >
                  {week.weekNum === 1
                    ? currentStreak >= 7
                      ? t("daily_rewards.completed")
                      : t("daily_rewards.in_progress")
                    : t("daily_rewards.locked")}
                </Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayScrollContent}
            >
              {week.days.map(({ dayNumber, reward, isToday, isClaimed }) =>
                renderDayCard(dayNumber, reward, isToday, isClaimed),
              )}
            </ScrollView>
          </View>
        ))}

        {/* Section Divider */}
        <View
          style={[
            styles.sectionDivider,
            { backgroundColor: tokens.borderStrong },
          ]}
        />

        {/* Milestones Timeline */}
        <View style={styles.milestonesSection}>
          <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
            {t("daily_rewards.milestones")}
          </Text>

          {rewardStatus?.ladder &&
            rewardStatus.ladder
              .filter((milestone) => milestone.day > currentStreak)
              .slice(0, 3)
              .map((milestone) => {
                const daysToGo = milestone.day - currentStreak;
                const milestoneEmoji = milestone.celebration_component || "🎯";

                return (
                  <View
                    key={milestone.day}
                    style={[
                      styles.milestoneItem,
                      {
                        backgroundColor: tokens.paper,
                        borderLeftColor: tokens.mint,
                      },
                    ]}
                  >
                    <View style={styles.milestoneContent}>
                      <Text
                        style={[styles.milestoneTitle, { color: tokens.ink }]}
                      >
                        {t("daily_rewards.milestone_day_n", {
                          day: milestone.day,
                        })}
                      </Text>
                      <Text
                        style={[
                          styles.milestoneSubtitle,
                          { color: tokens.inkMuted },
                        ]}
                      >
                        {t("daily_rewards.milestone_reward", {
                          reward: milestone.reward_sv,
                        })}
                      </Text>
                      <Text
                        style={[
                          styles.milestoneProgress,
                          { color: tokens.mint },
                        ]}
                      >
                        {t("daily_rewards.days_to_go", { days: daysToGo })}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.milestoneIcon,
                        { backgroundColor: tokens.border },
                      ]}
                    >
                      <Text style={styles.milestoneIconEmoji}>
                        {milestoneEmoji}
                      </Text>
                    </View>
                  </View>
                );
              })}
        </View>
      </ScrollView>

      {/* Claim Options Modal - outside ScrollView so it overlays correctly */}
      {showClaimModal && todayReward && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: tokens.card }]}>
            <Text style={[styles.modalTitle, { color: tokens.ink }]}>
              {t("daily_rewards.claim_options_title", { defaultValue: "Claim Reward" })}
            </Text>
            <Text style={[styles.modalSubtitle, { color: tokens.inkMuted }]}>
              {t("daily_rewards.claim_options_subtitle", { defaultValue: "Choose how to claim your daily reward" })}
            </Text>

            <TouchableOpacity
              style={[
                styles.claimOptionButton,
                { backgroundColor: tokens.mint, borderColor: tokens.mint },
              ]}
              onPress={() => claimMutation.mutate({ deviceId: deviceId || undefined })}
              disabled={claimingReward}
              activeOpacity={0.9}
            >
              <Text style={[styles.claimOptionTitle, { color: tokens.mintText }]}>
                {t("daily_rewards.claim_option_regular", { defaultValue: "Claim 50 SP" })}
              </Text>
              <Text style={[styles.claimOptionSubtitle, { color: tokens.mintText }]}>
                {t("daily_rewards.claim_option_regular_desc", { defaultValue: "Add to your balance" })}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowClaimModal(false)}
              style={{ padding: 12 }}
            >
              <Text style={[styles.cancelButton, { color: tokens.inkMuted }]}>
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}


    </SafeAreaView>
  );
}

const styles = {
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 80,
    gap: 24,
  },
  streakHero: {
    alignItems: "center",
    paddingVertical: 24,
  },
  progressRingContainer: {
    position: "relative",
    width: RING_SIZE,
    height: RING_SIZE,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  progressCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  streakNumber: {
    fontSize: 32,
    fontWeight: "800" as const,
    lineHeight: 36,
  },
  streakLabel: {
    fontSize: 13,
    fontWeight: "600" as const,
    marginTop: 2,
  },
  streakSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center" as const,
    paddingHorizontal: 24,
  },
  claimButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 999,
    gap: 14,
    marginBottom: 24,
  },
  claimEmoji: {
    fontSize: 28,
  },
  claimContent: {
    flex: 1,
  },
  claimTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    marginBottom: 2,
  },
  claimSubtitle: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  weekSection: {
    gap: 12,
    marginBottom: 24,
  },
  weekHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  weekTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
  },
  weekBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  weekBadgeText: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  dayScrollContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  dayScroll: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  dayCard: {
    width: 72,
    height: 90,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    position: "relative" as const,
    gap: 4,
  },
  dayNumber: {
    fontSize: 10,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  dayEmoji: {
    fontSize: 24,
    lineHeight: 24,
  },
  dayValue: {
    fontSize: 10,
    fontWeight: "700" as const,
    textAlign: "center" as const,
  },
  checkBadge: {
    position: "absolute" as const,
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  sectionDivider: {
    height: 1,
    marginVertical: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    marginBottom: 16,
  },
  milestonesSection: {
    gap: 12,
  },
  milestoneItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 16,
    borderRadius: 16,
    borderLeftWidth: 4,
    gap: 14,
  },
  milestoneContent: {
    flex: 1,
  },
  milestoneTitle: {
    fontSize: 15,
    fontWeight: "700" as const,
    marginBottom: 4,
  },
  milestoneSubtitle: {
    fontSize: 13,
    marginBottom: 6,
  },
  milestoneProgress: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  milestoneIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  milestoneIconEmoji: {
    fontSize: 22,
  },
  errorCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500" as const,
    lineHeight: 20,
  },
  errorDismiss: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  recoveryBanner: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    marginBottom: 24,
    gap: 16,
  },
  recoveryHeader: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 12,
  },
  recoveryHeaderText: {
    flex: 1,
  },
  recoveryTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    marginBottom: 4,
  },
  recoverySubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  recoveryActions: {
    flexDirection: "row" as const,
    gap: 12,
  },
  recoveryButton: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
  },
  recoveryButtonText: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
  recoveryError: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.1)",
  },
  recoveryErrorText: {
    fontSize: 13,
    fontWeight: "500" as const,
    textAlign: "center" as const,
  },
  modalOverlay: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: 24,
    zIndex: 1000,
  },
  modalContent: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    padding: 24,
    gap: 16,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    textAlign: "center" as const,
  },
  modalSubtitle: {
    fontSize: 13,
    textAlign: "center" as const,
    lineHeight: 18,
  },
  claimOptionButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    gap: 12,
  },
  claimOptionTitle: {
    fontSize: 15,
    fontWeight: "700" as const,
  },
  claimOptionSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  cancelButton: {
    fontSize: 14,
    fontWeight: "600" as const,
    textAlign: "center" as const,
    paddingVertical: 8,
  },
};
