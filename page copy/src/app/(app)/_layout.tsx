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
        // Tabs are mounted on first visit, not all at once.
        //
        // `lazy: false` was here to "preserve query cache across tab
        // switches", but React Query's cache does not depend on a screen
        // being mounted — the data is cached either way. What it did do
        // was mount all nine tabs at startup, so nine screens fired
        // their queries at once and nine screens' worth of images and
        // state were live in memory before the student had tapped
        // anything. On a mid-range phone that is what took the app over
        // its heap and killed it with a GC timeout.
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
