import { Tabs, useRouter } from 'expo-router';
import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Modal,
  Animated,
  Pressable,
} from 'react-native';
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { apiFetch } from '@/src/shared/api/client';
import { EmailVerificationGate } from '@/src/components/EmailVerificationGate';

type Tokens = (typeof PagePay)['light'];
type DrawerItem = {
  name: string;
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  descKey: string;
  badge?: number;
};

const VISIBLE_TABS = ['index', 'catalog', 'study', 'wallet'];
type VisibleTab = (typeof VISIBLE_TABS)[number];

const DRAWER_ITEMS: DrawerItem[] = [
  { name: 'notifications', labelKey: 'drawer.notifications_label', icon: 'notifications-outline', descKey: 'drawer.notifications_desc' },
  { name: 'tasks', labelKey: 'drawer.tasks_label', icon: 'briefcase', descKey: 'drawer.tasks_desc' },
  { name: 'community', labelKey: 'drawer.community_label', icon: 'people', descKey: 'drawer.community_desc' },
  { name: 'profile', labelKey: 'drawer.profile_label', icon: 'person-circle', descKey: 'drawer.profile_desc' },
  { name: 'premium', labelKey: 'drawer.premium_label', icon: 'diamond', descKey: 'drawer.premium_desc' },
];

export default function TabLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showEmailGate, setShowEmailGate] = useState(false);
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) return null;
      return res.json();
    },
  });

  useEffect(() => {
    if (me && !me.email_verified && me.email) {
      setShowEmailGate(true);
    }
  }, [me]);

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: tokens.mint,
          tabBarInactiveTintColor: tokens.inkMuted,
          tabBarStyle: {
            backgroundColor: tokens.paper,
            borderTopColor: tokens.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            shadowColor: '#000',
            shadowOpacity: 0.04,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: -2 },
            elevation: 6,
            display: showEmailGate ? 'none' : 'flex',
          },
          tabBarLabelStyle: {
            fontSize: 11,
            lineHeight: 14,
            letterSpacing: 0.2,
            fontFamily: 'SpaceGrotesk_500Medium',
          },
        }}
        tabBar={(props) => (
          <CustomTabBar
            state={props.state}
            descriptors={props.descriptors}
            navigation={props.navigation}
            tokens={tokens}
            onMorePress={() => setDrawerOpen(true)}
            isMoreActive={!VISIBLE_TABS.includes(props.state.routes[props.state.index]?.name as string)}
          />
        )}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.home'),
            tabBarIcon: ({ color, size, focused }) => (
              <TabIcon name="home" color={color} size={size} focused={focused} tokens={tokens} />
            ),
          }}
        />
        <Tabs.Screen
          name="catalog"
          options={{
            title: t('tabs.catalog'),
            tabBarIcon: ({ color, size, focused }) => (
              <TabIcon name="book" color={color} size={size} focused={focused} tokens={tokens} />
            ),
          }}
        />
        <Tabs.Screen
          name="study"
          options={{
            title: t('tabs.study'),
            tabBarIcon: ({ color, size, focused }) => (
              <TabIcon name="school" color={color} size={size} focused={focused} tokens={tokens} />
            ),
          }}
        />
        <Tabs.Screen
          name="wallet"
          options={{
            title: t('tabs.wallet'),
            tabBarIcon: ({ color, size, focused }) => (
              <TabIcon name="wallet" color={color} size={size} focused={focused} tokens={tokens} />
            ),
          }}
        />
        {/* Hidden tabs — navigable via drawer, not shown in bar */}
        <Tabs.Screen name="notifications" options={{ href: null }} />
        <Tabs.Screen name="tasks" options={{ href: null }} />
        <Tabs.Screen name="community" options={{ href: null }} />
        <Tabs.Screen name="profile" options={{ href: null }} />
        <Tabs.Screen name="premium" options={{ href: null }} />
      </Tabs>

      <MoreDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        tokens={tokens}
        t={t}
      />

      {/* Email verification gate - shown when email is not verified */}
      {showEmailGate && <EmailVerificationGate />}
    </>
  );
}

// ── Custom tab bar (4 visible tabs + More button) ────────────────

