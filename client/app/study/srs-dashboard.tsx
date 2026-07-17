import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { getDueCards, getStats, type SRSCard } from '@/src/features/study/spaced-repetition';

type SRSStats = {
  totalCards: number;
  dueToday: number;
  mastered: number;
  learning: number;
  reviewing: number;
  averageSuccessRate: number;
};

export default function SrsDashboardScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [dueCards, setDueCards] = useState<SRSCard[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [stats, due] = await Promise.all([getStats(), getDueCards()]);
      setDueCards(due);
    } catch (error) {
      console.error('Failed to load SRS data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const renderCard = ({ item }: { item: SRSCard }) => {
    const boxColor = item.box >= 4 ? tokens.mint : item.box >= 2 ? tokens.inkMuted : tokens.signal;
    return (
      <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
        <View style={[styles.boxBadge, { backgroundColor: boxColor }]}>
          <Text style={styles.boxText}>Box {item.box}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: tokens.ink }]}>
            Asset #{item.assetId} · Card {item.cardIndex + 1}
          </Text>
          <Text style={[styles.cardMeta, { color: tokens.inkMuted }]}>
            Reviews: {item.reviewCount} · Success: {item.successRate}%
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={tokens.mint} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
            Review Dashboard
          </Text>
        </View>

        {loading ? (
          <View style={{ marginTop: 32, alignItems: 'center', gap: 12 }}>
            <ActivityIndicator size="small" color={tokens.mint} />
            <Text style={[styles.loadingLabel, { color: tokens.inkMuted }]}>Loading review data…</Text>
          </View>
        ) : (
          <>
            <View style={styles.statsRow}>
              <View style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
                <Text style={[styles.statValue, { color: tokens.mint }]}>{dueCards.length}</Text>
                <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Due Today</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
                <Text style={[styles.statValue, { color: tokens.ink }]}>
                  {dueCards.filter((c) => c.box === 5).length}
                </Text>
                <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Mastered</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
                <Text style={[styles.statValue, { color: tokens.signal }]}>
                  {dueCards.filter((c) => c.box <= 2).length}
                </Text>
                <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>Learning</Text>
              </View>
            </View>

            <Text style={[styles.sectionTitle, { color: tokens.ink }]}>Due for Review</Text>
            {dueCards.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="checkmark-done-circle-outline" size={48} color={tokens.mint} />
                <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
                  No cards due today. Keep up the good work!
                </Text>
              </View>
            ) : (
              <FlatList
                data={dueCards}
                keyExtractor={(item) => `${item.assetId}_${item.cardIndex}`}
                renderItem={renderCard}
                scrollEnabled={false}
                contentContainerStyle={styles.cardList}
              />
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
    paddingBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    letterSpacing: -0.5,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
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
    fontSize: 22,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  cardList: {
    gap: 10,
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
    paddingVertical: 6,
    borderRadius: 999,
  },
  boxText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  loadingLabel: {
    fontSize: 13,
  },
});
