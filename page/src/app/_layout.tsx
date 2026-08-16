import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { Fraunces_500Medium, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/src/shared/lib/queryClient';
import { bootstrapPreferences, usePreferences } from '@/src/shared/lib/preferences';
import { getToken, warmTokenCache } from '@/src/shared/lib/storage';
import { bootstrapCurrentUser } from '@/src/shared/lib/current-user';
import '@/src/lib/i18n';
import { SplashOverlay } from '@/components/SplashOverlay';
import { Stack, useRouter, useSegments } from 'expo-router';
import { AdSlotProvider } from '@/src/shared/contexts/AdSlot';
import { PaystackProvider } from 'expo-paystack';
import Constants from 'expo-constants';

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '/(auth)/',
};

const PAYSTACK_PUBLIC_KEY = __DEV__
  ? process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY_TEST || process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY
  : Constants.expoConfig?.extra?.paystackPublicKey || process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });
  const [splashDismissed, setSplashDismissed] = useState(false);
  const isReady = useAuthGate();
  const hydrated = usePreferences((s) => s.hydrated);

  useEffect(() => {
    void bootstrapPreferences();
    // Eagerly load the auth token into memory so the first
    // apiFetch on any screen is a memory read, not a bridge
    // roundtrip to expo-secure-store. Without this, every tab
    // switch waits on multiple secure-store reads before its
    // useQuery hooks can issue their network requests.
    warmTokenCache();
  }, []);

  if (!fontsLoaded || !hydrated || !isReady) {
    return (
      <View style={styles.splashContainer}>
        {!splashDismissed && <SplashOverlay onDone={() => setSplashDismissed(true)} />}
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AdSlotProvider>
        <PaystackProvider publicKey={PAYSTACK_PUBLIC_KEY}>
        {!isReady || !fontsLoaded ? (
          <View style={{ flex: 1 }}>
            {!splashDismissed ? (
              <SplashOverlay onDone={() => setSplashDismissed(true)} />
            ) : null}
          </View>
        ) : (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
          </Stack>
        )}
        </PaystackProvider>
        </AdSlotProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function useAuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const [isReady, setIsReady] = useState(false);
  const hydrated = usePreferences((s) => s.hydrated);
  const onboardingCompleted = usePreferences((s) => s.onboardingCompleted);

  useEffect(() => {
    if (!hydrated) return;

    (async () => {
      try {
        const token = await getToken();
        const inOnboarding = segments[0] === '(onboarding)';
        const inAuth = segments[0] === '(auth)';

        if (!token) {
          if (!onboardingCompleted && !inOnboarding) {
            router.replace('/(onboarding)/');
          } else if (onboardingCompleted && !inAuth) {
            router.replace('/(auth)/');
          }
        } else if (token && (inAuth || inOnboarding)) {
          router.replace('/home');
        } else if (token) {
          // Token is present and we're inside the (app) group — load
          // the current user once into the global store so every tab
          // can read it as a pure memory access. Without this, each
          // tab would re-fetch /auth/me on mount and the user would
          // see "checking auth" on every tab switch.
          void bootstrapCurrentUser();
        }
      } catch (e) {
        console.error('Auth gate failed', e);
      } finally {
        setIsReady(true);
      }
    })();
  }, [hydrated, segments, router, onboardingCompleted]);

  return isReady;
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
  },
});
