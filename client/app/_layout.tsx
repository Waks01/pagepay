import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/src/shared/lib/queryClient';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useFonts, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { View } from 'react-native';
import Constants from 'expo-constants';
import 'react-native-reanimated';

import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { useAdsConfig } from '@/src/shared/hooks/use-ads-config';
import { bootstrapPreferences, usePreferences } from '@/src/shared/lib/preferences';
import { getToken } from '@/src/shared/lib/storage';
import { getLastTab, clearLastTab } from '@/src/shared/lib/screen-memory';
import { initializeAdMob } from '@/src/shared/lib/ads-native';
import { setOnUnauthenticated, apiFetch } from '@/src/shared/api/client';
import { setupNotificationListeners, registerFCMToken, handleNotificationTap } from '@/src/lib/notifications';
import { connectSocket, disconnectSocket, onNotification } from '@/src/lib/socket';
import { SplashOverlay } from '@/components/SplashOverlay';
import { AdSlotProvider } from '@/src/shared/contexts/AdSlot';
import BannerNotification, { type BannerNotificationItem } from '@/src/components/BannerNotification';
import { PaystackProvider } from 'expo-paystack';
import '@/src/lib/i18n';

const PAYSTACK_PUBLIC_KEY = __DEV__
  ? process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY_TEST || process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY
  : Constants.expoConfig?.extra?.paystackPublicKey || process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY;

export const unstable_settings = {
  anchor: '/(auth)/',
};

const VALID_TABS = ['index', 'catalog', 'study', 'wallet', 'notifications', 'tasks', 'community', 'profile', 'premium'] as const;
type ValidTab = (typeof VALID_TABS)[number];

function useAuthGate() {
  const segments = useSegments();
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const onboardingCompleted = usePreferences((s) => s.onboardingCompleted);
  const hydrated = usePreferences((s) => s.hydrated);
  const hasRestoredTab = useRef(false);

  // Routes that are reachable while unauthenticated. These are
  // non-auth pages that we still want to show — onboarding, the
  // password-reset flow, and legal pages (Terms / Privacy Policy).
  // The latter is mandatory: a fresh user creating an account MUST
  // be able to read the terms before tapping the "I agree" checkbox,
  // and the auth gate must NOT bounce them back to login when they
  // do. v3 §auth.legal — Terms/Privacy must be reachable pre-login.
  const isPublicRoute = (seg: string | undefined) =>
    seg === '(onboarding)' ||
    seg === '(auth)' ||
    seg === 'forgot-password' ||
    seg === 'forgot-password-otp' ||
    seg === 'reset-password' ||
    seg === 'legal';

  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      const token = await getToken();
      const inAuthGroup = segments[0] === '(auth)';
      const inOnboardingGroup = segments[0] === '(onboarding)';
      const inPublic = isPublicRoute(segments[0]);

      if (!token) {
        if (!onboardingCompleted && !inOnboardingGroup) {
          (router as any).replace('/(onboarding)');
        } else if (onboardingCompleted && !inAuthGroup && !inPublic) {
          (router as any).replace('/(auth)/');
        }
      } else if (token && inAuthGroup && segments[1] !== 'verify-email-code') {
        const savedTab = await getLastTab();
        const target = (VALID_TABS as readonly string[]).includes(savedTab as ValidTab)
          ? `/(tabs)/${savedTab}`
          : '/(tabs)';
        (router as any).replace(target);
      } else if (token && segments[0] === '(tabs)' && !hasRestoredTab.current) {
        hasRestoredTab.current = true;
        const currentTab = (segments[1] as ValidTab) || 'index';
        if (currentTab === 'index') {
          const savedTab = await getLastTab();
          if ((VALID_TABS as readonly string[]).includes(savedTab as ValidTab) && savedTab !== 'index') {
            (router as any).replace(`/(tabs)/${savedTab}`);
          }
        }
      }
      setIsReady(true);
    })();
  }, [hydrated, segments, router, onboardingCompleted]);

  // Register the global 401 → login redirect so apiFetch can
  // redirect the user when the server rejects their token.
  // Only redirect if we're NOT already on an auth/onboarding/public
  // screen — otherwise login/register error responses cause a blank
  // refresh instead of showing the error to the user. Public routes
  // (legal, forgot-password) are also exempt so a 401 from
  // publicApiFetch on /legal doesn't bounce the user.
  useEffect(() => {
    setOnUnauthenticated(() => {
      if (!isPublicRoute(segments[0])) {
        (router as any).replace('/(auth)/');
      }
    });
  }, [router, segments]);

  return isReady;
}

