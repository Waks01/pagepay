import { useCallback, useState, useEffect } from "react";
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  Image,
  Modal,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { apiFetch } from "@/src/shared/api/client";
import { displayName, initials } from "@/src/shared/lib/display-name";
import {
  persistLanguage,
  persistTheme,
  usePreferences,
  type LanguagePref,
  type ThemePref,
} from "@/src/shared/lib/preferences";
import { clearToken } from "@/src/shared/lib/storage";
import { useAdsConfig } from "@/src/shared/hooks/use-ads-config";
import { useBiometricAuth } from "@/src/shared/hooks/use-biometric-auth";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";
import {
  useCurrentUser,
  useCurrentUserStore,
} from "@/src/shared/lib/current-user";
import { PagePay } from "@/constants/theme";
import NotificationBell from "@/components/NotificationBell";
import { Skeleton } from "@/components/Skeleton";
import { AnimatedInput } from "@/components/AnimatedInput";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { DeleteAccountModal } from "@/components/DeleteAccountModal";
import {
  LinkPayoutAccountModal,
  PayoutAccount,
} from "@/components/LinkPayoutAccountModal";
import { HelpModal } from "@/components/HelpModal";
import { AboutModal } from "@/components/AboutModal";
import { NotificationSettingsModal } from "@/components/NotificationSettingsModal";
import {
  useReferralStats,
  useGenerateReferral,
} from "@/src/features/community/hooks/use-community";
import { NativeAdBanner } from "@/components/ads/NativeAdBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";

const languageOptions: {
  value: LanguagePref;
  label: string;
  available: boolean;
}[] = [
  { value: "en", label: "English", available: true },
  { value: "pcm", label: "Pidgin", available: true },
  { value: "yo", label: "Yoruba", available: true },
  { value: "ha", label: "Hausa", available: true },
  { value: "ig", label: "Igbo", available: true },
];

const themeOptions: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "sepia", label: "Sepia" },
];

