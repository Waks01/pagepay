import { Tabs, BottomTabBarProps } from 'expo-router';
import { useCallback } from 'react';
import { PagePayTabBar } from '@/src/components/PagePayTabBar';
import { TAB_ORDER } from '@/src/shared/lib/tab-config';

export default function AppLayout() {
  const renderTabBar = useCallback((props: BottomTabBarProps) => <PagePayTabBar {...props} />, []);

  return (
    <Tabs
      tabBar={renderTabBar}
      screenOptions={{ headerShown: false, animationEnabled: false }}
      lazy={false}
    >
      {TAB_ORDER.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} />
      ))}
    </Tabs>
  );
}
