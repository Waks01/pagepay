import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import * as Splash from "expo-splash-screen";
import { useEffect, useState, useCallback } from "react";
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
import { setOnUnauthenticated, apiFetch } from "@/src/shared/api/client";
import "@/src/lib/i18n";
import { SplashOverlay } from "@/components/SplashOverlay";
import { Stack, useRouter, type Href } from "expo-router";
import { PaystackProvider } from "expo-paystack";
import Constants from "expo-constants";
import BannerNotification, {
  type BannerNotificationItem,
} from "@/components/BannerNotification";
import {
  connectSocket,
  disconnectSocket,
  onNotification,
} from "@/src/lib/socket";
import {
  handleNotificationTap,
  setupNotificationListeners,
} from "@/src/lib/notifications";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { initAds } from "@/src/shared/lib/ads";

Splash.preventAutoHideAsync();

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
  const hydrated = usePreferences((s) => s.hydrated);
  const onboardingCompleted = usePreferences((s) => s.onboardingCompleted);

  // Session state - the ONLY source of truth for authentication
  const [session, setSession] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [bannerNotifications, setBannerNotifications] = useState<
    BannerNotificationItem[]
  >([]);

  const handleBannerDismiss = useCallback((id: number) => {
    setBannerNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleBannerPress = useCallback(
    (notification: BannerNotificationItem) => {
      setBannerNotifications((prev) =>
        prev.filter((n) => n.id !== notification.id),
      );
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

  // Load auth session ONCE on mount
  useEffect(() => {
    if (!hydrated) return;

    (async () => {
      try {
        const token = await getToken();
        setSession(token);

        // Bootstrap user if logged in
        if (token) {
          await bootstrapCurrentUser();
        }
      } catch (e) {
        console.error("Auth initialization failed", e);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, [hydrated]);

  // Socket connection
  useEffect(() => {
    if (!session) return;

    const initSocket = async () => {
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
            queryClient.invalidateQueries({
              queryKey: ["notifications-unread-count"],
            });
          });
        }
      } catch (error) {
        console.error("Failed to init socket for banners:", error);
      }
    };

    initSocket();

    return () => {
      disconnectSocket();
    };
  }, [session]);

  useEffect(() => {
    void bootstrapPreferences();
    warmTokenCache();
  }, []);

  useEffect(() => {
    void initAds();
  }, []);

  useEffect(() => {
    const cleanup = setupNotificationListeners();
    return cleanup;
  }, []);

  // Register 401 handler - setSession to null to trigger guard redirect
  useEffect(() => {
    setOnUnauthenticated(() => {
      setSession(null);
    });
  }, []);

  if (!fontsLoaded || !hydrated || authLoading) {
    return (
      <View style={styles.splashContainer}>
        {!splashDismissed && (
          <SplashOverlay onDone={() => setSplashDismissed(true)} />
        )}
      </View>
    );
  }

  const isAuthenticated = !!session;
  const needsOnboarding = !onboardingCompleted;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <PaystackProvider publicKey={PAYSTACK_PUBLIC_KEY}>
            <BannerNotification
              notifications={bannerNotifications}
              onDismiss={handleBannerDismiss}
              onPress={handleBannerPress}
            />
            <Stack screenOptions={{ headerShown: false }}>
              {/* Onboarding: shown to unauthenticated users who haven't completed onboarding */}
              <Stack.Protected guard={!isAuthenticated && needsOnboarding}>
                <Stack.Screen name="(onboarding)" />
              </Stack.Protected>

              {/* Auth screens: shown to unauthenticated users who completed onboarding */}
              <Stack.Protected guard={!isAuthenticated && !needsOnboarding}>
                <Stack.Screen name="(auth)" />
              </Stack.Protected>

              {/* App screens: shown only to authenticated users */}
              <Stack.Protected guard={isAuthenticated}>
                <Stack.Screen name="(app)" />
              </Stack.Protected>

              {/* Verify email: accessible from both auth and app */}
              <Stack.Screen
                name="verify-email"
                options={{ presentation: "modal" }}
              />
            </Stack>
          </PaystackProvider>
          <StatusBar style="auto" />
        </GestureHandlerRootView>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
  },
});
