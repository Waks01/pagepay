import { StyleSheet, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type ProgressItem = {
  id: number;
  topic_index: number;
  topic_name: string;
  status: string;
  mastery_score: number | null;
  last_reviewed_at: string | null;
};

type ProgressDashboardProps = {
  materialId: number;
  totalTopics: number;
  mastered: number;
  reviewing: number;
  notStarted: number;
  progress: ProgressItem[];
};

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  mastered: { label: 'Mastered', color: '#34C759', icon: 'trophy' },
  reviewing: { label: 'Reviewing', color: '#FF9500', icon: 'time' },
  not_started: { label: 'Not Started', color: '#8E8E93', icon: 'remove-circle-outline' },
};

export function ProgressDashboard({
  materialId,
  totalTopics,
  mastered,
  reviewing,
  notStarted,
  progress,
}: ProgressDashboardProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const overallMastery = totalTopics > 0 ? Math.round((mastered / totalTopics) * 100) : 0;

  return (
    <View style={[styles.container, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <View style={styles.header}>
        <Ionicons name="bar-chart-outline" size={24} color={tokens.mint} />
        <Text style={[styles.title, { color: tokens.ink }]}>Your Progress</Text>
      </View>

      <View style={[styles.overallCard, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
        <View style={styles.overallLeft}>
          <Text style={[styles.overallPercentage, { color: tokens.mint }]}>
            {overallMastery}%
          </Text>
          <Text style={[styles.overallLabel, { color: tokens.inkMuted }]}>Overall Mastery</Text>
        </View>
        <View style={styles.overallRight}>
          <View style={styles.statRow}>
            <Ionicons name="trophy" size={18} color="#34C759" />
            <Text style={[styles.statText, { color: tokens.ink }]}>
              {mastered} Mastered
            </Text>
          </View>
          <View style={styles.statRow}>
            <Ionicons name="time" size={18} color="#FF9500" />
            <Text style={[styles.statText, { color: tokens.ink }]}>
              {reviewing} Reviewing
            </Text>
          </View>
          <View style={styles.statRow}>
            <Ionicons name="remove-circle-outline" size={18} color="#8E8E93" />
            <Text style={[styles.statText, { color: tokens.ink }]}>
              {notStarted} Not Started
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.progressList}>
        {progress.map((item) => {
          const config = STATUS_CONFIG[item.status] || STATUS_CONFIG['not_started'];
          return (
            <View
              key={item.id}
              style={[styles.progressItem, { backgroundColor: tokens.paper, borderColor: tokens.border }]}
            >
              <View style={styles.progressLeft}>
                <View style={[styles.statusBadge, { backgroundColor: config.color + '20' }]}>
                  <Ionicons name={config.icon} size={16} color={config.color} />
                </View>
                <View style={styles.progressInfo}>
                  <Text style={[styles.topicName, { color: tokens.ink }]}>
                    {item.topic_name}
                  </Text>
                  <Text style={[styles.topicStatus, { color: tokens.inkMuted }]}>
                    {config.label}
                    {item.mastery_score !== null && ` • ${item.mastery_score}%`}
                  </Text>
                </View>
              </View>
              {item.mastery_score !== null && (
                <View style={styles.scoreCircle}>
                  <Text style={[styles.scoreText, { color: tokens.mint }]}>
                    {item.mastery_score}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  overallCard: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  overallLeft: {
    alignItems: 'center',
    gap: 4,
  },
  overallPercentage: {
    fontSize: 32,
    fontWeight: '800',
  },
  overallLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  overallRight: {
    gap: 8,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    fontSize: 13,
    fontWeight: '500',
  },
  progressList: {
    paddingHorizontal: 16,
    gap: 10,
    paddingBottom: 16,
  },
  progressItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  progressLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  statusBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressInfo: {
    flex: 1,
    gap: 2,
  },
  topicName: {
    fontSize: 14,
    fontWeight: '600',
  },
  topicStatus: {
    fontSize: 12,
    fontWeight: '500',
  },
  scoreCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#34C75920',
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
