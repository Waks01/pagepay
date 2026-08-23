/**
 * Firebase Cloud Messaging notification service.
 * Handles permission requests, token registration, and notification listening.
 * Phase 3 feature.
 *
 * Firebase is loaded lazily via require() so the absence of the native
 * modules (e.g. Expo Go or a dev-client build without Firebase) doesn't
 * crash JS bundle evaluation. Top-level static imports of
 * `@react-native-firebase/*` would otherwise trigger the native-module
 * registry at module load and throw a synchronous error.
 */
import { Platform, Linking } from "react-native";
import * as Notifications from "expo-notifications";
import { apiFetch } from "@/src/shared/api/client";
import { router } from "expo-router";

type MessagingInstance = unknown;

let messaging: MessagingInstance | null = null;
let initError: Error | null = null;
let messagingMod: any = null;

async function getFirebaseMessaging() {
  if (messaging || initError) return messaging;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appMod = require("@react-native-firebase/app");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    messagingMod = require("@react-native-firebase/messaging");
    const app = appMod.getApp?.();
    if (!app) {
      initError = new Error("Firebase app not available");
      return null;
    }
    messaging = messagingMod.getMessaging(app);
  } catch (error) {
    console.error("[notifications] Firebase init failed:", error);
    initError = error instanceof Error ? error : new Error(String(error));
  }
  return messaging;
}

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request notification permissions from the user.
 * Returns true if granted, false otherwise.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    // Check if permissions are already granted
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not already granted
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Notification permissions denied by user");
      return false;
    }

    // For iOS, also request Firebase messaging authorization
    if (Platform.OS === "ios") {
      const messagingInstance = await getFirebaseMessaging();
      if (!messagingInstance || !messagingMod) {
        console.log(
          "Firebase messaging unavailable, skipping iOS auth request",
        );
        return false;
      }
      const authStatus =
        await messagingMod.requestPermission(messagingInstance);
      const enabled =
        authStatus === messagingMod.AuthorizationStatus.AUTHORIZED ||
        authStatus === messagingMod.AuthorizationStatus.PROVISIONAL;

      if (!enabled) {
        console.log("iOS Firebase messaging authorization denied");
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("Error requesting notification permissions:", error);
    return false;
  }
}

/**
 * Get the FCM token for this device.
 * Returns the token string or null if unavailable.
 */
export async function getFCMToken(): Promise<string | null> {
  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) {
      return null;
    }
    const messagingInstance = await getFirebaseMessaging();
    if (!messagingInstance || !messagingMod) return null;
    const token = await messagingMod.getToken(messagingInstance);

    if (!token) {
      console.warn("No FCM token available");
      return null;
    }

    return token;
  } catch (error) {
    console.error("Error getting FCM token:", error);
    return null;
  }
}

/**
 * Register FCM token with backend.
 * Should be called after login and whenever token refreshes.
 */
export async function registerFCMToken(): Promise<boolean> {
  try {
    const token = await getFCMToken();

    if (!token) {
      console.warn("Cannot register: no FCM token available");
      return false;
    }

    // Determine device platform
    const platform =
      Platform.OS === "android"
        ? "android"
        : Platform.OS === "ios"
          ? "ios"
          : "web";

    // Send token to backend
    const response = await apiFetch("/api/v1/notifications/fcm-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token,
        platform,
        device_id: null, // Optional: Can add device ID if needed
      }),
    });

    if (!response.ok) {
      console.error(
        "Failed to register FCM token with backend:",
        response.status,
      );
      return false;
    }

    console.log("FCM token registered successfully");
    return true;
  } catch (error) {
    console.error("Error registering FCM token:", error);
    return false;
  }
}

/**
 * Deregister FCM token from backend.
 * Should be called on logout.
 */
