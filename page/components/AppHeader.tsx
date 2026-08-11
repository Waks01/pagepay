import { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PagePay, Fonts } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import NotificationBell from '@/components/NotificationBell';

type Props = {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
};

export default function AppHeader({ title, subtitle, showBack }: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const isNotificationsScreen = pathname.includes('/(tabs)/notifications');

  const handleBackPress = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: tokens.paper,
          borderBottomColor: tokens.border,
          paddingTop: insets.top + 2,
        },
      ]}
    >
      <View style={styles.row}>
        {showBack ? (
          <TouchableOpacity onPress={handleBackPress} style={styles.iconBtn} hitSlop={6}>
            <Ionicons name="arrow-back" size={18} color={tokens.ink} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}

        <View style={styles.titleArea}>
          <Text
            style={[
              styles.title,
              { color: tokens.ink, fontFamily: Fonts.display },
            ]}
            numberOfLines={1}
          >
            {title ?? t('app.name', { defaultValue: 'PagePay' })}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.subtitle, { color: tokens.inkMuted }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        <NotificationBell />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 30,
  },
  iconBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 11,
    marginTop: 0,
  },
});
