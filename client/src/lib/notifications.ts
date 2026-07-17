/**
 * Firebase Cloud Messaging notification service.
 * Handles permission requests, token registration, and notification listening.
 * Phase 3 feature.
 */
import { Platform, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getApp } from '@react-native-firebase/app';
import {
  getMessaging,
  onMessage,
  setBackgroundMessageHandler,
  requestPermission,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import { apiFetch } from '@/src/shared/api/client';

let messaging: ReturnType<typeof getMessaging> | null = null;
let initError: Error | null = null;

async function getFirebaseMessaging() {
  if (!messaging && !initError) {
    try {
      const app = getApp();
      messaging = getMessaging(app);
    } catch (error) {
      console.error('[notifications] Firebase init failed:', error);
      initError = error instanceof Error ? error : new Error(String(error));
    }
  }
  return messaging;
}

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
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
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not already granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Notification permissions denied by user');
      return false;
    }

    // For iOS, also request Firebase messaging authorization
    if (Platform.OS === 'ios') {
      const messagingInstance = await getFirebaseMessaging();
      if (!messagingInstance) {
        console.log('Firebase messaging unavailable, skipping iOS auth request');
        return false;
      }
      const authStatus = await requestPermission(messagingInstance);
      const enabled =
        authStatus === AuthorizationStatus.AUTHORIZED ||
        authStatus === AuthorizationStatus.PROVISIONAL;

      if (!enabled) {
        console.log('iOS Firebase messaging authorization denied');
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Error requesting notification permissions:', error);
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
    if (!messagingInstance) return null;
    const { getToken: getFCMTokenFromModule } = await import('@react-native-firebase/messaging');
    const token = await getFCMTokenFromModule(messagingInstance);
    
    if (!token) {
      console.warn('No FCM token available');
      return null;
    }

    return token;
  } catch (error) {
    console.error('Error getting FCM token:', error);
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
      console.warn('Cannot register: no FCM token available');
      return false;
    }

    // Determine device platform
    const platform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web';

    // Send token to backend
    const response = await apiFetch('/api/v1/notifications/fcm-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        platform,
        device_id: null, // Optional: Can add device ID if needed
      }),
    });

    if (!response.ok) {
      console.error('Failed to register FCM token with backend:', response.status);
      return false;
    }

    console.log('FCM token registered successfully');
    return true;
  } catch (error) {
    console.error('Error registering FCM token:', error);
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
    if (!messagingInstance) {
      return true;
    }
    const { getToken } = await import('@react-native-firebase/messaging');
    const token = await getToken(messagingInstance);
    
    if (!token) {
      return true; // No token to deregister
    }

    const response = await apiFetch(`/api/v1/notifications/fcm-token/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 404) {
      console.error('Failed to deregister FCM token:', response.status);
      return false;
    }

    console.log('FCM token deregistered successfully');
    return true;
  } catch (error) {
    console.error('Error deregistering FCM token:', error);
    return false;
  }
}

/**
 * Set up notification listeners.
 * Should be called once at app startup (e.g., in _layout.tsx).
 */
export function setupNotificationListeners() {
  let unsubscribeForeground: (() => void) | undefined;
  getFirebaseMessaging().then((messagingInstance) => {
    if (!messagingInstance) return;

    unsubscribeForeground = onMessage(messagingInstance, async (remoteMessage) => {
      console.log('Foreground notification received:', remoteMessage);
      
      await Notifications.scheduleNotificationAsync({
        content: {
          title: remoteMessage.notification?.title || 'PagePay',
          body: remoteMessage.notification?.body || '',
          data: remoteMessage.data || {},
          sound: 'default',
        },
        trigger: null,
      });
    });

    setBackgroundMessageHandler(messagingInstance, async (remoteMessage) => {
      console.log('Background notification received:', remoteMessage);
    });
  }).catch((error) => {
    console.error('[notifications] setupNotificationListeners failed:', error);
  });

  // Listen for notification taps (when user opens app from notification)
  const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
    console.log('Notification received while app open:', notification);
  });

  const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log('User tapped notification:', response);
    
    // Handle navigation based on notification data
    const data = response.notification.request.content.data;
    
    if (data?.type === 'study_reminder') {
      // Navigate to study tab
      // router.push('/(tabs)/study');
    } else if (data?.type === 'task_alert') {
      // Navigate to tasks tab
      // router.push('/(tabs)/tasks');
    } else if (data?.type === 'referral_bonus') {
      // Navigate to profile tab
      // router.push('/(tabs)/profile');
    }
    // Add more navigation logic as needed
  });

  // Return cleanup function
  return () => {
    if (unsubscribeForeground) {
      unsubscribeForeground();
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
    return status === 'granted';
  } catch (error) {
    console.error('Error checking notification status:', error);
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
    console.error('Error opening notification settings:', error);
  }
}