export async function deregisterFCMToken(): Promise<boolean> {
  try {
    const messagingInstance = await getFirebaseMessaging();
    if (!messagingInstance || !messagingMod) {
      return true;
    }
    const token = await messagingMod.getToken(messagingInstance);

    if (!token) {
      return true; // No token to deregister
    }

    const response = await apiFetch(
      `/api/v1/notifications/fcm-token/${encodeURIComponent(token)}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok && response.status !== 404) {
      console.error("Failed to deregister FCM token:", response.status);
      return false;
    }

    console.log("FCM token deregistered successfully");
    return true;
  } catch (error) {
    console.error("Error deregistering FCM token:", error);
    return false;
  }
}

/**
 * Set up notification listeners.
 * Should be called once at app startup (e.g., in _layout.tsx).
 */
export function setupNotificationListeners() {
  let unsubscribeForeground: (() => void) | undefined;
  let unsubscribeTokenRefresh: (() => void) | undefined;

  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      sound: null, // Use system default sound instead of custom 'default'
      showBadge: true,
      bypassDnd: false,
    }).catch((error) => {
      console.error(
        "[notifications] Failed to create notification channel:",
        error,
      );
    });
  }

  getFirebaseMessaging()
    .then((messagingInstance) => {
      if (!messagingInstance || !messagingMod) return;

      unsubscribeTokenRefresh = messagingMod.onTokenRefresh(
        messagingInstance,
        async (newToken: unknown) => {
          console.log("FCM token refreshed, re-registering:", newToken);
          try {
            await registerFCMToken();
          } catch (error) {
            console.error("Failed to re-register refreshed FCM token:", error);
          }
        },
      );

      unsubscribeForeground = messagingMod.onMessage(
        messagingInstance,
        async (remoteMessage: any) => {
          console.log("Foreground notification received:", remoteMessage);

          await Notifications.scheduleNotificationAsync({
            content: {
              title: remoteMessage.notification?.title || "PagePay",
              body: remoteMessage.notification?.body || "",
              data: remoteMessage.data || {},
              sound: null, // Use system default sound
            },
            trigger: null,
          });
        },
      );

      messagingMod.setBackgroundMessageHandler(
        messagingInstance,
        async (remoteMessage: unknown) => {
          console.log("Background notification received:", remoteMessage);
        },
      );
    })
    .catch((error) => {
      console.error(
        "[notifications] setupNotificationListeners failed:",
        error,
      );
    });

  // Listen for notification taps (when user opens app from notification)
  const notificationListener = Notifications.addNotificationReceivedListener(
    (notification) => {
      console.log("Notification received while app open:", notification);
    },
  );

  const responseListener =
    Notifications.addNotificationResponseReceivedListener((response) => {
      console.log("User tapped notification:", response);

      // Handle navigation based on notification data
      const data = response.notification.request.content.data;

      if (data?.type === "study_reminder") {
        router.push("/study" as any);
      } else if (data?.type === "task_alert") {
        router.push("/tasks" as any);
      } else if (data?.type === "referral_bonus") {
        router.push("/profile" as any);
      } else if (
        data?.type === "wallet_update" ||
        data?.type === "payment_initiated" ||
        data?.type === "payment_success"
      ) {
        router.push("/wallet" as any);
      } else if (
        data?.type === "subscription_initiated" ||
        data?.type === "subscription_success"
      ) {
        router.push("/premium" as any);
      } else if (data?.type === "ad_reward") {
        router.push("/" as any);
      }
    });

  // Return cleanup function
  return () => {
    if (unsubscribeForeground) {
      unsubscribeForeground();
    }
    if (unsubscribeTokenRefresh) {
      unsubscribeTokenRefresh();
    }
    notificationListener.remove();
    responseListener.remove();
  };
}

/**
 * Check if notifications are enabled for the app.
 */
export async function areNotificationsEnabled(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted";
  } catch (error) {
    console.error("Error checking notification status:", error);
    return false;
  }
}

/**
 * Open device notification settings for this app.
 * Useful when user wants to enable notifications after denying.
 */
export async function openNotificationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (error) {
    console.error("Error opening notification settings:", error);
  }
}

export type NotificationTapData = {
  type?: string;
  service?: string;
  points?: string;
  category?: string;
};

export function handleNotificationTap(
  notification: {
    data?: NotificationTapData | Record<string, unknown>;
    category?: string | null;
  },
  navigation?: { push: (path: string) => void; back: () => void },
) {
  const data = (notification.data || {}) as NotificationTapData;
  const category = notification.category;
  const nav = navigation || router;

  if (data.type === "study_reminder") {
    nav.push("/study" as any);
  } else if (data.type === "task_alert") {
    nav.push("/tasks" as any);
  } else if (data.type === "referral_bonus") {
    nav.push("/profile" as any);
  } else if (
    data.type === "wallet_update" ||
    data.type === "payment_initiated" ||
    data.type === "payment_success"
  ) {
    nav.push("/wallet" as any);
  } else if (
    data.type === "subscription_initiated" ||
    data.type === "subscription_success"
  ) {
    nav.push("/premium" as any);
  } else if (data.type === "ad_reward") {
    nav.push("/" as any);
  } else if (category === "wallet_updates") {
    nav.push("/wallet" as any);
  } else {
    nav.push("/notifications" as any);
  }
}