function CustomTabBar({
  state,
  descriptors,
  navigation,
  tokens,
  onMorePress,
  isMoreActive,
}: {
  state: any;
  descriptors: any;
  navigation: any;
  tokens: Tokens;
  onMorePress: () => void;
  isMoreActive: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  return (
    <View
      style={[
        styles.tabBar,
        {
          backgroundColor: tokens.paper,
          borderTopColor: tokens.border,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {state.routes.map((route: any, index: number) => {
        if (!VISIBLE_TABS.includes(route.name)) return null;

        const { options } = descriptors[route.key];
        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            activeOpacity={0.7}
            style={styles.tabItem}
          >
            {options.tabBarIcon({
              color: isFocused ? tokens.mint : tokens.inkMuted,
              size: 24,
              focused: isFocused,
            })}
            <Text
              style={[
                styles.tabLabel,
                { color: isFocused ? tokens.mint : tokens.inkMuted },
              ]}
            >
              {options.title ?? route.name}
            </Text>
            {isFocused ? <View style={[styles.tabDot, { backgroundColor: tokens.mint }]} /> : null}
          </TouchableOpacity>
        );
      })}

      {/* More button */}
      <TouchableOpacity onPress={onMorePress} activeOpacity={0.7} style={styles.tabItem}>
        <Ionicons
          name="ellipsis-horizontal"
          size={24}
          color={isMoreActive ? tokens.mint : tokens.inkMuted}
        />
        <Text
          style={[
            styles.tabLabel,
            { color: isMoreActive ? tokens.mint : tokens.inkMuted },
          ]}
        >
          {t('tabs.more')}
        </Text>
        {isMoreActive ? <View style={[styles.tabDot, { backgroundColor: tokens.mint }]} /> : null}
      </TouchableOpacity>
    </View>
  );
}

// ── Tab icon (mint underline dot when focused) ───────────────────

function TabIcon({
  name,
  color,
  size,
  focused,
  tokens,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  size: number;
  focused: boolean;
  tokens: Tokens;
}) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={size} color={color} />
      {focused ? (
        <View
          style={{
            position: 'absolute',
            bottom: -6,
            width: 14,
            height: 2,
            borderRadius: 1,
            backgroundColor: tokens.mint,
          }}
        />
      ) : null}
    </View>
  );
}

// ── More bottom-sheet drawer ─────────────────────────────────────

function MoreDrawer({
  visible,
  onClose,
  tokens,
  t,
}: {
  visible: boolean;
  onClose: () => void;
  tokens: Tokens;
  t: (key: string) => string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(0)).current;

  const { data: notifData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/notifications?limit=1');
      if (!res.ok) return { unread_count: 0 };
      return res.json();
    },
    enabled: visible,
    staleTime: 1000 * 30,
  });

  const unreadCount = notifData?.unread_count ?? 0;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(0);
      Animated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();
    }
  }, [visible, slideAnim]);

  const handleItemPress = (name: string) => {
    onClose();
    router.push(`/(tabs)/${name}` as any);
  };

  const itemsWithBadge = DRAWER_ITEMS.map((item) => {
    if (item.name === 'notifications' && unreadCount > 0) {
      return { ...item, badge: unreadCount } as typeof item & { badge?: number };
    }
    return item;
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable style={styles.drawerOverlay} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.drawer,
            {
              backgroundColor: tokens.card,
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          <Animated.View
            style={{
              transform: [
                {
                  translateY: slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [400, 0],
                  }),
                },
              ],
            }}
          >
            <View style={[styles.drawerHandle, { backgroundColor: tokens.border }]} />
            <Text
              style={[
                styles.drawerTitle,
                { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' },
              ]}
            >
              {t('drawer.title')}
            </Text>

            {itemsWithBadge.map((item) => (
              <TouchableOpacity
                key={item.name}
                onPress={() => handleItemPress(item.name)}
                activeOpacity={0.7}
                style={styles.drawerItem}
              >
                <Ionicons name={item.icon} size={22} color={tokens.inkMuted} />
                <View style={styles.drawerItemText}>
                  <Text
                    style={[
                      styles.drawerItemLabel,
                      { color: tokens.ink, fontFamily: 'SpaceGrotesk_500Medium' },
                    ]}
                  >
                    {t(item.labelKey)}
                  </Text>
                  <Text style={[styles.drawerItemDesc, { color: tokens.inkMuted }]}>
                    {t(item.descKey)}
                  </Text>
                </View>
                {item.badge ? (
                  <View style={[styles.badge, { backgroundColor: tokens.mint }]}>
                    <Text style={[styles.badgeText, { color: tokens.mintText }]}>
                      {item.badge > 9 ? t('drawer.badge_overflow') : item.badge}
                    </Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={tokens.border} />
                )}
              </TouchableOpacity>
            ))}
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    position: 'relative',
  },
  tabLabel: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.15,
    marginTop: 2,
    fontFamily: 'SpaceGrotesk_500Medium',
  },
  tabDot: {
    position: 'absolute',
    bottom: 2,
    width: 14,
    height: 2,
    borderRadius: 1,
  },
  drawerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(14, 17, 22, 0.4)',
  },
  drawer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  drawerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  drawerTitle: {
    fontSize: 18,
    marginBottom: 16,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  drawerItemText: {
    flex: 1,
    marginLeft: 14,
  },
  drawerItemLabel: {
    fontSize: 15,
  },
  drawerItemDesc: {
    fontSize: 12,
    marginTop: 1,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
