import { Tabs, BottomTabBarProps } from "expo-router";
import { useCallback } from "react";
import { PagePayTabBar } from "@/src/components/PagePayTabBar";
import { TAB_ORDER } from "@/src/shared/lib/tab-config";

export default function AppLayout() {
  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => <PagePayTabBar {...props} />,
    [],
  );

  return (
    <Tabs
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
        animationEnabled: true, // Enable animations for smoother transitions
      }}
      lazy={false} // Keep all tab screens mounted to preserve query cache across tab switches
    >
      {TAB_ORDER.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            unmountOnBlur: tab.name === 'catalog',
          }}
        />
      ))}
    </Tabs>
  );
}
