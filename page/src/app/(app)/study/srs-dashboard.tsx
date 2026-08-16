import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { PagePay, Fonts } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { getDueCards, type SRSCard } from '@/src/features/study/spaced-repetition';
import { PageHeader } from '@/components/PageHeader';

export default function SrsDashboardScreen() {
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [dueCards, setDueCards] = useState<SRSCard[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const due = await getDueCards();
      setDueCards(due);
    } catch (error) {
      if (__DEV__) console.error('Failed to load SRS data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const masteredCount = dueCards.filter((c) => c.box === 5).length;
  const learningCount = dueCards.filter((c) => c.box <= 2).length;

  const renderCard = (item: SRSCard, idx: number) => {
    const boxColor = item.box >= 4 ? tokens.mint : item.box >= 2 ? tokens.gold : tokens.signal;
    return (
      <Animated.View
        key={`${item.assetId}_${item.cardIndex}`}
        entering={FadeInDown.delay(idx * 40).duration(220).springify()}
        style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}
      >
        <View style={[styles.boxBadge, { backgroundColor: boxColor + '22', borderColor: boxColor }]}>
          <Text style={[styles.boxText, { color: boxColor }]}>Box {item.box}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.cardTitle, { color: tokens.ink }]} numberOfLines={1}>
            Asset #{item.assetId} · Card {item.cardIndex + 1}
          </Text>
          <Text style={[styles.cardMeta, { color: tokens.inkMuted }]} numberOfLines={1}>
            {item.reviewCount} reviews · {item.successRate}% success
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={tokens.inkMuted} />
      </Animated.View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <PageHeader
          title="Review Due"
          subtitle={loading ? 'Loading…' : `${dueCards.length} ${dueCards.length === 1 ? 'card' : 'cards'} ready`}
          showBack
          onBack={() => router.back()}
          backgroundColor={tokens.card}
          borderBottomColor={tokens.border}
          tokens={tokens}
        />

        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="small" color={tokens.mint} />
            <Text style={[styles.loadingLabel, { color: tokens.inkMuted }]}>Loading review data…</Text>
          </View>
        ) : (
          <>
            <View style={styles.statsRow}>
              <Animated.View entering={FadeIn.duration(220)} style={[styles.statBox, { backgroundColor: tokens.mintFaint, borderColor: tokens.mint }]}>
                <Text style={[styles.statValue, { color: tokens.mint, fontFamily: Fonts.editorialSemiBold as string }]}>
                  {dueCards.length}
                </Text>
                <Text style={[styles.statLabel, { color: tokens.mint }]}>Due Today</Text>
              </Animated.View>
              <Animated.View entering={FadeIn.delay(60).duration(220)} style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
                <Text style={[styles.statValue, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}>
                  {masteredCount}
                </Text>
                <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Mastered</Text>
              </Animated.View>
              <Animated.View entering={FadeIn.delay(120).duration(220)} style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
                <Text style={[styles.statValue, { color: tokens.signal, fontFamily: Fonts.editorialSemiBold as string }]}>
                  {learningCount}
                </Text>
                <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Learning</Text>
              </Animated.View>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}>
                Due for Review
              </Text>
              <Text style={[styles.sectionMeta, { color: tokens.inkMuted }]}>
                {dueCards.length} cards
              </Text>
            </View>

            {dueCards.length === 0 ? (
              <View style={[styles.emptyState, { borderColor: tokens.border, backgroundColor: tokens.card }]}>
                <View style={[styles.emptyIcon, { backgroundColor: tokens.mintSoft }]}>
                  <Ionicons name="checkmark-done-circle-outline" size={28} color={tokens.mint} />
                </View>
                <Text style={[styles.emptyTitle, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}>
                  All caught up
                </Text>
                <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
                  No cards due today. Keep up the great work!
                </Text>
              </View>
            ) : (
              <View style={styles.cardList}>
                {dueCards.map((card, idx) => renderCard(card, idx))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    gap: 20,
  },
  loadingBlock: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  loadingLabel: {
    fontSize: 13,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statBox: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 24,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 18,
    letterSpacing: -0.3,
  },
  sectionMeta: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cardList: {
    gap: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  boxBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  boxText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  cardMeta: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    letterSpacing: -0.3,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
