import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

export default function FundWalletSuccessScreen() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const router = useRouter();
  const params = useLocalSearchParams<{
    status?: string;
    amount?: string;
  }>();

  const amount = params.amount ? Number(params.amount) / 100 : 0;
  const isSuccess = params.status === 'success';

  if (!isSuccess) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.paper }]}>
        <Ionicons name="close-circle-outline" size={64} color={tokens.signal} />
        <Text style={[styles.title, { color: tokens.ink }]}>
          Deposit Cancelled
        </Text>
        <Text style={[styles.message, { color: tokens.inkMuted }]}>
          Your deposit was cancelled. You can try again when you're ready.
        </Text>
        <TouchableOpacity onPress={() => router.replace('/wallet')} style={[styles.button, { backgroundColor: tokens.mint }]}>
          <Text style={[styles.buttonText, { color: tokens.mintText }]}>Go to Wallet</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.paper }]}>
      <Ionicons name="checkmark-circle" size={64} color={tokens.mint} />
      <Text style={[styles.title, { color: tokens.ink }]}>
        Deposit Successful!
      </Text>
      <Text style={[styles.message, { color: tokens.inkMuted }]}>
        {amount > 0
          ? `₦${amount.toLocaleString()} has been added to your wallet.`
          : 'Your wallet has been credited.'}
      </Text>
      <TouchableOpacity onPress={() => router.replace('/wallet')} style={[styles.button, { backgroundColor: tokens.mint }]}>
        <Text style={[styles.buttonText, { color: tokens.mintText }]}>View Wallet</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
