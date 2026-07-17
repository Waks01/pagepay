import { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import LoginScreen from './LoginForm';
import RegisterScreen from './RegisterForm';
import { AuthTabSwitch, SuccessRedirect } from '@/components/animations';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

/**
 * Unified auth screen with tab switching.
 *
 * Tab switches run a 150ms fade-out → 250ms fade-in crossfade. The fade
 * timing is unchanged; the previous `setTimeout` is replaced with a
 * mounted-ref guard so navigating away mid-transition does not warn
 * "setState on unmounted component".
 */
export default function AuthScreen() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const contentOpacity = useSharedValue(1);
  const contentScale = useSharedValue(1);
  const pendingTab = useRef<typeof activeTab | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleTabChange = (tab: 'login' | 'register') => {
    if (tab === activeTab) return;

    contentOpacity.value = withTiming(0, {
      duration: 150,
      easing: Easing.out(Easing.cubic),
    });
    contentScale.value = withTiming(0.95, {
      duration: 150,
      easing: Easing.out(Easing.cubic),
    });

    pendingTab.current = tab;
    setTimeout(() => {
      if (!isMounted.current) return;
      const next = pendingTab.current;
      pendingTab.current = null;
      if (next) setActiveTab(next);

      contentOpacity.value = withTiming(1, {
        duration: 250,
        easing: Easing.out(Easing.cubic),
      });
      contentScale.value = withTiming(1, {
        duration: 250,
        easing: Easing.out(Easing.cubic),
      });
    }, 150);
  };

  const handleGoogleSignIn = async () => {
    Alert.alert('Coming soon', 'Google Sign-In will be available once OAuth2 credentials are configured.');
  };

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ scale: contentScale.value }],
  }));

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />

      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 24 }}>
          <AuthTabSwitch activeTab={activeTab} onTabChange={handleTabChange} />

          <Animated.View style={[{ flex: 1 }, contentStyle]}>
            {activeTab === 'login' ? (
              <LoginScreen onSwitchToRegister={() => handleTabChange('register')} />
            ) : (
              <RegisterScreen onSwitchToLogin={() => handleTabChange('login')} />
            )}
          </Animated.View>

          <View style={styles.socialWrap}>
            <View style={styles.divider}>
              <View style={[styles.dividerLine, { backgroundColor: tokens.border }]} />
              <Text style={[styles.dividerText, { color: tokens.inkMuted }]}>or</Text>
              <View style={[styles.dividerLine, { backgroundColor: tokens.border }]} />
            </View>

             <TouchableOpacity
               style={[styles.googleButton, { backgroundColor: tokens.card, borderColor: tokens.border }]}
               onPress={handleGoogleSignIn}
               activeOpacity={0.7}
             >
               <Ionicons name="logo-google" size={20} color={tokens.ink} />
               <Text style={[styles.googleButtonText, { color: tokens.ink }]}>Continue with Google</Text>
             </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  socialWrap: {
    gap: 12,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: '500',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  googleButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
