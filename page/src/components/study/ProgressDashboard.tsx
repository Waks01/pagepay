import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/shared/api/client";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { PagePay, Fonts } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type ProgressDashboardProps = {
  materialId: number;
  totalTopics: number;
  mastered?: number;
  reviewing?: number;
  notStarted?: number;
  progress?: Array<{
    id: number;
    material_id: number;
    topic_index: number;
    topic_name: string;
    status: string;
    mastery_score: number | null;
    last_reviewed_at: string | null;
  }>;
};

export function ProgressDashboard({
  materialId,
  totalTopics,
  mastered: masteredProp,
  reviewing: reviewingProp,
  notStarted: notStartedProp,
  progress: progressProp,
}: ProgressDashboardProps) {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const progressQ = useQuery({
    queryKey: ["study", "progress", materialId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/study/materials/${materialId}/progress`);
      if (!res.ok) throw new Error("Failed to load progress");
      return res.json();
    },
    enabled: materialId > 0,
  });

  const total = progressQ.data?.total_topics ?? totalTopics ?? 0;
  const mastered = progressQ.data?.mastered ?? masteredProp ?? 0;
  const reviewing = progressQ.data?.reviewing ?? reviewingProp ?? 0;
  const notStarted =
    progressQ.data?.not_started ?? notStartedProp ?? Math.max(0, total - mastered - reviewing);
  const progress = progressQ.data?.progress ?? progressProp ?? [];

  const pct = total > 0 ? Math.round(((mastered + reviewing) / total) * 100) : 0;
  const masteredRatio = total > 0 ? mastered / total : 0;
  const reviewingRatio = total > 0 ? reviewing / total : 0;
  const notStartedRatio = Math.max(0, 1 - masteredRatio - reviewingRatio);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tokens.card, borderColor: tokens.border },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: tokens.ink }]}>
          {t("study.progress.title")}
        </Text>
        <Text style={[styles.pct, { color: tokens.mint }]}>{pct}%</Text>
      </View>

      <View style={styles.barRow}>
        <View style={[styles.bar, { backgroundColor: tokens.border }]}>
          {total > 0 && mastered > 0 && (
            <View
              style={[
                styles.segment,
                {
                  backgroundColor: tokens.mint,
                  width: `${masteredRatio * 100}%`,
                },
              ]}
            />
          )}
          {total > 0 && reviewing > 0 && (
            <View
              style={[
                styles.segment,
                {
                  backgroundColor: tokens.mintSoft,
                  width: `${reviewingRatio * 100}%`,
                },
              ]}
            />
          )}
          {total > 0 && notStartedRatio > 0 && (
            <View
              style={[
                styles.segment,
                {
                  backgroundColor: tokens.border,
                  width: `${notStartedRatio * 100}%`,
                },
              ]}
            />
          )}
        </View>
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: tokens.mint }]} />
          <Text style={[styles.legendText, { color: tokens.inkMuted }]}>
            {mastered} {t("study.progress.mastered")}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: tokens.mintSoft }]} />
          <Text style={[styles.legendText, { color: tokens.inkMuted }]}>
            {reviewing} {t("study.progress.reviewing")}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: tokens.border }]} />
          <Text style={[styles.legendText, { color: tokens.inkMuted }]}>
            {notStarted} {t("study.progress.not_started")}
          </Text>
        </View>
      </View>

      {progressQ.isLoading ? (
        <Text style={[styles.statusText, { color: tokens.inkMuted }]}>
          {t("study.progress.loading")}
        </Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          {progress.map((item) => (
            <Pressable
              key={item.id}
              style={[
                styles.chip,
                {
                  borderColor:
                    item.status === "mastered"
                      ? tokens.mint
                      : item.status === "reviewing"
                        ? tokens.mintSoft
                        : tokens.border,
                  backgroundColor:
                    item.status === "mastered"
                      ? tokens.mintSoft
                      : item.status === "reviewing"
                        ? tokens.paper
                        : tokens.card,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: item.status === "not_started" ? tokens.inkMuted : tokens.ink },
                ]}
              >
                {item.topic_name}
              </Text>
              <Text style={[styles.chipMeta, { color: tokens.mint }]}>
                {item.status === "mastered"
                  ? `${item.mastery_score ?? 0}%`
                  : item.status === "reviewing"
                    ? t("study.progress.reviewing")
                    : t("study.progress.not_started")}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 16,
    fontFamily: Fonts.editorialSemiBold as string,
    letterSpacing: -0.3,
  },
  pct: {
    fontSize: 14,
    fontWeight: "700",
  },
  barRow: {
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
    flexDirection: "row",
  },
  bar: {
    flex: 1,
    borderRadius: 999,
    flexDirection: "row",
    overflow: "hidden",
  },
  segment: {
    height: "100%",
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    fontWeight: "600",
  },
  statusText: {
    fontSize: 12,
    marginTop: 4,
  },
  chips: {
    marginTop: 4,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    gap: 4,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  chipMeta: {
    fontSize: 11,
    fontWeight: "700",
  },
});
