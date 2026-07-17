import { StyleSheet, Text, View, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type Payment = {
  id: number;
  amount: number;
  status: string;
  type: string;
  created_at: string;
  subscription_tier?: string;
};

export default function BillingHistoryScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const { data: payments, isLoading, error } = useQuery({
    queryKey: ['payments', 'history'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/payments/history');
      if (!res.ok) throw new Error('Failed to load payment history');
      return (await res.json()) as Payment[];
    },
  });

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: tokens.paper }]}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={tokens.mint} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: tokens.paper }]}>
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={48} color={tokens.signal} />
          <Text style={[styles.errorText, { color: tokens.ink }]}>{t('billing_history.error')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tokens.paper }]}>
      <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
        {t('billing_history.title')}
      </Text>
      
      {!payments || payments.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="receipt-outline" size={64} color={tokens.inkMuted} />
          <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>{t('billing_history.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={payments}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={[styles.type, { color: tokens.ink }]}>
                    {item.type === 'subscription' ? t('billing_history.subscription') : t('billing_history.payment')}
                  </Text>
                  {item.subscription_tier && (
                    <Text style={[styles.tier, { color: tokens.inkMuted }]}>
                      {item.subscription_tier}
                    </Text>
                  )}
                </View>
                <Text style={[styles.amount, { color: tokens.mint, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                  ₦{item.amount.toLocaleString()}
                </Text>
              </View>
              <View style={styles.cardFooter}>
                <Text style={[styles.date, { color: tokens.inkMuted }]}>
                  {new Date(item.created_at).toLocaleDateString('en-NG', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
                <View style={[styles.statusBadge, { backgroundColor: item.status === 'completed' ? tokens.mintSoft : tokens.signalSoft }]}>
                  <Text style={[styles.status, { color: item.status === 'completed' ? tokens.mint : tokens.signal }]}>
                    {t(`billing_history.${item.status}`)}
                  </Text>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  error: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
  },
  list: {
    padding: 20,
    gap: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  type: {
    fontSize: 16,
    fontWeight: '600',
  },
  tier: {
    fontSize: 13,
    marginTop: 2,
  },
  amount: {
    fontSize: 20,
    letterSpacing: -0.3,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  date: {
    fontSize: 13,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
});
