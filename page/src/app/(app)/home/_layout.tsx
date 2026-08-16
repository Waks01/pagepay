import { Stack } from 'expo-router';

export default function HomeTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="buy-airtime" />
      <Stack.Screen name="buy-data" />
      <Stack.Screen name="buy-electricity" />
      <Stack.Screen name="buy-tv" />
      <Stack.Screen name="buy-recharge-pin" />
      <Stack.Screen name="buy-betting" />
      <Stack.Screen name="buy-isp" />
      <Stack.Screen name="buy-education" />
      <Stack.Screen name="buy-sms" />
      <Stack.Screen name="bills-history" />
      <Stack.Screen name="beneficiaries" />
      <Stack.Screen name="payment-history" />
      <Stack.Screen name="fund-wallet" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="forgot-password-otp" />
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="legal" />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      <Stack.Screen name="animations-playground" />
      <Stack.Screen name="sponsor/register" />
      <Stack.Screen name="sponsor/kyc" />
      <Stack.Screen name="sponsor/dashboard" />
      <Stack.Screen name="sponsor/tasks/create" />
      <Stack.Screen name="sponsor/tasks/[id]" />
      <Stack.Screen name="subscription/success" />
      <Stack.Screen name="pin/verify" />
      <Stack.Screen name="pin/setup" />
      <Stack.Screen name="pin/change" />
    </Stack>
  );
}
