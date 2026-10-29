import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

/**
 * (onboarding) route group. Holds the 5-screen onboarding flow
 * (Earn / Study / Wallet / Streak / Premium). Mounted by `useAuthGate`
 * in `app/_layout.tsx` only for first-launch users (no token, no
 * `onboardingCompleted` flag).
 *
 * The single `index.tsx` renders the full horizontal pager. We keep
 * it as one component for swipe continuity and to share a single
 * `ScrollView` ref for the dot indicator.
 */
export default function OnboardingLayout() {
  return (
    <>
      <StatusBar hidden />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'none',
        }}
      >
        <Stack.Screen name="index" />
      </Stack>
    </>
  );
}
