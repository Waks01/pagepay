/**
 * Daily Rewards Screen - Shows 7-day progression with claimable rewards
 */

import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { StateBlock } from "@/components/StateBlock";
import { Skeleton } from "@/components/Skeleton";
import {
  fetchDailyRewardStatus,
  claimDailyReward,
  fetchDailyRewardConfig,
  DailyRewardStatus,
  DailyRewardInfo,
} from "@/src/features/rewards/api";

const { width } = Dimensions.get("window");

export default function DailyRewardsScreen() {
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const queryClient = useQueryClient();
  const [claimingReward, setClaimingReward] = useState(false);

  const {
    data: rewardStatus,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["daily-reward-status"],
    queryFn: fetchDailyRewardStatus,
  });

  const { data: rewardConfig = [] } = useQuery({
    queryKey: ["daily-reward-config"],
    queryFn: fetchDailyRewardConfig,
  });

  const claimMutation = useMutation({
    mutationFn: claimDailyReward,
    onSuccess: (result) => {
      Alert.alert(
        "🎉 Reward Claimed!",
        `${result.reward_emoji} ${result.reward_title}\n+${result.points_earned} points`,
        [{ text: "Awesome!", onPress: () => {} }],
      );

      // Refresh reward status
      queryClient.invalidateQueries({ queryKey: ["daily-reward-status"] });
    },
    onError: (error: Error) => {
      Alert.alert("Claim Failed", error.message);
    },
  });

  const handleClaimReward = async () => {
    if (!rewardStatus?.can_claim_today) return;

    setClaimingReward(true);
    try {
      await claimMutation.mutateAsync();
    } catch (error) {
      // Error handled by mutation
    } finally {
      setClaimingReward(false);
    }
  };

  const renderDayCard = (
    dayNumber: number,
    reward: DailyRewardInfo | null,
    isToday: boolean,
    isClaimed: boolean,
  ) => {
    const isClaimable = isToday && rewardStatus?.can_claim_today && !isClaimed;
    const isPast = dayNumber < (rewardStatus?.current_streak || 0);
    const isFuture = dayNumber > (rewardStatus?.current_streak || 0) + 1;

    return (
      <View
        key={dayNumber}
        style={[
          styles.dayCard,
          {
            backgroundColor: isClaimable
              ? tokens.mint
              : isClaimed || isPast
                ? tokens.mint
                : isFuture
                  ? tokens.borderStrong
                  : tokens.paper,
            borderColor: isToday
              ? tokens.mint
              : isClaimed || isPast
                ? tokens.mint
                : tokens.border,
          },
        ]}
      >
        <Text
          style={[
            styles.dayNumber,
            { color: isClaimable ? "#FFFFFF" : tokens.ink },
          ]}
        >
          Day {dayNumber}
        </Text>

        {reward && (
          <>
            <Text style={[styles.rewardEmoji, { opacity: isFuture ? 0.5 : 1 }]}>
              {reward.icon_emoji}
            </Text>
            <Text
              style={[
                styles.rewardTitle,
                {
                  color: isClaimable ? "#FFFFFF" : tokens.ink,
                  opacity: isFuture ? 0.5 : 1,
                },
              ]}
            >
              {reward.title}
            </Text>
            <Text
              style={[
                styles.rewardValue,
                {
                  color: isClaimable
                    ? "#FFFFFF"
                    : reward.reward_type === "multiplier"
                      ? tokens.mint
                      : tokens.mint,
                  opacity: isFuture ? 0.5 : 1,
                },
              ]}
            >
              {reward.reward_type === "points"
                ? `+${reward.reward_value}`
                : `${reward.reward_value}%`}
            </Text>
          </>
        )}

        {(isClaimed || isPast) && (
          <View style={styles.completedBadge}>
            <Ionicons name="checkmark-circle" size={16} color={tokens.mint} />
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: tokens.paper }]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: tokens.border }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.ink }]}>
            Daily Rewards
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
        >
          {/* Streak Card Skeleton */}
          <View
            style={[
              styles.streakCard,
              { backgroundColor: tokens.paper, borderColor: tokens.border },
            ]}
          >
            <View style={styles.streakHeader}>
              <Skeleton width={40} height={40} />
              <View style={styles.streakInfo}>
                <Skeleton width={60} height={32} />
                <Skeleton width={80} height={16} />
              </View>
            </View>
            <Skeleton width="100%" height={16} />
          </View>

          {/* Claim Button Skeleton */}
          <View
            style={[
              styles.claimButton,
              { backgroundColor: tokens.borderStrong },
            ]}
          >
            <Skeleton width={40} height={40} />
            <View style={styles.claimButtonContent}>
              <Skeleton width={150} height={16} />
              <Skeleton width={200} height={14} />
            </View>
            <Skeleton width={24} height={24} />
          </View>

          {/* Progress Section Skeleton */}
          <View style={styles.progressSection}>
            <Skeleton width={140} height={20} />
            <View style={styles.dayGrid}>
              {[...Array(7)].map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.dayCard,
                    {
                      backgroundColor: tokens.paper,
                      borderColor: tokens.border,
                      width: (width - 32 - 24) / 3,
                    },
                  ]}
                >
                  <Skeleton width={40} height={12} />
                  <Skeleton
                    width={32}
                    height={32}
                    style={{ marginVertical: 8 }}
                  />
                  <Skeleton width={60} height={10} />
                  <Skeleton width={40} height={12} />
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: tokens.paper }]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: tokens.border }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.ink }]}>
            Daily Rewards
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.content}>
          <StateBlock
            message="Failed to load daily rewards"
            onRetry={() => refetch()}
            tokens={tokens}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Default reward structure for display
  const defaultRewards: DailyRewardInfo[] = [
    {
      id: 1,
      day_number: 1,
      reward_type: "points",
      reward_value: 100,
      title: "Welcome Back!",
      description: "",
      icon_emoji: "🎯",
    },
    {
      id: 2,
      day_number: 2,
      reward_type: "points",
      reward_value: 150,
      title: "Getting Started",
      description: "",
      icon_emoji: "⚡",
    },
    {
      id: 3,
      day_number: 3,
      reward_type: "points",
      reward_value: 200,
      title: "On a Roll",
      description: "",
      icon_emoji: "🚀",
    },
    {
      id: 4,
      day_number: 4,
      reward_type: "points",
      reward_value: 300,
      title: "Consistency Pays",
      description: "",
      icon_emoji: "💪",
    },
    {
      id: 5,
      day_number: 5,
      reward_type: "points",
      reward_value: 400,
      title: "Dedication",
      description: "",
      icon_emoji: "🔥",
    },
    {
      id: 6,
      day_number: 6,
      reward_type: "points",
      reward_value: 500,
      title: "Almost There",
      description: "",
      icon_emoji: "⭐",
    },
    {
      id: 7,
      day_number: 7,
      reward_type: "points",
      reward_value: 750,
      title: "Week Complete!",
      description: "",
      icon_emoji: "🏆",
    },
  ];

  const currentStreak = rewardStatus?.current_streak || 0;
  const todayReward = rewardStatus?.todays_reward;
  const canClaim = rewardStatus?.can_claim_today;
  const recentClaims = rewardStatus?.recent_claims || [];
  const rewards = rewardConfig.length > 0 ? rewardConfig : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tokens.paper }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: tokens.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={tokens.ink} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: tokens.ink }]}>
          Daily Rewards
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Streak Status */}
        <View
          style={[
            styles.streakCard,
            { backgroundColor: tokens.paper, borderColor: tokens.border },
          ]}
        >
          <View style={styles.streakHeader}>
            <Text style={[styles.streakEmoji]}>🔥</Text>
            <View style={styles.streakInfo}>
              <Text style={[styles.streakNumber, { color: tokens.mint }]}>
                {currentStreak}
              </Text>
              <Text style={[styles.streakLabel, { color: tokens.ink }]}>
                Day Streak
              </Text>
            </View>
          </View>
          <Text style={[styles.streakSubtext, { color: tokens.inkMuted }]}>
            {currentStreak === 0
              ? "Start your daily streak by claiming today's reward!"
              : `You're on fire! ${7 - (currentStreak % 7)} more days to complete the week.`}
          </Text>
        </View>

        {/* Claim Button */}
        {canClaim && todayReward && (
          <TouchableOpacity
            style={[
              styles.claimButton,
              {
                backgroundColor: tokens.mint,
                opacity: claimingReward ? 0.7 : 1,
              },
            ]}
            onPress={handleClaimReward}
            disabled={claimingReward}
          >
            <Text style={[styles.claimButtonEmoji]}>
              {todayReward.icon_emoji}
            </Text>
            <View style={styles.claimButtonContent}>
              <Text style={[styles.claimButtonTitle, { color: "#FFFFFF" }]}>
                {claimingReward ? "Claiming..." : "Claim Today's Reward"}
              </Text>
              <Text style={[styles.claimButtonSubtitle, { color: "#FFFFFF" }]}>
                {todayReward.title} • +{todayReward.reward_value}{" "}
                {todayReward.reward_type === "points" ? "points" : "% bonus"}
              </Text>
            </View>
            {claimingReward ? (
              <ActivityIndicator size="small" color={"#FFFFFF"} />
            ) : (
              <Ionicons name="chevron-forward" size={24} color={"#FFFFFF"} />
            )}
          </TouchableOpacity>
        )}

        {/* Daily Progress */}
        <View style={styles.progressSection}>
          <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
            Daily Progress
          </Text>

          {/* Calculate which weeks to show */}
          {(() => {
            const currentWeek = Math.floor((currentStreak - 1) / 7) + 1; // Week 1, 2, 3, etc.
            const weeksToShow = Math.max(2, currentWeek + 1); // Show current week + next week, minimum 2 weeks
            const weeks = [];

            for (let week = 1; week <= weeksToShow; week++) {
              const startDay = (week - 1) * 7 + 1;
              const endDay = week * 7;
              const weekDays = [];

              for (let dayNumber = startDay; dayNumber <= endDay; dayNumber++) {
                const reward =
                  defaultRewards.find((r) => r.day_number === dayNumber) ||
                  (dayNumber <= 7
                    ? null
                    : defaultRewards.find((r) => r.day_number === 7));

                const isToday = dayNumber === currentStreak + 1;
                const isClaimed = dayNumber <= currentStreak;
                const isFuture = dayNumber > currentStreak + 1;

                weekDays.push(
                  renderDayCard(dayNumber, reward, isToday, isClaimed),
                );
              }

              weeks.push(
                <View key={week} style={styles.weekSection}>
                  <Text style={[styles.weekTitle, { color: tokens.inkMuted }]}>
                    Week {week} (Days {startDay}-{endDay})
                  </Text>
                  <View style={styles.dayGrid}>{weekDays}</View>
                </View>,
              );
            }

            return weeks;
          })()}
        </View>

        {/* Milestones */}
        <View style={styles.milestonesSection}>
          <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
            Upcoming Milestones
          </Text>
          <View style={styles.milestonesList}>
            {currentStreak < 14 && (
              <View
                style={[
                  styles.milestoneCard,
                  { backgroundColor: tokens.paper, borderColor: tokens.border },
                ]}
              >
                <Text style={styles.milestoneEmoji}>🛡️</Text>
                <View style={styles.milestoneInfo}>
                  <Text style={[styles.milestoneTitle, { color: tokens.ink }]}>
                    Two Week Warrior
                  </Text>
                  <Text
                    style={[
                      styles.milestoneSubtitle,
                      { color: tokens.inkMuted },
                    ]}
                  >
                    Day 14 • 20% bonus multiplier
                  </Text>
                  <Text
                    style={[styles.milestoneProgress, { color: tokens.mint }]}
                  >
                    {14 - currentStreak} days to go
                  </Text>
                </View>
              </View>
            )}
            {currentStreak < 21 && (
              <View
                style={[
                  styles.milestoneCard,
                  { backgroundColor: tokens.paper, borderColor: tokens.border },
                ]}
              >
                <Text style={styles.milestoneEmoji}>👑</Text>
                <View style={styles.milestoneInfo}>
                  <Text style={[styles.milestoneTitle, { color: tokens.ink }]}>
                    Three Week Legend
                  </Text>
                  <Text
                    style={[
                      styles.milestoneSubtitle,
                      { color: tokens.inkMuted },
                    ]}
                  >
                    Day 21 • 1500 bonus points
                  </Text>
                  <Text
                    style={[styles.milestoneProgress, { color: tokens.mint }]}
                  >
                    {21 - currentStreak} days to go
                  </Text>
                </View>
              </View>
            )}
            {currentStreak < 30 && (
              <View
                style={[
                  styles.milestoneCard,
                  { backgroundColor: tokens.paper, borderColor: tokens.border },
                ]}
              >
                <Text style={styles.milestoneEmoji}>💎</Text>
                <View style={styles.milestoneInfo}>
                  <Text style={[styles.milestoneTitle, { color: tokens.ink }]}>
                    Monthly Master
                  </Text>
                  <Text
                    style={[
                      styles.milestoneSubtitle,
                      { color: tokens.inkMuted },
                    ]}
                  >
                    Day 30 • 50% bonus multiplier
                  </Text>
                  <Text
                    style={[styles.milestoneProgress, { color: tokens.mint }]}
                  >
                    {30 - currentStreak} days to go
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
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
    paddingBottom: 80, // Extra padding at bottom to prevent scroll blocking
    gap: 24,
  },
  streakCard: {
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  streakHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 16,
    marginBottom: 8,
  },
  streakEmoji: {
    fontSize: 32,
  },
  streakInfo: {
    alignItems: "center" as const,
  },
  streakNumber: {
    fontSize: 28,
    fontWeight: "bold" as const,
  },
  streakLabel: {
    fontSize: 14,
    fontWeight: "500" as const,
  },
  streakSubtext: {
    fontSize: 14,
    lineHeight: 20,
  },
  claimButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 16,
    borderRadius: 12,
    gap: 16,
  },
  claimButtonEmoji: {
    fontSize: 32,
  },
  claimButtonContent: {
    flex: 1,
  },
  claimButtonTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    marginBottom: 4,
  },
  claimButtonSubtitle: {
    fontSize: 14,
    opacity: 0.9,
  },
  progressSection: {
    gap: 16,
  },
  weekSection: {
    gap: 12,
    marginBottom: 20,
  },
  weekTitle: {
    fontSize: 14,
    fontWeight: "600" as const,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
  },
  dayGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 16, // Increased gap between cards
    justifyContent: "space-between" as const,
  },
  dayCard: {
    width: (width - 32 - 96) / 7, // Account for padding (32) and gaps (16*6=96 gaps between 7 cards)
    aspectRatio: 1,
    padding: 12, // Reduced padding since cards are smaller
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    position: "relative" as const,
    minHeight: 80, // Reduced minimum height for smaller cards
  },
  dayNumber: {
    fontSize: 10,
    fontWeight: "600" as const,
    marginBottom: 2,
  },
  rewardEmoji: {
    fontSize: 20, // Reduced emoji size for smaller cards
    marginBottom: 4,
  },
  rewardTitle: {
    fontSize: 8,
    fontWeight: "500" as const,
    textAlign: "center" as const,
    marginBottom: 2,
    lineHeight: 10,
  },
  rewardValue: {
    fontSize: 10, // Reduced font size for smaller cards
    fontWeight: "bold" as const,
  },
  completedBadge: {
    position: "absolute" as const,
    top: 4,
    right: 4,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 8,
    padding: 1,
  },
  milestonesSection: {
    gap: 16,
  },
  milestonesList: {
    gap: 12,
  },
  milestoneCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 16,
  },
  milestoneEmoji: {
    fontSize: 24,
  },
  milestoneInfo: {
    flex: 1,
  },
  milestoneTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    marginBottom: 4,
  },
  milestoneSubtitle: {
    fontSize: 14,
    marginBottom: 4,
  },
  milestoneProgress: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
};
