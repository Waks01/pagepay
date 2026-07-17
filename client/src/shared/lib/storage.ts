import { Platform } from 'react-native';

const TOKEN_KEY = 'pagepay_access_token';
const REFRESH_TOKEN_KEY = 'pagepay_refresh_token';

const isWeb = Platform.OS === 'web';

export async function saveToken(token: string): Promise<void> {
  if (isWeb) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

export async function getToken(): Promise<string | null> {
  if (isWeb) {
    return localStorage.getItem(TOKEN_KEY);
  }
  const SecureStore = await import('expo-secure-store');
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export async function saveRefreshToken(token: string): Promise<void> {
  if (isWeb) {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } else {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  }
}

export async function getRefreshToken(): Promise<string | null> {
  if (isWeb) {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }
  const SecureStore = await import('expo-secure-store');
  return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function clearToken(clearRefresh = true): Promise<void> {
  if (isWeb) {
    localStorage.removeItem(TOKEN_KEY);
    if (clearRefresh) {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  } else {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    if (clearRefresh) {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    }
  }
}

export async function clearRefreshToken(): Promise<void> {
  if (isWeb) {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } else {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  }
}
