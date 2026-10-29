import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

type BiometricAuthProps = {
  onSuccess: () => void;
  onFallback?: () => void;
};

export function useBiometricAuth() {
  const [isSupported, setIsSupported] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkBiometricSupport();
  }, []);

  const checkBiometricSupport = async () => {
    try {
      const supported = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setIsSupported(supported);
      setIsEnrolled(enrolled);
    } catch (error) {
      console.error('Biometric check failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const authenticate = useCallback(async () => {
    if (!isSupported || !isEnrolled) {
      return { success: false, error: 'Biometric authentication not available' };
    }

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to access PagePay',
        fallbackLabel: 'Use passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (result.success) {
        return { success: true };
      } else {
        return { success: false, error: result.error || 'Authentication failed' };
      }
    } catch (error) {
      console.error('Biometric auth error:', error);
      return { success: false, error: 'Authentication error' };
    }
  }, [isSupported, isEnrolled]);

  return {
    isSupported,
    isEnrolled,
    isLoading,
    authenticate,
    checkBiometricSupport,
  };
}
