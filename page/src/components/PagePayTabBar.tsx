import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import { BottomTabBarProps } from "expo-router/tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import { PagePay } from "@/constants/theme";
import { useTranslation } from "react-i18next";
import {
  TAB_ORDER,
  VISIBLE_TABS,
  type TabName,
} from "@/src/shared/lib/tab-config";

export function PagePayTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { t } = useTranslation();
  const [showMore, setShowMore] = useState(false);

  const visibleTabs = TAB_ORDER.slice(0, VISIBLE_TABS);
  const hiddenTabs = TAB_ORDER.slice(VISIBLE_TABS);
  const currentRoute = state.routes[state.index];
  const currentTabName = currentRoute.name as TabName;

  const handleTabPress = (name: string) => {
    const event = navigation.emit({
      type: "tabPress",
      target: state.routes.find((r) => r.name === name)?.key,
      canExecute: true,
    });
    if (!event.defaultPrevented) {
      navigation.navigate(name);
    }
    setShowMore(false);
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          backgroundColor: tokens.paper,
        },
      ]}
    >
      <View
        style={[
          styles.inner,
          { backgroundColor: tokens.paper, borderTopColor: tokens.border },
        ]}
      >
        {visibleTabs.map((tab) => {
          const isFocused = currentTabName === tab.name;
          const color = isFocused ? tokens.mint : tokens.inkMuted;
          const backgroundColor = isFocused ? tokens.mintSoft : "transparent";

          return (
            <TouchableOpacity
              key={tab.name}
              onPress={() => handleTabPress(tab.name)}
              style={styles.tab}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.iconContainer,
                  {
                    backgroundColor,
                    borderRadius: isFocused ? 20 : 12,
                    borderWidth: isFocused ? 0 : StyleSheet.hairlineWidth,
                    borderColor: tokens.border,
                  },
                ]}
              >
                <Ionicons
                  name={
                    isFocused
                      ? (tab.icon as keyof typeof Ionicons.glyphMap)
                      : (tab.iconOutline as keyof typeof Ionicons.glyphMap)
                  }
                  size={22}
                  color={color}
                />
              </View>
              <Text style={[styles.label, { color }]}>
                {t(`tabs.${tab.name}`, tab.label)}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          onPress={() => setShowMore(true)}
          style={styles.tab}
          accessibilityRole="button"
          accessibilityLabel="More tabs"
          activeOpacity={0.7}
        >
          <View
            style={[styles.iconContainer, { backgroundColor: "transparent" }]}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={22}
              color={tokens.inkMuted}
            />
          </View>
          <Text style={[styles.label, { color: tokens.inkMuted }]}>
            {t("tabs.more", "More")}
          </Text>
        </TouchableOpacity>
      </View>

      <MoreTabsModal
        visible={showMore}
        tabs={hiddenTabs}
        currentTab={currentTabName}
        tokens={tokens}
        onSelect={(name) => handleTabPress(name)}
        onClose={() => setShowMore(false)}
      />
    </View>
  );
}

function MoreTabsModal({
  visible,
  tabs,
  currentTab,
  tokens,
  onSelect,
  onClose,
}: {
  visible: boolean;
  tabs: typeof TAB_ORDER;
  currentTab: TabName;
  tokens: Record<string, string>;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View
          style={[
            styles.modalContent,
            {
              backgroundColor: tokens.paper,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View
            style={[styles.modalHandle, { backgroundColor: tokens.border }]}
          />
          <Text style={[styles.modalTitle, { color: tokens.ink }]}>More</Text>
          <ScrollView style={styles.modalList}>
            {tabs.map((tab) => {
              const isFocused = currentTab === tab.name;
              return (
                <TouchableOpacity
                  key={tab.name}
                  onPress={() => onSelect(tab.name)}
                  style={[
                    styles.modalItem,
                    {
                      backgroundColor: isFocused
                        ? tokens.mintSoft
                        : "transparent",
                    },
                  ]}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={
                      isFocused
                        ? (tab.icon as keyof typeof Ionicons.glyphMap)
                        : (tab.iconOutline as keyof typeof Ionicons.glyphMap)
                    }
                    size={22}
                    color={isFocused ? tokens.mint : tokens.inkMuted}
                  />
                  <Text
                    style={[
                      styles.modalItemText,
                      { color: isFocused ? tokens.mint : tokens.ink },
                    ]}
                  >
                    {tab.label}
                  </Text>
                  {isFocused && (
                    <View
                      style={[
                        styles.activeDot,
                        { backgroundColor: tokens.mint },
                      ]}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderTopWidth: 0,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 12,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    width: "100%",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
  },
  iconContainer: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
  },
  modalList: {
    maxHeight: 400,
  },
  modalItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  modalItemText: {
    fontSize: 16,
    fontWeight: "500",
    flex: 1,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
