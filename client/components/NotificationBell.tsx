import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { apiFetch } from '@/src/shared/api/client';
import { onNotification, offNotification } from '@/src/lib/socket';

type Props = {
  onPress?: () => void;
};

export default function NotificationBell({ onPress }: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const router = useRouter();
  const pathname = usePathname();
  const [socketUnreadExtra, setSocketUnreadExtra] = useState(0);

  const isNotificationsScreen = pathname.includes('/(tabs)/notifications');

  const { data: notifData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/notifications?limit=1');
      if (!res.ok) return { unread_count: 0 };
      return res.json();
    },
    staleTime: 1000 * 30,
  });

  const unreadCount = (notifData?.unread_count ?? 0) + socketUnreadExtra;

  useEffect(() => {
    const handler = () => {
      setSocketUnreadExtra((prev) => prev + 1);
    };
    onNotification(handler);
    return () => offNotification(handler);
  }, []);

  const handlePress = useCallback(() => {
    if (onPress) {
      onPress();
    } else if (isNotificationsScreen) {
      router.back();
    } else {
      router.push('/(tabs)/notifications');
    }
  }, [onPress, isNotificationsScreen, router]);

  return (
    <TouchableOpacity onPress={handlePress} style={styles.bellBtn} hitSlop={8}>
      <Ionicons
        name={isNotificationsScreen ? 'notifications' : 'notifications-outline'}
        size={22}
        color={tokens.ink}
      />
      {unreadCount > 0 && (
        <View style={[styles.badge, { backgroundColor: tokens.signal }]}>
          <Text style={[styles.badgeText, { color: '#fff' }]}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