/** Ad SDK bootstrap. Mounts the native AdMob SDK (via
 *  `react-native-google-mobile-ads`) and warms the
 *  `useAdsConfig` cache so the rest of the app can resolve
 *  unit IDs without a render-blocking fetch.
 *
 *  The init is fire-and-forget: a failed native init just
 *  means ads are disabled and the MockAdModal takes over.
 *  The config fetch is non-blocking too — the hooks return
 *  `data = undefined` until the request resolves and the
 *  ad components fall back to the placeholder.
 *
 *  This hook is mounted at the root so the SDK is warm by
 *  the time the catalog renders its first page. The AdMob
 *  SDK's `initialize()` is idempotent so re-mounts on
 *  theme / auth changes are safe. */
function AdsBootstrapComponent() {
  useAdsConfig();
  // Kick off the native init. We don't await — the layout
  // must render immediately and the SDK is happy to finish
  // initializing in the background.
  useEffect(() => {
    initializeAdMob().catch(() => undefined);
  }, []);
  return null;
}

export default function RootLayout() {
  const colorScheme = useEffectiveScheme();
  const isReady = useAuthGate();
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  // Boot preferences once. The auth gate's `hydrated` selector means
  // it won't run until this resolves; the SplashOverlay fills the
  // gap so the user sees motion instead of a blank screen.
  useEffect(() => {
    const initApp = async () => {
      await bootstrapPreferences();
      
      // Initialize i18n with user's saved language preference
      const i18n = await import('@/src/lib/i18n');
      const prefs = usePreferences.getState();
      if (prefs.language && prefs.language !== 'en') {
        await i18n.default.changeLanguage(prefs.language);
      }
    };
    void initApp();
  }, []);

  // Initialize Firebase Cloud Messaging, notification listeners, and Socket.IO
  useEffect(() => {
    if (!isReady) return;

    let cleanup: (() => void) | undefined;

    const initNotifications = async () => {
      cleanup = setupNotificationListeners();
      const token = await getToken();
      if (token) {
        await registerFCMToken();
      }
    };

    const initSocket = async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const res = await apiFetch('/api/v1/auth/me');
        if (!res.ok) return;
        const me = await res.json();
        if (me?.id) {
          connectSocket(me.id);
          onNotification((notification) => {
            console.log('In-app notification:', notification);
            queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
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
          });
        }
      } catch (error) {
        console.error('Failed to init socket:', error);
      }
    };

    initNotifications();
    initSocket();

    const initCrashlytics = async () => {
      try {
        // Lazy-require Firebase so dev-client / Expo Go builds without
        // the native modules don't blow up at module-evaluation time.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const appMod = require('@react-native-firebase/app');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const crashlyticsMod = require('@react-native-firebase/crashlytics');
        if (!crashlyticsMod?.getCrashlytics) return;
        const { getCrashlytics, setCrashlyticsCollectionEnabled } = crashlyticsMod;
        const crashlytics = getCrashlytics();
        if (!crashlytics) return;
        await setCrashlyticsCollectionEnabled(crashlytics, true);
        console.log('Crashlytics initialized');
      } catch (error) {
        console.error('Failed to init Crashlytics:', error);
      }
    };

    initCrashlytics();

    return () => {
      if (cleanup) cleanup();
      disconnectSocket();
    };
  }, [isReady]);

  // Splash overlay state. Native splash (expo-splash-screen) shows first
  // as a static image while JS loads. Once fonts are loaded and auth are
  // ready, we show the animated SplashOverlay which hides the native splash
  // and runs the full animation sequence. When complete, it calls onDone
  // to dismiss and reveal the app.
  const [splashDismissed, setSplashDismissed] = useState(false);

  // In-app banner notifications
  const [bannerNotifications, setBannerNotifications] = useState<BannerNotificationItem[]>([]);

  const handleBannerDismiss = useCallback((id: number) => {
    setBannerNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleBannerPress = useCallback((notification: BannerNotificationItem) => {
    setBannerNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    handleNotificationTap({
      data: notification.data ?? undefined,
      category: notification.category,
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AdsBootstrapComponent />
        <AdSlotProvider>
          <BannerNotification
            notifications={bannerNotifications}
            onDismiss={handleBannerDismiss}
            onPress={handleBannerPress}
          />
          <PaystackProvider publicKey={PAYSTACK_PUBLIC_KEY}>
            {!isReady || !fontsLoaded ? (
              <View style={{ flex: 1 }}>
                {!splashDismissed ? (
                  <SplashOverlay onDone={() => setSplashDismissed(true)} />
                ) : null}
              </View>
            ) : (
              <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="reader/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="book/[id]" options={{ headerShown: false, title: 'Book' }} />
        <Stack.Screen name="study/chat/[id]" options={{ headerShown: false, title: 'Study Chat' }} />
        <Stack.Screen name="study/exam-mode" options={{ headerShown: false, title: 'Exam Mode' }} />
        <Stack.Screen name="study/srs-dashboard" options={{ headerShown: false, title: 'Review Dashboard' }} />
        <Stack.Screen name="tasks/[id]" options={{ headerShown: false, title: 'Task Detail' }} />
        <Stack.Screen name="tasks/[id]/complete" options={{ headerShown: false, title: 'Submit Proof' }} />
        <Stack.Screen name="tasks/profile" options={{ headerShown: false, title: 'Worker Profile' }} />
        <Stack.Screen name="tasks/history" options={{ headerShown: false, title: 'Submission History' }} />
        <Stack.Screen name="sponsor/register" options={{ headerShown: false, title: 'Become a Sponsor' }} />
        <Stack.Screen name="sponsor/kyc" options={{ headerShown: false, title: 'KYC Verification' }} />
        <Stack.Screen name="sponsor/dashboard" options={{ headerShown: false, title: 'Sponsor Dashboard' }} />
        <Stack.Screen name="sponsor/tasks/create" options={{ headerShown: false, title: 'Create Task' }} />
        <Stack.Screen name="sponsor/tasks/[id]" options={{ headerShown: false, title: 'Task Submissions' }} />
         <Stack.Screen name="fund-wallet" options={{ headerShown: false, title: 'Fund Wallet' }} />
         <Stack.Screen name="fund-wallet/success" options={{ headerShown: false, title: 'Deposit Success' }} />
        <Stack.Screen name="billing/history" options={{ headerShown: false, title: 'Billing History' }} />
        <Stack.Screen name="billing/subscription" options={{ headerShown: false, title: 'Manage Subscription' }} />
        <Stack.Screen name="subscription/success" options={{ headerShown: false, title: 'Payment Success' }} />
        <Stack.Screen name="forgot-password" options={{ headerShown: false, title: 'Reset Password' }} />
        <Stack.Screen name="forgot-password-otp" options={{ headerShown: false, title: 'Enter OTP' }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false, title: 'New Password' }} />
        <Stack.Screen name="legal" options={{ headerShown: false, title: 'Legal' }} />
        <Stack.Screen name="notification/[id]" options={{ headerShown: false, title: 'Notification' }} />
         <Stack.Screen name="buy-airtime" options={{ headerShown: false, title: 'Buy Airtime' }} />
         <Stack.Screen name="beneficiaries" options={{ headerShown: false, title: 'Beneficiaries' }} />
        <Stack.Screen name="buy-data" options={{ headerShown: false, title: 'Buy Data' }} />
        <Stack.Screen name="buy-electricity" options={{ headerShown: false, title: 'Buy Electricity' }} />
        <Stack.Screen name="buy-tv" options={{ headerShown: false, title: 'Buy TV Subscription' }} />
        <Stack.Screen name="buy-recharge-pin" options={{ headerShown: false, title: 'Buy Recharge Pin' }} />
        <Stack.Screen name="buy-betting" options={{ headerShown: false, title: 'Betting' }} />
        <Stack.Screen name="buy-isp" options={{ headerShown: false, title: 'ISP Data' }} />
        <Stack.Screen name="buy-education" options={{ headerShown: false, title: 'Result Checker' }} />
        <Stack.Screen name="buy-sms" options={{ headerShown: false, title: 'Bulk SMS' }} />
        <Stack.Screen name="bills-history" options={{ headerShown: false, title: 'Bills History' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        <Stack.Screen name="pin/verify" options={{ headerShown: false, title: 'Enter PIN' }} />
        <Stack.Screen name="pin/setup" options={{ headerShown: false, title: 'Set PIN' }} />
        <Stack.Screen name="pin/change" options={{ headerShown: false, title: 'Change PIN' }} />
        </Stack>
      )}
          </PaystackProvider>
        </AdSlotProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

