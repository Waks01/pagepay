/**
 * RateLimitDisplay - Shows user's remaining purchase quota
 * Displays hourly and daily limits for current service
 */

import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { apiFetch } from "@/src/shared/api/client";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type RateLimitQuota = {
  service: string;
  remaining_hourly: number;
  limit_hourly: number;
  remaining_daily: number;
  limit_daily: number;
  reset_hourly_at: string;
  reset_daily_at: string;
};

type Props = {
  service: string;
};

export function RateLimitDisplay({ service }: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const { data: quota, isLoading } = useQuery({
    queryKey: ["rate-limit-quota", service],
    queryFn: async (): Promise<RateLimitQuota> => {
      const response = await apiFetch(`/api/v1/bills/quota/${service}`);
      if (!response.ok) {
        throw new Error("Failed to fetch quota");
      }
      return response.json();
    },
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: true,
  });

  if (isLoading || !quota) {
    return null;
  }

  // Show warning if approaching limits
  const hourlyWarning = quota.remaining_hourly <= 2;
  const dailyWarning = quota.remaining_daily <= 5;

  if (quota.remaining_hourly === quota.limit_hourly && quota.remaining_daily === quota.limit_daily) {
    // Full quota available, don't show
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.cardSecondary, borderColor: tokens.border }]}>
      <View style={styles.header}>
        <Ionicons name="time-outline" size={16} color={tokens.inkMuted} />
        <Text style={[styles.title, { color: tokens.inkMuted }]}>
          Purchase Limits
        </Text>
      </View>
      
      <View style={styles.quotaRow}>
        <View style={styles.quotaItem}>
          <Text style={[styles.quotaLabel, { color: tokens.inkMuted }]}>
            Hourly
          </Text>
          <Text 
            style={[
              styles.quotaValue, 
              { color: hourlyWarning ? tokens.error : tokens.ink }
            ]}
          >
            {quota.remaining_hourly}/{quota.limit_hourly}
          </Text>
        </View>
        
        <View style={styles.quotaItem}>
          <Text style={[styles.quotaLabel, { color: tokens.inkMuted }]}>
            Daily
          </Text>
          <Text 
            style={[
              styles.quotaValue, 
              { color: dailyWarning ? tokens.error : tokens.ink }
            ]}
          >
            {quota.remaining_daily}/{quota.limit_daily}
          </Text>
        </View>
      </View>

      {(hourlyWarning || dailyWarning) && (
        <View style={[styles.warningBanner, { backgroundColor: tokens.errorSoft }]}>
          <Ionicons name="warning-outline" size={14} color={tokens.error} />
          <Text style={[styles.warningText, { color: tokens.error }]}>
            {hourlyWarning 
              ? "Approaching hourly limit"
              : "Approaching daily limit"
            }
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "500",
    marginLeft: 4,
  },
  quotaRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  quotaItem: {
    alignItems: "center",
  },
  quotaLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  quotaValue: {
    fontSize: 16,
    fontWeight: "600",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    padding: 6,
    borderRadius: 4,
  },
  warningText: {
    fontSize: 12,
    marginLeft: 4,
  },
});