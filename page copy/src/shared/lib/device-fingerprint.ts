import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';

const DEVICE_FINGERPRINT_KEY = 'pagepay_device_fingerprint';

export async function getDeviceFingerprint(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_FINGERPRINT_KEY);
    if (stored) return stored;

    const parts = [
      Device.modelName || 'unknown-model',
      Device.manufacturer || 'unknown-mfr',
      Device.osVersion || 'unknown-os',
      String(Device.deviceType ?? 'unknown-type'),
    ];
    const fingerprint = parts.join('|');
    const hash = await hashString(fingerprint);
    await SecureStore.setItemAsync(DEVICE_FINGERPRINT_KEY, hash);
    return hash;
  } catch {
    const fallback = `web-${Date.now()}-${Math.random()}`;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DEVICE_FINGERPRINT_KEY, fallback);
    }
    return fallback;
  }
}

async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