export default function ProfileScreen() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const theme = usePreferences((s) => s.theme);
  const setTheme = usePreferences((s) => s.setTheme);
  const language = usePreferences((s) => s.language);
  const setLanguage = usePreferences((s) => s.setLanguage);
  const biometricEnabled = usePreferences((s) => s.biometricEnabled);
  const setBiometricEnabled = usePreferences((s) => s.setBiometricEnabled);
  const { isSupported, isEnrolled, authenticate } = useBiometricAuth();

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showPayout, setShowPayout] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameValue, setUsernameValue] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showAvatarLightbox, setShowAvatarLightbox] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch ad config for native unit. useAdsConfig has its own
  // 1-hour staleTime and is shared with the AdSlotProvider, home
  // and catalog — fetched once and reused.
  const [nativeAdUnit, setNativeAdUnit] = useState("");
  const { data: adConfig } = useAdsConfig();

  useEffect(() => {
    if (adConfig) {
      const platform = Platform.OS;
      const unitKey =
        platform === "android" ? "in_feed_android" : "in_feed_ios";
      setNativeAdUnit(adConfig[unitKey] || "");
    }
  }, [adConfig]);

  // Read the user from the global store. /me is fetched once at
  // app start by the auth gate — never on tab switch.
  const meQuery = useCurrentUser();

  const payoutQuery = useQuery({
    queryKey: ["payout", "account"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/payouts/account");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load payout account");
      return (await res.json()) as PayoutAccount;
    },
    staleTime: 60 * 60 * 1000,
  });

  const pinStatusQuery = useQuery({
    queryKey: ["pin", "status"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/pin/status");
      if (!res.ok) throw new Error("Failed to load PIN status");
      return (await res.json()) as { has_pin: boolean };
    },
  });

  const getTierLabel = (tier: string) => {
    const key = tier as "free" | "premium_monthly" | "premium_yearly";
    return t(`profile.tier.${key}`, { defaultValue: tier });
  };

  const handleSaveUsername = useCallback(async () => {
    setUsernameError(null);
    const trimmed = usernameValue.trim().toLowerCase();
    if (!trimmed) {
      setUsernameError(
        t("profile.username.empty", {
          defaultValue: "Username cannot be empty",
        }),
      );
      return;
    }
    if (trimmed.length > 12) {
      setUsernameError(
        t("profile.username.too_long", {
          defaultValue: "Username must be 12 characters or less",
        }),
      );
      return;
    }
    const allowed = /^[a-z0-9_]+$/;
    if (!allowed.test(trimmed)) {
      setUsernameError(
        t("profile.username.invalid_chars", {
          defaultValue: "Only letters, numbers, and underscores allowed",
        }),
      );
      return;
    }

    setSavingUsername(true);
    try {
      const res = await apiFetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data?.detail === "string"
            ? data.detail
            : "Failed to update username",
        );
      }
      // Username changed — refresh the global user store so every
      // screen sees the new value without each one making its own
      // /auth/me request.
      await useCurrentUserStore.getState().refresh();
      setEditingUsername(false);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setUsernameError(
        e instanceof Error ? e.message : "Failed to update username",
      );
    } finally {
      setSavingUsername(false);
    }
  }, [usernameValue, qc, t]);

  const handleThemeChange = useCallback(
    (next: ThemePref) => {
      setTheme(next);
      // Fire-and-forget; persistence failure shouldn't crash the UI.
      void persistTheme(next);
    },
    [setTheme],
  );

  const handleLanguageChange = useCallback(
    async (next: LanguagePref) => {
      const opt = languageOptions.find((o) => o.value === next);
      if (!opt?.available) {
        Alert.alert(
          t("profile.coming_soon"),
          t("profile.coming_soon_message", { language: opt?.label ?? "" }),
        );
        return;
      }

      // Change language using i18n
      try {
        const i18n = await import("@/src/lib/i18n");
        await i18n.default.changeLanguage(next);
        setLanguage(next);
        void persistLanguage(next);
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      } catch (error) {
        Alert.alert(t("common.error"), t("profile.language_error"));
      }
    },
    [setLanguage, t],
  );

  const handleNotifications = useCallback(() => {
    setShowNotifications(true);
  }, []);

  const handleBiometricToggle = useCallback(
    async (next: boolean) => {
      if (next && (!isSupported || !isEnrolled)) {
        Alert.alert(
          t("profile.biometric.unavailable_title", {
            defaultValue: "Biometric Unavailable",
          }),
          t("profile.biometric.unavailable_message", {
            defaultValue:
              "Biometric authentication is not set up on this device. Please add a fingerprint or face recognition in your device settings first.",
          }),
        );
        return;
      }

      if (next && !pinStatusQuery.data?.has_pin) {
        Alert.alert(
          t("profile.pin.required_title", {
            defaultValue: "Set Transaction PIN First",
          }),
          t("profile.pin.required_message", {
            defaultValue:
              "You must set a transaction PIN before enabling biometric login. This PIN will also be used as fallback if biometric fails.",
          }),
          [
            {
              text: t("common.cancel", { defaultValue: "Cancel" }),
              style: "cancel",
            },
            {
              text: t("profile.pin.setup_button", { defaultValue: "Set PIN" }),
              onPress: () => router.push("/pin/setup"),
            },
          ],
        );
        return;
      }

      if (next) {
        const result = await authenticate();
        if (!result.success) {
          Alert.alert(
            t("profile.biometric.failed_title", {
              defaultValue: "Authentication Failed",
            }),
            result.error ||
              t("profile.biometric.failed_message", {
                defaultValue:
                  "Biometric authentication failed. Please try again.",
              }),
          );
          return;
        }
      }

      setBiometricEnabled(next);
      await import("@/src/shared/lib/preferences").then((m) =>
        m.persistBiometricEnabled(next),
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (next) {
        Alert.alert(
          t("profile.biometric.success_title", {
            defaultValue: "Biometric Enabled",
          }),
          t("profile.biometric.success_message", {
            defaultValue: "You can now use biometric to sign in.",
          }),
        );
      }
    },
    [
      isSupported,
      isEnrolled,
      authenticate,
      setBiometricEnabled,
      pinStatusQuery.data,
      router,
      t,
    ],
  );

  const handleSignOut = useCallback(async () => {
    // Best-effort server-side logout. We don't block UI on it — the
    // real "logout" is clearing local auth state. If the call fails we
    // still want to drop the token and route the user to login.
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // Network error is fine here — the local token clear is what
      // actually protects the user.
    }

    // Deregister FCM token on logout
    try {
      const { deregisterFCMToken } = await import("@/src/lib/notifications");
      await deregisterFCMToken();
    } catch (error) {
      console.error("Failed to deregister FCM token on logout:", error);
    }

    const { clearToken } = await import("@/src/shared/lib/storage");
    const biometric = usePreferences.getState().biometricEnabled;
    await clearToken(!biometric);

    // Drop the cached user from the global store so the next signed-in
    // user doesn't see the previous user's data flash before bootstrap
    // re-runs.
    useCurrentUserStore.getState().clear();

    qc.clear();
    router.replace("/(auth)/" as any);
  }, [qc, router]);

  const handleAccountDeleted = useCallback(async () => {
    // Account has been permanently deleted on the server
    // Clear all local data and redirect to auth

    try {
      const { deregisterFCMToken } = await import("@/src/lib/notifications");
      await deregisterFCMToken();
    } catch (error) {
      console.error("Failed to deregister FCM token after deletion:", error);
    }

    const { clearToken } = await import("@/src/shared/lib/storage");
    await clearToken(true); // Force clear all tokens

    // Clear all cached data
    useCurrentUserStore.getState().clear();
    qc.clear();

    // Close modal and redirect
    setShowDeleteAccount(false);

    // Show success alert before redirect
    Alert.alert(
      t("delete_account.success.title", { defaultValue: "Account Deleted" }),
      t("delete_account.success.message", {
        defaultValue:
          "Your account has been permanently deleted. Thank you for using PagePay.",
      }),
      [
        {
          text: t("common.ok", { defaultValue: "OK" }),
          onPress: () => router.replace("/(auth)/" as any),
        },
      ],
    );
  }, [qc, router, t]);

  const handleAvatarPress = useCallback(async () => {
    // Single tap: show lightbox if avatar exists
    if (meQuery?.avatar_url) {
      setShowAvatarLightbox(true);
    } else {
      // No avatar yet, open picker
      await handleAvatarUpload();
    }
  }, [meQuery]);

  const handleAvatarUpload = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      // Check if result is valid and has assets
      if (
        !result ||
        result.canceled ||
        !result.assets ||
        result.assets.length === 0
      ) {
        return;
      }

      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert(
          t("common.error", { defaultValue: "Error" }),
          "Image data not available",
        );
        return;
      }

      setUploadingAvatar(true);

      // Determine mime type from URI or default to jpeg
      let mimeType = "image/jpeg";
      if (asset.uri) {
        const ext = asset.uri.split(".").pop()?.toLowerCase();
        if (ext === "png") mimeType = "image/png";
        else if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
        else if (ext === "webp") mimeType = "image/webp";
      }

      const base64Data = `data:${mimeType};base64,${asset.base64}`;

      // Validate the format before sending
      if (!base64Data.startsWith("data:image/")) {
        Alert.alert(
          t("common.error", { defaultValue: "Error" }),
          "Invalid image format",
        );
        setUploadingAvatar(false);
        return;
      }

      const res = await apiFetch("/api/v1/auth/me/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64: base64Data }),
      });
      if (!res.ok) {
        const data = await res
          .json()
          .catch(() => ({ detail: "Failed to upload avatar" }));
        throw new Error(
          typeof data?.detail === "string"
            ? data.detail
            : "Failed to upload avatar",
        );
      }
      const updated = (await res.json()) as { avatar_url: string | null };
      useCurrentUserStore.getState().setUser({
        ...useCurrentUserStore.getState().user,
        avatar_url: updated.avatar_url,
      } as any);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(
        t("common.error", { defaultValue: "Error" }),
        e instanceof Error ? e.message : "Failed to upload avatar",
      );
    } finally {
      setUploadingAvatar(false);
    }
  }, [t, qc, router]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        useCurrentUserStore.getState().refresh(),
        payoutQuery.refetch(),
        pinStatusQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [payoutQuery, pinStatusQuery]);

  const version =
    (Constants.expoConfig?.version as string | undefined) ||
    ((Constants.manifest as { version?: string } | undefined)?.version as
      | string
      | undefined) ||
    "1.0.0";
  const platformLabel =
    scheme === "dark"
      ? t("profile.appearance.theme_dark")
      : t("profile.appearance.theme_light");

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tokens.paper }]}>
      <PageHeader
        title={t("profile.title")}
        left={<UserAvatar size={28} />}
        right={<NotificationBell />}
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        tokens={tokens}
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.mint}
          />
        }
      >
        {/* ── Header ───────────────────────────────────────────── */}
        <View style={styles.profileHeader}>
          <TouchableOpacity
            onPress={handleAvatarPress}
            onLongPress={handleAvatarUpload}
            disabled={uploadingAvatar}
            activeOpacity={0.7}
            style={styles.avatarTouch}
          >
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: tokens.mintSoft,
                  borderColor: tokens.border,
                },
              ]}
            >
              {meQuery?.avatar_url ? (
                <Image
                  source={{ uri: meQuery.avatar_url }}
                  style={styles.avatarImage}
                />
              ) : (
                <Text
                  style={[
                    styles.avatarText,
                    { color: tokens.mint, fontFamily: "SpaceGrotesk_700Bold" },
                  ]}
                >
                  {initials(meQuery)}
                </Text>
              )}
              <View
                style={[
                  styles.avatarCameraBadge,
                  { backgroundColor: tokens.mint },
                ]}
              >
                <Ionicons
                  name={uploadingAvatar ? "ellipsis-horizontal" : "camera"}
                  size={14}
                  color={tokens.mintText}
                />
              </View>
            </View>
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text
              style={[
                styles.displayName,
                { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              {displayName(meQuery)}
            </Text>
            <Text style={[styles.identifier, { color: tokens.inkMuted }]}>
              {meQuery?.email || meQuery?.phone || t("profile.no_contact")}
            </Text>
            <View style={styles.tierRow}>
              <Text style={[styles.tier, { color: tokens.mint }]}>
                {getTierLabel(meQuery?.tier ?? "free")}
              </Text>
              {meQuery?.tier && meQuery.tier !== "free" && (
                <View
                  style={[
                    styles.premiumBadge,
                    { backgroundColor: tokens.mint },
                  ]}
                >
                  <Ionicons name="diamond" size={10} color={tokens.mintText} />
                  <Text
                    style={[styles.premiumLabel, { color: tokens.mintText }]}
                  >
                    {t("profile.premium_badge")}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Username ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: tokens.inkMuted }]}>
            {t("profile.username.section", { defaultValue: "Username" })}
          </Text>
          {editingUsername ? (
            <View style={{ gap: 10 }}>
              <AnimatedInput
                label={t("profile.username.label", {
                  defaultValue: "Choose a username",
                })}
                value={usernameValue}
                onChangeText={(v) => {
                  setUsernameValue(
                    v
                      .replace(/[^a-zA-Z0-9_]/g, "")
                      .slice(0, 12)
                      .toLowerCase(),
                  );
                  setUsernameError(null);
                }}
                placeholder={t("profile.username.placeholder", {
                  defaultValue: "johndoe",
                })}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                error={usernameError || undefined}
              />
              <Text style={[styles.helper, { color: tokens.inkMuted }]}>
                {t("profile.username.helper", {
                  defaultValue:
                    "Max 12 characters. Letters, numbers, underscores only.",
                })}
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={handleSaveUsername}
                  disabled={savingUsername}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    {
                      backgroundColor: tokens.mint,
                      opacity: pressed || savingUsername ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.primaryBtnText, { color: tokens.mintText }]}
                  >
                    {savingUsername
                      ? t("common.saving", { defaultValue: "Saving..." })
                      : t("common.save", { defaultValue: "Save" })}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setEditingUsername(false);
                    setUsernameValue(meQuery?.username || "");
                    setUsernameError(null);
                  }}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { borderColor: tokens.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.secondaryBtnText,
                      { color: tokens.inkMuted },
                    ]}
                  >
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => {
                setUsernameValue(meQuery?.username || "");
                setEditingUsername(true);
              }}
              style={({ pressed }) => [
                styles.rowCard,
                {
                  backgroundColor: tokens.card,
                  borderColor: tokens.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: tokens.ink }]}>
                  {meQuery?.username ||
                    t("profile.username.not_set", { defaultValue: "Not set" })}
                </Text>
                <Text style={[styles.rowHint, { color: tokens.inkMuted }]}>
                  {t("profile.username.edit_hint", {
                    defaultValue: "Tap to set your username",
                  })}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={tokens.inkMuted}
              />
            </Pressable>
          )}
        </View>

        {/* ── Phase 7 Roles ───────────────────────────────────── */}
        <Text style={[styles.section, { color: tokens.inkMuted }]}>
          {t("profile.sections.roles")}
        </Text>
        <View style={{ gap: 10 }}>
          <Pressable
            onPress={() => router.push("/(tabs)/tasks")}
            style={({ pressed }) => [
              styles.roleCard,
              {
                backgroundColor: tokens.card,
                borderColor: tokens.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View
              style={[styles.roleIcon, { backgroundColor: tokens.mintSoft }]}
            >
              <Ionicons
                name="briefcase-outline"
                size={20}
                color={tokens.mint}
              />
            </View>
            <View style={styles.roleInfo}>
              <Text
                style={[
                  styles.roleTitle,
                  { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
                ]}
              >
                {t("profile.roles.tasks_title")}
              </Text>
              <Text style={[styles.roleSubtitle, { color: tokens.inkMuted }]}>
                {t("profile.roles.tasks_subtitle")}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={tokens.inkMuted}
            />
          </Pressable>

          {!meQuery?.is_sponsor && (
            <Pressable
              onPress={() => router.push("/sponsor/register")}
              style={({ pressed }) => [
                styles.roleCard,
                {
                  backgroundColor: tokens.card,
                  borderColor: tokens.mint,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View
                style={[styles.roleIcon, { backgroundColor: tokens.mintSoft }]}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={20}
                  color={tokens.mint}
                />
              </View>
              <View style={styles.roleInfo}>
                <Text
                  style={[
                    styles.roleTitle,
                    { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
                  ]}
                >
                  {t("profile.roles.become_sponsor")}
                </Text>
                <Text style={[styles.roleSubtitle, { color: tokens.inkMuted }]}>
                  {t("profile.roles.become_sponsor_subtitle")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={tokens.mint} />
            </Pressable>
          )}

          {meQuery?.is_sponsor && (
            <Pressable
              onPress={() => router.push("/sponsor/dashboard")}
              style={({ pressed }) => [
                styles.roleCard,
                {
                  backgroundColor: tokens.card,
                  borderColor: tokens.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View
                style={[styles.roleIcon, { backgroundColor: tokens.mintSoft }]}
              >
                <Ionicons name="planet-outline" size={20} color={tokens.mint} />
              </View>
              <View style={styles.roleInfo}>
                <Text
                  style={[
                    styles.roleTitle,
                    { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
                  ]}
                >
                  {t("profile.roles.sponsor_dashboard")}
                </Text>
                <Text style={[styles.roleSubtitle, { color: tokens.inkMuted }]}>
                  {t("profile.roles.sponsor_dashboard_subtitle")}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={tokens.inkMuted}
              />
            </Pressable>
          )}
        </View>

        {/* ── Payout account ───────────────────────────────────── */}
        <ErrorBoundary
          fallback={
            <View
              style={[
                styles.payoutCard,
                { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
            >
              <View style={styles.payoutInner}>
                <View
                  style={[
                    styles.payoutIcon,
                    { backgroundColor: tokens.signalSoft },
                  ]}
                >
                  <Ionicons
                    name="alert-circle-outline"
                    size={18}
                    color={tokens.signal}
                  />
                </View>
                <View style={styles.payoutInfo}>
                  <Text
                    style={[
                      styles.payoutBank,
                      { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
                    ]}
                  >
                    {t("profile.payout.error")}
                  </Text>
                  <Text style={[styles.payoutHint, { color: tokens.inkMuted }]}>
                    {t("profile.payout.error_hint")}
                  </Text>
                </View>
              </View>
            </View>
          }
        >
          <Text style={[styles.section, { color: tokens.inkMuted }]}>
            {t("profile.sections.payout_account")}
          </Text>
          <View
            style={[
              styles.payoutCard,
              { backgroundColor: tokens.card, borderColor: tokens.border },
            ]}
          >
            {payoutQuery.isLoading ? (
              <View style={{ gap: 8, padding: 4 }}>
                <Skeleton height={16} width="70%" borderRadius={6} />
                <Skeleton height={14} width="50%" borderRadius={6} />
              </View>
            ) : payoutQuery.data ? (
              <View style={styles.payoutInner}>
                <View
                  style={[
                    styles.payoutIcon,
                    { backgroundColor: tokens.mintSoft },
                  ]}
                >
                  <Ionicons name="business" size={18} color={tokens.mint} />
                </View>
                <View style={styles.payoutInfo}>
                  <Text
                    style={[
                      styles.payoutBank,
                      { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
                    ]}
                  >
                    {payoutQuery.data.bank_name} ···
                    {payoutQuery.data.account_number_last4}
                  </Text>
                  <View style={styles.verifyRow}>
                    {payoutQuery.data.verified ? (
                      <>
                        <Ionicons
                          name="checkmark-circle"
                          size={14}
                          color={tokens.mint}
                        />
                        <Text
                          style={[styles.verifyText, { color: tokens.mint }]}
                        >
                          {t("profile.payout.verified")}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Ionicons
                          name="hourglass-outline"
                          size={14}
                          color={tokens.signal}
                        />
                        <Text
                          style={[styles.verifyText, { color: tokens.signal }]}
                        >
                          {t("profile.payout.pending")}
                        </Text>
                      </>
                    )}
                  </View>
                  {payoutQuery.data.account_name ? (
                    <Text
                      style={[styles.accountName, { color: tokens.inkMuted }]}
                    >
                      {payoutQuery.data.account_name}
                    </Text>
                  ) : null}
                  <Text
                    style={[styles.accountName, { color: tokens.inkMuted }]}
                  >
                    {t("profile.payout.min_withdrawal")}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setShowPayout(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={[styles.change, { color: tokens.mint }]}>
                    {t("profile.payout.change")}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.payoutInner}>
                <View
                  style={[
                    styles.payoutIcon,
                    { backgroundColor: tokens.signalSoft },
                  ]}
                >
                  <Ionicons
                    name="business-outline"
                    size={18}
                    color={tokens.signal}
                  />
                </View>
                <View style={styles.payoutInfo}>
                  <Text
                    style={[
                      styles.payoutBank,
                      { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
                    ]}
                  >
                    {t("profile.payout.no_account")}
                  </Text>
                  <Text style={[styles.payoutHint, { color: tokens.inkMuted }]}>
                    {t("profile.payout.no_account_hint")}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setShowPayout(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={[styles.change, { color: tokens.mint }]}>
                    {t("profile.payout.link")}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </ErrorBoundary>

        {/* ── Referral ──────────────────────────────────────────── */}
        <ErrorBoundary
          fallback={
            <View
              style={[
                styles.referralCard,
                { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
            >
              <View style={styles.referralHeader}>
                <Ionicons
                  name="alert-circle-outline"
                  size={20}
                  color={tokens.signal}
                />
                <Text
                  style={[
                    styles.referralTitle,
                    { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
                  ]}
                >
                  {t("profile.referral.unavailable")}
                </Text>
              </View>
              <Text
                style={[styles.referralSubtitle, { color: tokens.inkMuted }]}
              >
                {t("profile.referral.unavailable_hint")}
              </Text>
            </View>
          }
        >
          <ReferralSection tokens={tokens} />
        </ErrorBoundary>

        {/* ── Native ad after stats ─────────────────────────────── */}
        <ErrorBoundary fallback={null}>
          {nativeAdUnit && (
            <NativeAdBanner adUnit={nativeAdUnit} sessionId={null} />
          )}
        </ErrorBoundary>

        {/* ── Settings rows ────────────────────────────────────── */}
        <Text style={[styles.section, { color: tokens.inkMuted }]}>
          {t("profile.sections.account")}
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <Row
            tokens={tokens}
            icon="lock-closed-outline"
            label={t("profile.account.change_password")}
            onPress={() => setShowChangePassword(true)}
          />
          <Divider tokens={tokens} />
          <Row
            tokens={tokens}
            icon="receipt-outline"
            label={t("profile.account.billing_history")}
            onPress={() => router.push("/billing/history")}
          />
          {meQuery?.tier && meQuery.tier !== "free" && (
            <>
              <Divider tokens={tokens} />
              <Row
                tokens={tokens}
                icon="card-outline"
                label={t("profile.account.manage_subscription")}
                onPress={() => router.push("/billing/subscription")}
              />
            </>
          )}
          <Divider tokens={tokens} />
          <Row
            tokens={tokens}
            icon="notifications-outline"
            label={t("profile.account.notifications")}
            onPress={handleNotifications}
          />
          <Divider tokens={tokens} />
          <Row
            tokens={tokens}
            icon="finger-print-outline"
            label={t("profile.biometric.title", {
              defaultValue: "Biometric Login",
            })}
            trailing={
              <Switch
                value={biometricEnabled}
                onValueChange={handleBiometricToggle}
                trackColor={{ false: tokens.border, true: tokens.mint }}
                thumbColor={
                  biometricEnabled ? tokens.mintText : tokens.inkMuted
                }
              />
            }
          />
          <Divider tokens={tokens} />
          <Row
            tokens={tokens}
            icon="key-outline"
            label={t("profile.pin.title", { defaultValue: "Transaction PIN" })}
            trailing={
              <Text style={[styles.rowTrailing, { color: tokens.inkMuted }]}>
                {pinStatusQuery.data?.has_pin
                  ? t("profile.pin.set", { defaultValue: "Set" })
                  : t("profile.pin.not_set", { defaultValue: "Not set" })}
              </Text>
            }
            onPress={() =>
              router.push(
                pinStatusQuery.data?.has_pin ? "/pin/change" : "/pin/setup",
              )
            }
          />
        </View>

        <Text style={[styles.section, { color: tokens.inkMuted }]}>
          {t("profile.sections.appearance")}
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons
                name="sunny-outline"
                size={18}
                color={tokens.inkMuted}
              />
              <Text style={[styles.rowLabel, { color: tokens.ink }]}>
                {t("profile.appearance.theme")}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.segmented,
              { backgroundColor: tokens.paper, borderColor: tokens.border },
            ]}
          >
            {themeOptions.map((opt) => {
              const active = theme === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => handleThemeChange(opt.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.segment,
                    {
                      backgroundColor: active ? tokens.mint : "transparent",
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentLabel,
                      {
                        color: active ? tokens.mintText : tokens.ink,
                        fontFamily: active
                          ? "SpaceGrotesk_700Bold"
                          : "SpaceGrotesk_500Medium",
                      },
                    ]}
                  >
                    {t(`profile.appearance.theme_${opt.value}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Divider tokens={tokens} />

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons
                name="language-outline"
                size={18}
                color={tokens.inkMuted}
              />
              <Text style={[styles.rowLabel, { color: tokens.ink }]}>
                {t("profile.appearance.language")}
              </Text>
            </View>
          </View>
          <View style={[styles.langGrid, { borderColor: tokens.border }]}>
            {languageOptions.map((opt) => {
              const active = language === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => handleLanguageChange(opt.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.langPill,
                    {
                      backgroundColor: active ? tokens.mint : tokens.paper,
                      borderColor: tokens.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.langLabel,
                      {
                        color: active ? tokens.mintText : tokens.ink,
                        fontFamily: active
                          ? "SpaceGrotesk_700Bold"
                          : "SpaceGrotesk_500Medium",
                      },
                    ]}
                  >
                    {t(
                      `profile.appearance.language_${opt.label.toLowerCase()}`,
                    )}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={[styles.section, { color: tokens.inkMuted }]}>
          {t("profile.sections.support")}
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <Row
            tokens={tokens}
            icon="help-circle-outline"
            label={t("profile.support.help")}
            onPress={() => setShowHelp(true)}
          />
          <Divider tokens={tokens} />
          <Row
            tokens={tokens}
            icon="information-circle-outline"
            label={t("profile.support.about")}
            trailing={
              <Text style={[styles.trailingHint, { color: tokens.inkMuted }]}>
                v{version}
              </Text>
            }
            onPress={() => setShowAbout(true)}
          />
        </View>

        {/* ── Danger Zone ─────────────────────────────────────────── */}
        <Text style={[styles.section, { color: tokens.signal }]}>
          {t("profile.sections.danger_zone", { defaultValue: "DANGER ZONE" })}
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: tokens.signalSoft, borderColor: tokens.signal },
          ]}
        >
          <Row
            tokens={tokens}
            icon="trash-outline"
            label={t("profile.danger.delete_account", {
              defaultValue: "Delete Account",
            })}
            onPress={() => setShowDeleteAccount(true)}
            iconColor={tokens.signal}
          />
        </View>

        {/* ── Sign out ─────────────────────────────────────────── */}
        <Pressable
          onPress={handleSignOut}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.signOut,
            {
              backgroundColor: tokens.signalSoft,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="log-out-outline" size={18} color={tokens.signal} />
          <Text
            style={[
              styles.signOutText,
              { color: tokens.signal, fontFamily: "SpaceGrotesk_700Bold" },
            ]}
          >
            {t("profile.sign_out")}
          </Text>
        </Pressable>

        {/* ── Footer ───────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.footerIcon}
          />
          <Text style={[styles.footerText, { color: tokens.inkMuted }]}>
            {t("profile.footer", { version, theme: platformLabel })}
          </Text>
        </View>
      </ScrollView>

      <ChangePasswordModal
        visible={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
      <DeleteAccountModal
        visible={showDeleteAccount}
        onClose={() => setShowDeleteAccount(false)}
        onDeleted={handleAccountDeleted}
      />
      <LinkPayoutAccountModal
        visible={showPayout}
        current={payoutQuery.data ?? null}
        onClose={() => setShowPayout(false)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ["payout", "account"] });
          void useCurrentUserStore.getState().refresh();
        }}
      />
      <HelpModal visible={showHelp} onClose={() => setShowHelp(false)} />
      <AboutModal visible={showAbout} onClose={() => setShowAbout(false)} />
      <NotificationSettingsModal
        visible={showNotifications}
        onClose={() => setShowNotifications(false)}
      />

      {/* Avatar Lightbox */}
      {meQuery?.avatar_url && (
        <AvatarLightbox
          visible={showAvatarLightbox}
          imageUri={meQuery.avatar_url}
          onClose={() => setShowAvatarLightbox(false)}
          onUploadNew={handleAvatarUpload}
          tokens={tokens}
          t={t}
        />
      )}
    </SafeAreaView>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function Row({
  tokens,
  icon,
  label,
  trailing,
  onPress,
  iconColor,
}: {
  tokens: (typeof PagePay)["light"] | (typeof PagePay)["dark"];
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  iconColor?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={18} color={iconColor || tokens.inkMuted} />
        <Text style={[styles.rowLabel, { color: tokens.ink }]}>{label}</Text>
      </View>
      <View style={styles.rowRight}>
        {trailing}
        <Ionicons name="chevron-forward" size={18} color={tokens.inkMuted} />
      </View>
    </Pressable>
  );
}

function Divider({
  tokens,
}: {
  tokens: (typeof PagePay)["light"] | (typeof PagePay)["dark"];
}) {
  return <View style={[styles.divider, { backgroundColor: tokens.border }]} />;
}

function ReferralSection({
  tokens,
}: {
  tokens: (typeof PagePay)["light"] | (typeof PagePay)["dark"];
}) {
  const statsQ = useReferralStats();
  const generateMutation = useGenerateReferral();
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const handleReferralUpdate = useCallback(
    (stats: any) => {
      queryClient.setQueryData(["referral", "stats"], stats);
    },
    [queryClient],
  );

  // Socket.IO real-time updates
  useEffect(() => {
    const queryData = queryClient.getQueryData(["me"]) as
      | { data: { id: number } }
      | undefined;
    const user = queryData?.data;
    if (!user?.id) return;

    let cleanup: (() => void) | undefined;
    import("@/src/lib/socket").then(
      ({ connectSocket, onReferralUpdate, offReferralUpdate }) => {
        connectSocket(user.id);
        onReferralUpdate(handleReferralUpdate);
        cleanup = () => offReferralUpdate(handleReferralUpdate);
      },
    );

    return () => {
      if (cleanup) cleanup();
    };
  }, [queryClient, handleReferralUpdate]);

  const stats = statsQ.data as
    | {
        code: string;
        signups: number;
        pending_rewards: number;
        claimed_rewards: number;
      }
    | undefined;
  const code = stats?.code ?? "";
  const link = code ? `https://pagepay.app/ref/${code}` : "";

  const handleGenerate = async () => {
    try {
      await generateMutation.mutateAsync();
    } catch {
      // silent
    }
  };

  const handleShare = async () => {
    if (!link) return;

    try {
      const message = t("profile.referral.share_message", { code, link });

      const result = await Share.share({
        message,
        url: link, // iOS uses this
        title: t("profile.referral.share_title"),
      });

      if (result.action === Share.sharedAction) {
        // User shared successfully
        if (Platform.OS === "ios") {
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          );
        }
      }
    } catch (error) {
      // Fallback to Alert if share fails
      Alert.alert(t("profile.referral.share_title"), link);
    }
  };

  const handleCopy = async () => {
    if (!link) return;

    try {
      await Clipboard.setStringAsync(link);
      setCopied(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // Silent fail - user can still manually copy from display
      setCopied(false);
    }
  };

  return (
    <View
      style={[
        styles.referralCard,
        { backgroundColor: tokens.card, borderColor: tokens.border },
      ]}
    >
      <View style={styles.referralHeader}>
        <Ionicons name="gift-outline" size={20} color={tokens.mint} />
        <Text
          style={[
            styles.referralTitle,
            { color: tokens.ink, fontFamily: "SpaceGrotesk_700Bold" },
          ]}
        >
          {t("profile.referral.title")}
        </Text>
      </View>
      <Text style={[styles.referralSubtitle, { color: tokens.inkMuted }]}>
        {t("profile.referral.subtitle")}
      </Text>

      {code ? (
        <View
          style={[
            styles.codeBox,
            { backgroundColor: tokens.paper, borderColor: tokens.border },
          ]}
        >
          <Text
            style={[
              styles.codeText,
              { color: tokens.mint, fontFamily: "SpaceGrotesk_700Bold" },
            ]}
          >
            {code}
          </Text>
        </View>
      ) : (
        <TouchableOpacity
          onPress={handleGenerate}
          disabled={generateMutation.isPending}
          style={[styles.generateBtn, { backgroundColor: tokens.mint }]}
          activeOpacity={0.7}
        >
          <Text style={[styles.generateText, { color: tokens.mintText }]}>
            {generateMutation.isPending
              ? t("profile.referral.generating")
              : t("profile.referral.generate")}
          </Text>
        </TouchableOpacity>
      )}

      {code && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <TouchableOpacity
            onPress={handleCopy}
            style={[styles.actionBtn, { borderColor: tokens.border }]}
            activeOpacity={0.7}
          >
            <Ionicons
              name={copied ? "checkmark-outline" : "copy-outline"}
              size={16}
              color={tokens.mint}
            />
            <Text style={[styles.actionText, { color: tokens.mint }]}>
              {copied
                ? t("profile.referral.copied")
                : t("profile.referral.copy")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShare}
            style={[styles.actionBtn, { borderColor: tokens.border }]}
            activeOpacity={0.7}
          >
            <Ionicons
              name="share-social-outline"
              size={16}
              color={tokens.mint}
            />
            <Text style={[styles.actionText, { color: tokens.mint }]}>
              {t("profile.referral.share")}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {stats && (
        <View style={[styles.statsRow, { borderTopColor: tokens.border }]}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: tokens.ink }]}>
              {stats.signups}
            </Text>
            <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>
              {t("profile.referral.stats_signups")}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: tokens.ink }]}>
              {stats.pending_rewards}
            </Text>
            <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>
              {t("profile.referral.stats_pending")}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: tokens.mint }]}>
              {stats.claimed_rewards}
            </Text>
            <Text style={[styles.statLabel, { color: tokens.inkMuted }]}>
              {t("profile.referral.stats_claimed")}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 48,
    gap: 14,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 20,
    letterSpacing: -0.2,
    flex: 1,
    textAlign: "center",
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 12,
    gap: 16,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarTouch: {
    position: "relative",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 36,
  },
  avatarText: {
    fontSize: 24,
    letterSpacing: 0.5,
  },
  avatarCameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  displayName: {
    fontSize: 22,
    letterSpacing: -0.3,
  },
  identifier: {
    fontSize: 13,
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  tier: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  premiumBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 10,
  },
  premiumLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  // Section header
  section: {
    fontSize: 11,
    letterSpacing: 1.0,
    fontWeight: "600",
    marginTop: 6,
    marginLeft: 4,
  },
  // Role cards
  roleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  roleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  roleInfo: {
    flex: 1,
    gap: 2,
  },
  roleTitle: {
    fontSize: 15,
  },
  roleSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  // Payout card
  payoutCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  payoutInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  payoutIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  payoutInfo: {
    flex: 1,
    gap: 4,
  },
  payoutBank: {
    fontSize: 15,
  },
  verifyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  verifyText: {
    fontSize: 12,
    fontWeight: "600",
  },
  accountName: {
    fontSize: 12,
  },
  payoutHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  change: {
    fontSize: 14,
    fontWeight: "600",
  },
  // Generic card + row
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 52,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "500",
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowTrailing: {
    fontSize: 13,
    fontWeight: "500",
  },
  trailingHint: {
    fontSize: 13,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 46,
  },
  // Theme segmented
  segmented: {
    flexDirection: "row",
    margin: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentLabel: {
    fontSize: 12,
  },
  // Language grid
  langGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 12,
  },
  langPill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  langLabel: {
    fontSize: 13,
  },
  // Sign out
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 18,
  },
  signOutText: {
    fontSize: 15,
  },
  // Footer
  footer: {
    alignItems: "center",
    paddingTop: 18,
    gap: 6,
  },
  footerIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  footerText: {
    fontSize: 12,
    letterSpacing: 0.2,
  },
  // Referral
  referralCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  referralHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  referralTitle: {
    fontSize: 16,
  },
  referralSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  codeBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    alignItems: "center",
  },
  codeText: {
    fontSize: 20,
    letterSpacing: 2,
  },
  generateBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  generateText: {
    fontSize: 14,
    fontWeight: "700",
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionText: {
    fontSize: 13,
    fontWeight: "600",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  stat: {
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 11,
  },
  // Username
  sectionTitle: {
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowHint: {
    fontSize: 13,
    marginTop: 2,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  helper: {
    fontSize: 12,
    lineHeight: 16,
  },
});

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

type AvatarLightboxProps = {
  visible: boolean;
  imageUri: string;
  onClose: () => void;
  onUploadNew: () => void;
  tokens: (typeof PagePay)["light"];
  t: ReturnType<typeof useTranslation>["t"];
};

function AvatarLightbox({
  visible,
  imageUri,
  onClose,
  onUploadNew,
  tokens,
  t,
}: AvatarLightboxProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = savedScale.value * e.scale;
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else if (scale.value > 4) {
        scale.value = withSpring(4);
        savedScale.value = 4;
      } else {
        savedScale.value = scale.value;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        scale.value = withSpring(2);
        savedScale.value = 2;
      }
    });

  const composed = Gesture.Simultaneous(
    doubleTapGesture,
    Gesture.Simultaneous(pinchGesture, panGesture),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const handleClose = () => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    onClose();
  };

  const handleUploadNew = () => {
    handleClose();
    onUploadNew();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={avatarLightboxStyles.container}>
        {/* Header with buttons */}
        <View style={avatarLightboxStyles.header}>
          <TouchableOpacity
            style={[
              avatarLightboxStyles.headerButton,
              { backgroundColor: "rgba(0, 0, 0, 0.6)" },
            ]}
            onPress={handleClose}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              avatarLightboxStyles.headerButton,
              { backgroundColor: tokens.mint },
            ]}
            onPress={handleUploadNew}
          >
            <Ionicons name="camera" size={20} color={tokens.mintText} />
            <Text
              style={[
                avatarLightboxStyles.uploadText,
                { color: tokens.mintText },
              ]}
            >
              {t("profile.change_photo", { defaultValue: "Change Photo" })}
            </Text>
          </TouchableOpacity>
        </View>

        <GestureDetector gesture={composed}>
          <Animated.View
            style={[avatarLightboxStyles.imageContainer, animatedStyle]}
          >
            <Image
              source={{ uri: imageUri }}
              style={avatarLightboxStyles.image}
              resizeMode="contain"
            />
          </Animated.View>
        </GestureDetector>

        <View style={avatarLightboxStyles.instructions}>
          <Text style={avatarLightboxStyles.instructionsText}>
            {t("profile.lightbox_instructions", {
              defaultValue: "Pinch to zoom • Double tap to reset",
            })}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const avatarLightboxStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    position: "absolute",
    top: 50,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 10,
  },
  headerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
  },
  uploadText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "SpaceGrotesk_600SemiBold",
  },
  imageContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  instructions: {
    position: "absolute",
    bottom: 50,
    alignSelf: "center",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  instructionsText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "SpaceGrotesk_400Regular",
  },
});
