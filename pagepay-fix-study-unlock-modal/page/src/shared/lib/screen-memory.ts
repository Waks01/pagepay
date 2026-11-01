import { Platform } from 'react-native';

export const LAST_ROUTE_KEY = 'pagepay_last_route';
export const LAST_TAB_KEY = 'pagepay_last_tab';

const isWeb = Platform.OS === 'web';

export async function saveLastRoute(route: string): Promise<void> {
  if (!route || route === '/') return;
  if (Platform.OS === 'web') {
    localStorage.setItem(LAST_ROUTE_KEY, route);
  } else {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(LAST_ROUTE_KEY, route);
  }
}

export async function getLastRoute(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(LAST_ROUTE_KEY);
  }
  const SecureStore = await import('expo-secure-store');
  return await SecureStore.getItemAsync(LAST_ROUTE_KEY);
}

export async function clearLastRoute(): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(LAST_ROUTE_KEY);
  } else {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(LAST_ROUTE_KEY);
  }
}

export async function saveLastTab(tab: string): Promise<void> {
  if (!tab) return;
  if (Platform.OS === 'web') {
    localStorage.setItem(LAST_TAB_KEY, tab);
  } else {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(LAST_TAB_KEY, tab);
  }
}

export async function getLastTab(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(LAST_TAB_KEY);
  }
  const SecureStore = await import('expo-secure-store');
  return await SecureStore.getItemAsync(LAST_TAB_KEY);
}

export async function clearLastTab(): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(LAST_TAB_KEY);
  } else {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(LAST_TAB_KEY);
  }
}
