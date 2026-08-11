import { StyleSheet, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Fonts, PagePay } from '@/constants/theme';
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
  { label: string; tint: string; icon: keyof typeof Ionicons.glyphMap; soft: string }
> = {
  mastered: { label: 'Mastered', tint: 'mint', icon: 'trophy', soft: 'mintFaint' },
  reviewing: { label: 'Reviewing', tint: 'gold', icon: 'time', soft: 'mintFaint' },
  not_started: { label: 'Not Started', tint: 'inkFaint', icon: 'remove-circle-outline', soft: 'paper2' },
};

export function ProgressDashboard({
  materialId: _materialId,
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
    <View style={styles.container}>
      {/* Editorial mastery hero — dark surface, big serif number. */}
      <View style={[styles.hero, { backgroundColor: tokens.ink }]}>
        <View>
          <Text style={[styles.heroEyebrow, { color: 'rgba(255,255,255,0.6)' }]}>
            Overall mastery
          </Text>
          <Text
            style={[styles.heroNum, { color: tokens.paper, fontFamily: Fonts.editorialSemiBold as string }]}
          >
            {overallMastery}
            <Text style={{ fontSize: 22, opacity: 0.6 }}>%</Text>
          </Text>
        </View>
        <View style={[styles.heroChips, { flexWrap: 'wrap' }]}>
          <HeroStat label="Mastered" value={mastered} tokens={tokens} dot="mint" />
          <HeroStat label="Reviewing" value={reviewing} tokens={tokens} dot="gold" />
          <HeroStat label="Not started" value={notStarted} tokens={tokens} dot="faint" />
        </View>
      </View>

      {/* Per-topic list — keeps the existing icon-badge layout, just tokenized. */}
      <View style={styles.list}>
        {progress.map((item) => {
          const config = STATUS_CONFIG[item.status] || STATUS_CONFIG['not_started'];
          const tint = (tokens as any)[config.tint] as string;
          const soft = (tokens as any)[config.soft] as string;
          return (
            <View
              key={item.id}
              style={[styles.item, { borderColor: tokens.border, backgroundColor: tokens.card }]}
            >
              <View
                style={[styles.statusBadge, { backgroundColor: soft }]}
              >
                <Ionicons name={config.icon} size={16} color={tint} />
              </View>
              <View style={styles.itemInfo}>
                <Text style={[styles.topicName, { color: tokens.ink }]}>
                  {item.topic_name}
                </Text>
                <Text style={[styles.topicStatus, { color: tokens.inkMuted }]}>
                  {config.label}
                  {item.mastery_score !== null && ` · ${item.mastery_score}%`}
                </Text>
              </View>
              {item.mastery_score !== null && (
                <View style={[styles.scorePill, { backgroundColor: tokens.mintFaint }]}>
                  <Text
                    style={[
                      styles.scoreText,
                      { color: tokens.mint, fontFamily: Fonts.editorialSemiBold as string },
                    ]}
                  >
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

function HeroStat({
  label,
  value,
  tokens,
  dot,
}: {
  label: string;
  value: number;
  tokens: any;
  dot: 'mint' | 'gold' | 'faint';
}) {
  const dotColor =
    dot === 'mint' ? tokens.mint : dot === 'gold' ? tokens.gold : 'rgba(255,255,255,0.4)';
  return (
    <View style={styles.heroStat}>
      <View style={[styles.legendDot, { backgroundColor: dotColor }]} />
      <Text style={[styles.heroStatVal, { color: tokens.paper }]}>{value}</Text>
      <Text style={[styles.heroStatLabel, { color: 'rgba(255,255,255,0.65)' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    overflow: 'hidden',
    gap: 12,
  },
  hero: {
    borderRadius: 14,
    padding: 22,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroNum: {
    fontSize: 56,
    letterSpacing: -1.4,
    lineHeight: 60,
  },
  heroChips: {
    flexDirection: 'row',
    gap: 12,
    alignSelf: 'flex-end',
    flexShrink: 1,
  },
  heroStat: {
    alignItems: 'flex-start',
    gap: 2,
  },
  heroStatVal: {
    fontSize: 16,
    fontWeight: '600',
  },
  heroStatLabel: {
    fontSize: 10.5,
    letterSpacing: 0.04,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  list: {
    gap: 10,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: 14,
  },
  statusBadge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  topicName: {
    fontSize: 14,
    fontWeight: '600',
  },
  topicStatus: {
    fontSize: 12,
  },
  scorePill: {
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 14,
    letterSpacing: -0.2,
  },
});
