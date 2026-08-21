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
              ? tokens.accent
              : isClaimed || isPast
                ? tokens.success
                : isFuture
                  ? tokens.neutralSoft
                  : tokens.paper,
            borderColor: isToday
              ? tokens.accent
              : isClaimed || isPast
                ? tokens.success
                : tokens.neutral,
          },
        ]}
      >
        <Text
          style={[
            styles.dayNumber,
            { color: isClaimable ? tokens.white : tokens.text },
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
                  color: isClaimable ? tokens.white : tokens.text,
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
                    ? tokens.white
                    : reward.reward_type === "multiplier"
                      ? tokens.accent
                      : tokens.success,
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
            <Ionicons
              name="checkmark-circle"
              size={24}
              color={tokens.success}
            />
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: tokens.background }]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: tokens.neutral }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={tokens.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.text }]}>
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
              { backgroundColor: tokens.paper, borderColor: tokens.neutral },
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
              { backgroundColor: tokens.neutralSoft },
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
                      borderColor: tokens.neutral,
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
        style={[styles.container, { backgroundColor: tokens.background }]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: tokens.neutral }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={tokens.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.text }]}>
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

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: tokens.background }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: tokens.neutral }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={tokens.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: tokens.text }]}>
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
            { backgroundColor: tokens.paper, borderColor: tokens.neutral },
          ]}
        >
          <View style={styles.streakHeader}>
            <Text style={[styles.streakEmoji]}>🔥</Text>
            <View style={styles.streakInfo}>
              <Text style={[styles.streakNumber, { color: tokens.accent }]}>
                {currentStreak}
              </Text>
              <Text style={[styles.streakLabel, { color: tokens.text }]}>
                Day Streak
              </Text>
            </View>
          </View>
          <Text style={[styles.streakSubtext, { color: tokens.textSoft }]}>
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
                backgroundColor: tokens.accent,
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
              <Text style={[styles.claimButtonTitle, { color: tokens.white }]}>
                {claimingReward ? "Claiming..." : "Claim Today's Reward"}
              </Text>
              <Text
                style={[styles.claimButtonSubtitle, { color: tokens.white }]}
              >
                {todayReward.title} • +{todayReward.reward_value}{" "}
                {todayReward.reward_type === "points" ? "points" : "% bonus"}
              </Text>
            </View>
            {claimingReward ? (
              <ActivityIndicator size="small" color={tokens.white} />
            ) : (
              <Ionicons name="chevron-forward" size={24} color={tokens.white} />
            )}
          </TouchableOpacity>
        )}

        {/* 7-Day Progress */}
        <View style={styles.progressSection}>
          <Text style={[styles.sectionTitle, { color: tokens.text }]}>
            Weekly Progress
          </Text>
          <View style={styles.dayGrid}>
            {defaultRewards.map((reward, index) => {
              const dayNumber = reward.day_number;
              const isToday = dayNumber === currentStreak + 1;
              const isClaimed = recentClaims.some(
                (claim) =>
                  claim.streak_day === dayNumber &&
                  claim.date === new Date().toISOString().split("T")[0],
              );

              return renderDayCard(dayNumber, reward, isToday, isClaimed);
            })}
          </View>
        </View>

        {/* Milestones */}
        <View style={styles.milestonesSection}>
          <Text style={[styles.sectionTitle, { color: tokens.text }]}>
            Upcoming Milestones
          </Text>
          <View style={styles.milestonesList}>
            <View
              style={[
                styles.milestoneCard,
                { backgroundColor: tokens.paper, borderColor: tokens.neutral },
              ]}
            >
              <Text style={styles.milestoneEmoji}>🛡️</Text>
              <View style={styles.milestoneInfo}>
                <Text style={[styles.milestoneTitle, { color: tokens.text }]}>
                  Two Week Warrior
                </Text>
                <Text
                  style={[styles.milestoneSubtitle, { color: tokens.textSoft }]}
                >
                  Day 14 • 20% bonus multiplier
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.milestoneCard,
                { backgroundColor: tokens.paper, borderColor: tokens.neutral },
              ]}
            >
              <Text style={styles.milestoneEmoji}>👑</Text>
              <View style={styles.milestoneInfo}>
                <Text style={[styles.milestoneTitle, { color: tokens.text }]}>
                  Three Week Legend
                </Text>
                <Text
                  style={[styles.milestoneSubtitle, { color: tokens.textSoft }]}
                >
                  Day 21 • 1500 bonus points
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.milestoneCard,
                { backgroundColor: tokens.paper, borderColor: tokens.neutral },
              ]}
            >
              <Text style={styles.milestoneEmoji}>💎</Text>
              <View style={styles.milestoneInfo}>
                <Text style={[styles.milestoneTitle, { color: tokens.text }]}>
                  Monthly Master
                </Text>
                <Text
                  style={[styles.milestoneSubtitle, { color: tokens.textSoft }]}
                >
                  Day 30 • 50% bonus multiplier
                </Text>
              </View>
            </View>
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
  },
  dayGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 12,
  },
  dayCard: {
    width: (width - 32 - 24) / 3, // Account for padding and gaps
    aspectRatio: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    position: "relative" as const,
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: "600" as const,
    marginBottom: 8,
  },
  rewardEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  rewardTitle: {
    fontSize: 10,
    fontWeight: "500" as const,
    textAlign: "center" as const,
    marginBottom: 4,
  },
  rewardValue: {
    fontSize: 12,
    fontWeight: "bold" as const,
  },
  completedBadge: {
    position: "absolute" as const,
    top: 8,
    right: 8,
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
  },
};
