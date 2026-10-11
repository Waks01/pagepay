import { Tabs } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
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
        // Keep all tab screens mounted to preserve query cache across
        // tab switches.
        lazy: false,
      }}
    >
      {TAB_ORDER.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            // Catalog holds a long list: freeze it while blurred so it
            // does not keep re-rendering behind the active tab.
            freezeOnBlur: tab.name === 'catalog',
          }}
        />
      ))}
    </Tabs>
  );
}
