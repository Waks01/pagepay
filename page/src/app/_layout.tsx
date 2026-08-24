import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState, useRef, useCallback } from "react";
import { View, StyleSheet, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  useFonts,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import {
  Fraunces_500Medium,
  Fraunces_600SemiBold,
} from "@expo-google-fonts/fraunces";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/src/shared/lib/queryClient";
import {
  bootstrapPreferences,
  usePreferences,
} from "@/src/shared/lib/preferences";
import { getToken, warmTokenCache } from "@/src/shared/lib/storage";
import { bootstrapCurrentUser } from "@/src/shared/lib/current-user";
import { setOnUnauthenticated, apiFetch, API_URL } from "@/src/shared/api/client";
import "@/src/lib/i18n";
import { SplashOverlay } from "@/components/SplashOverlay";
import { Stack, useRouter, useSegments } from "expo-router";
import { AdSlotProvider } from "@/src/shared/contexts/AdSlot";
import { PaystackProvider } from "expo-paystack";
import Constants from "expo-constants";
import BannerNotification, {
  type BannerNotificationItem,
} from "@/components/BannerNotification";
import {
  connectSocket,
  disconnectSocket,
  onNotification,
  offNotification,
} from "@/src/lib/socket";
import { handleNotificationTap, setupNotificationListeners } from "@/src/lib/notifications";

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: "/(auth)/",
};

const PAYSTACK_PUBLIC_KEY = __DEV__
  ? process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY_TEST ||
    process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY
  : Constants.expoConfig?.extra?.paystackPublicKey ||
    process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });
  const [splashDismissed, setSplashDismissed] = useState(false);
  const isReady = useAuthGate();
  const hydrated = usePreferences((s) => s.hydrated);

  const [bannerNotifications, setBannerNotifications] = useState<BannerNotificationItem[]>([]);

  const handleBannerDismiss = useCallback((id: number) => {
    setBannerNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleBannerPress = useCallback(
    (notification: BannerNotificationItem) => {
      setBannerNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      handleNotificationTap(
        {
          data: notification.data ?? undefined,
          category: notification.category,
        },
        { push: (path) => router.push(path as any), back: () => router.back() },
      );
    },
    [router],
  );

  useEffect(() => {
    if (!isReady) return;

    let cleanup: (() => void) | undefined;

    const initSocket = async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const meRes = await apiFetch("/api/v1/auth/me");
        if (!meRes.ok) return;
        const me = await meRes.json();
        if (me?.id) {
          connectSocket(me.id);
          onNotification((notification) => {
            setBannerNotifications((prev) => {
              const exists = prev.some((n) => n.id === notification.id);
              if (exists) return prev;
              const next = [notification, ...prev];
              if (next.length > 5) next.pop();
              return next;
            });
            setTimeout(() => {
              setBannerNotifications((prev) =>
                prev.filter((n) => n.id !== notification.id),
              );
            }, 8000);
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
            queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
          });
        }
      } catch (error) {
        console.error("Failed to init socket for banners:", error);
      }
    };

    initSocket();

    return () => {
      if (cleanup) cleanup();
      disconnectSocket();
    };
  }, [isReady]);

  useEffect(() => {
    void bootstrapPreferences();
    // Eagerly load the auth token into memory so the first
    // apiFetch on any screen is a memory read, not a bridge
    // roundtrip to expo-secure-store. Without this, every tab
    // switch waits on multiple secure-store reads before its
    // useQuery hooks can issue their network requests.
    warmTokenCache();
  }, []);

  useEffect(() => {
    const cleanup = setupNotificationListeners();
    return cleanup;
  }, []);

  if (!fontsLoaded || !hydrated || !isReady) {
    return (
      <View style={styles.splashContainer}>
        {!splashDismissed && (
          <SplashOverlay onDone={() => setSplashDismissed(true)} />
        )}
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AdSlotProvider>
          <PaystackProvider publicKey={PAYSTACK_PUBLIC_KEY}>
            {!isReady || !fontsLoaded ? (
              <View style={{ flex: 1 }}>
                {!splashDismissed ? (
                  <SplashOverlay onDone={() => setSplashDismissed(true)} />
                ) : null}
              </View>
            ) : (
              <>
                <BannerNotification
                  notifications={bannerNotifications}
                  onDismiss={handleBannerDismiss}
                  onPress={handleBannerPress}
                />
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(onboarding)" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(app)" />
                </Stack>
              </>
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

  // Register the unauthenticated callback so apiFetch can redirect to login on 401
  useEffect(() => {
    setOnUnauthenticated(() => {
      const currentSegment = segments[0];
      // Only redirect if we're in the app (not already on auth/onboarding screens)
      if (currentSegment === "(app)") {
        router.replace("/(auth)/");
      }
    });
  }, [router, segments]);

  useEffect(() => {
    if (!hydrated) return;

    (async () => {
      try {
        const token = await getToken();
        const inOnboarding = segments[0] === "(onboarding)";
        const inAuth = segments[0] === "(auth)";
        const inApp = segments[0] === "(app)";

        if (!token) {
          // No token: redirect to onboarding or login
          if (!onboardingCompleted && !inOnboarding) {
            router.replace("/(onboarding)/");
          } else if (onboardingCompleted && !inAuth) {
            router.replace("/(auth)/");
          }
        } else {
          // Has token: redirect to app or bootstrap user
          if (inAuth || inOnboarding) {
            router.replace("/home");
          } else if (inApp || segments.length === 0) {
            // Already in app or no segment yet, bootstrap user data
            void bootstrapCurrentUser();
          }
        }
      } catch (e) {
        console.error("Auth gate failed", e);
      } finally {
        setIsReady(true);
      }
    })();
  }, [hydrated, router, onboardingCompleted, segments]);

  return isReady;
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
  },
});
