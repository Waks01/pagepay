import { View, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { apiFetch } from '@/src/shared/api/client';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';
import { StateBlock } from '@/components/StateBlock';
import { TransactionDetailHeader } from '@/components/transactions/TransactionDetailHeader';
import { AirtimeDetail } from '@/components/transactions/details/AirtimeDetail';
import type { TransactionHistoryItem } from '@/src/shared/types/transaction';

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const { data: transaction, isLoading, error } = useQuery({
    queryKey: ['transaction', id],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/transactions/history?limit=100`);
      if (!response.ok) {
        throw new Error('Failed to load transaction');
      }
      const data = await response.json();
      const item = data.items.find((t: TransactionHistoryItem) => t.id === parseInt(id));
      if (!item) {
        throw new Error('Transaction not found');
      }
      return item as TransactionHistoryItem;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.paper }]}>
        <Stack.Screen 
          options={{ 
            title: 'Transaction Details',
            headerBackTitle: 'Back',
          }} 
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={tokens.mint} />
        </View>
      </View>
    );
  }

  if (error || !transaction) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.paper }]}>
        <Stack.Screen 
          options={{ 
            title: 'Transaction Details',
            headerBackTitle: 'Back',
          }} 
        />
        <StateBlock
          icon="alert-circle-outline"
          message="Transaction not found"
          onRetry={() => router.back()}
          tokens={tokens}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.paper }]}>
      <Stack.Screen 
        options={{ 
          title: 'Transaction Details',
          headerBackTitle: 'Back',
        }} 
      />
      
      <TransactionDetailHeader transaction={transaction} tokens={tokens} />
      
      {renderTransactionDetail(transaction, tokens)}
    </View>
  );
}

function renderTransactionDetail(transaction: TransactionHistoryItem, tokens: any) {
  if (transaction.type === 'bill') {
    switch (transaction.subtype) {
      case 'airtime':
        return <AirtimeDetail transaction={transaction} tokens={tokens} />;
      case 'data':
      case 'electricity':
      case 'tv':
      case 'recharge_pin':
      case 'betting':
      case 'isp':
      case 'education':
      case 'sms':
        return <AirtimeDetail transaction={transaction} tokens={tokens} />;
      default:
        return <AirtimeDetail transaction={transaction} tokens={tokens} />;
    }
  }
  
  return <AirtimeDetail transaction={transaction} tokens={tokens} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
