import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function WalletLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

export const options = {
  title: 'Wallet',
  tabBarIcon: ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <Ionicons name="wallet" size={size} color={color} />
  ),
};
