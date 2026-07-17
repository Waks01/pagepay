/**
 * Notification settings modal.
 * Allows users to configure notification preferences and quiet hours.
 * Phase 3 feature.
 */
import { useState, useEffect } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';

import { apiFetch } from '@/src/shared/api/client';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';
import { areNotificationsEnabled, openNotificationSettings } from '@/src/lib/notifications';

type NotificationPreferences = {
  push_enabled: boolean;
  study_reminders: boolean;
  task_alerts: boolean;
  referral_bonuses: boolean;
  wallet_updates: boolean;
  ad_rewards: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function NotificationSettingsModal({ visible, onClose }: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const queryClient = useQueryClient();

  const [preferences, setPreferences] = useState<NotificationPreferences>({
    push_enabled: true,
    study_reminders: true,
    task_alerts: true,
    referral_bonuses: true,
    wallet_updates: true,
    ad_rewards: true,
    quiet_hours_start: null,
    quiet_hours_end: null,
  });

  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [systemNotificationsEnabled, setSystemNotificationsEnabled] = useState(true);

  // Fetch current preferences
  const prefsQuery = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/notifications/preferences');
      if (!res.ok) throw new Error('Failed to load preferences');
      return (await res.json()) as NotificationPreferences;
    },
    enabled: visible,
  });

  // Update preferences mutation
  const updateMutation = useMutation({
    mutationFn: async (prefs: NotificationPreferences) => {
      const res = await apiFetch('/api/v1/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error('Failed to update preferences');
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      if (Platform.OS === 'ios') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    },
  });

  // Load preferences when modal opens
  useEffect(() => {
    if (visible && prefsQuery.data) {
      setPreferences(prefsQuery.data);
    }
  }, [visible, prefsQuery.data]);

  // Check system notification permissions
  useEffect(() => {
    if (visible) {
      areNotificationsEnabled().then(setSystemNotificationsEnabled);
    }
  }, [visible]);

  const handleToggle = (key: keyof NotificationPreferences) => {
    setPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync(preferences);
      onClose();
    } catch (error) {
      Alert.alert('Error', 'Failed to save notification settings. Please try again.');
    }
  };

  const handleOpenSystemSettings = () => {
    openNotificationSettings();
  };

  const parseTime = (timeStr: string | null): Date => {
    if (!timeStr) return new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  };

  const formatTime = (date: Date): string => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const handleStartTimeChange = (event: any, selectedDate?: Date) => {
    setShowStartPicker(Platform.OS === 'ios');
    if (selectedDate) {
      setPreferences((prev) => ({
        ...prev,
        quiet_hours_start: formatTime(selectedDate),
      }));
    }
  };

  const handleEndTimeChange = (event: any, selectedDate?: Date) => {
    setShowEndPicker(Platform.OS === 'ios');
    if (selectedDate) {
      setPreferences((prev) => ({
        ...prev,
        quiet_hours_end: formatTime(selectedDate),
      }));
    }
  };

  const clearQuietHours = () => {
    setPreferences((prev) => ({
      ...prev,
      quiet_hours_start: null,
      quiet_hours_end: null,
    }));
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: tokens.paper }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: tokens.border }]}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={28} color={tokens.ink} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: tokens.ink }]}>Notification Settings</Text>
          <Pressable
            onPress={handleSave}
            disabled={updateMutation.isPending}
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[styles.saveButton, { color: tokens.mint }]}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
          {/* System Notification Warning */}
          {!systemNotificationsEnabled && (
            <View style={[styles.warningCard, { backgroundColor: tokens.signalSoft, borderColor: tokens.signal }]}>
              <Ionicons name="warning" size={20} color={tokens.signal} />
              <View style={styles.warningText}>
                <Text style={[styles.warningTitle, { color: tokens.signal }]}>Notifications Disabled</Text>
                <Text style={[styles.warningSubtitle, { color: tokens.inkMuted }]}>
                  Enable notifications in your device settings to receive alerts.
                </Text>
              </View>
              <Pressable onPress={handleOpenSystemSettings} style={styles.warningButton}>
                <Text style={[styles.warningButtonText, { color: tokens.signal }]}>Open Settings</Text>
              </Pressable>
            </View>
          )}

          {/* Master Toggle */}
          <View style={[styles.section, { borderBottomColor: tokens.border }]}>
            <Text style={[styles.sectionTitle, { color: tokens.inkMuted }]}>NOTIFICATIONS</Text>
            <View style={[styles.toggleRow, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <View style={styles.toggleLeft}>
                <Ionicons name="notifications" size={20} color={tokens.mint} />
                <View style={styles.toggleInfo}>
                  <Text style={[styles.toggleLabel, { color: tokens.ink }]}>Push Notifications</Text>
                  <Text style={[styles.toggleHint, { color: tokens.inkMuted }]}>
                    Receive alerts for important events
                  </Text>
                </View>
              </View>
              <Switch
                value={preferences.push_enabled}
                onValueChange={() => handleToggle('push_enabled')}
                trackColor={{ false: tokens.border, true: tokens.mintSoft }}
                thumbColor={preferences.push_enabled ? tokens.mint : tokens.inkMuted}
              />
            </View>
          </View>

          {/* Category Toggles */}
          <View style={[styles.section, { borderBottomColor: tokens.border }]}>
            <Text style={[styles.sectionTitle, { color: tokens.inkMuted }]}>NOTIFICATION TYPES</Text>
            <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <ToggleItem
                icon="school"
                label="Study Reminders"
                hint="Daily reminders to review flashcards"
                value={preferences.study_reminders}
                onToggle={() => handleToggle('study_reminders')}
                disabled={!preferences.push_enabled}
                tokens={tokens}
              />
              <Divider tokens={tokens} />
              <ToggleItem
                icon="briefcase"
                label="Task Alerts"
                hint="New tasks and updates"
                value={preferences.task_alerts}
                onToggle={() => handleToggle('task_alerts')}
                disabled={!preferences.push_enabled}
                tokens={tokens}
              />
              <Divider tokens={tokens} />
              <ToggleItem
                icon="gift"
                label="Referral Bonuses"
                hint="When friends sign up"
                value={preferences.referral_bonuses}
                onToggle={() => handleToggle('referral_bonuses')}
                disabled={!preferences.push_enabled}
                tokens={tokens}
              />
              <Divider tokens={tokens} />
              <ToggleItem
                icon="wallet"
                label="Wallet Updates"
                hint="Payment and withdrawal alerts"
                value={preferences.wallet_updates}
                onToggle={() => handleToggle('wallet_updates')}
                disabled={!preferences.push_enabled}
                tokens={tokens}
              />
              <Divider tokens={tokens} />
              <ToggleItem
                icon="tv"
                label="Ad Rewards"
                hint="Points earned from watching ads"
                value={preferences.ad_rewards}
                onToggle={() => handleToggle('ad_rewards')}
                disabled={!preferences.push_enabled}
                tokens={tokens}
              />
            </View>
          </View>

          {/* Quiet Hours */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: tokens.inkMuted }]}>QUIET HOURS</Text>
            <Text style={[styles.sectionHint, { color: tokens.inkMuted }]}>
              Silence notifications during specific times
            </Text>
            <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
              <Pressable
                onPress={() => setShowStartPicker(true)}
                disabled={!preferences.push_enabled}
                style={({ pressed }) => [
                  styles.timeRow,
                  { opacity: pressed ? 0.7 : !preferences.push_enabled ? 0.5 : 1 },
                ]}
              >
                <View style={styles.timeLeft}>
                  <Ionicons name="moon" size={18} color={tokens.inkMuted} />
                  <Text style={[styles.timeLabel, { color: tokens.ink }]}>Start Time</Text>
                </View>
                <View style={styles.timeRight}>
                  <Text style={[styles.timeValue, { color: tokens.mint }]}>
                    {preferences.quiet_hours_start || 'Not set'}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={tokens.inkMuted} />
                </View>
              </Pressable>

              {showStartPicker && (
                <DateTimePicker
                  value={parseTime(preferences.quiet_hours_start)}
                  mode="time"
                  is24Hour={true}
                  display="default"
                  onChange={handleStartTimeChange}
                />
              )}

              <Divider tokens={tokens} />

              <Pressable
                onPress={() => setShowEndPicker(true)}
                disabled={!preferences.push_enabled}
                style={({ pressed }) => [
                  styles.timeRow,
                  { opacity: pressed ? 0.7 : !preferences.push_enabled ? 0.5 : 1 },
                ]}
              >
                <View style={styles.timeLeft}>
                  <Ionicons name="sunny" size={18} color={tokens.inkMuted} />
                  <Text style={[styles.timeLabel, { color: tokens.ink }]}>End Time</Text>
                </View>
                <View style={styles.timeRight}>
                  <Text style={[styles.timeValue, { color: tokens.mint }]}>
                    {preferences.quiet_hours_end || 'Not set'}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={tokens.inkMuted} />
                </View>
              </Pressable>

              {showEndPicker && (
                <DateTimePicker
                  value={parseTime(preferences.quiet_hours_end)}
                  mode="time"
                  is24Hour={true}
                  display="default"
                  onChange={handleEndTimeChange}
                />
              )}

              {(preferences.quiet_hours_start || preferences.quiet_hours_end) && (
                <>
                  <Divider tokens={tokens} />
                  <Pressable
                    onPress={clearQuietHours}
                    style={({ pressed }) => [styles.clearButton, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.clearButtonText, { color: tokens.signal }]}>Clear Quiet Hours</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// Helper components
function ToggleItem({
  icon,
  label,
  hint,
  value,
  onToggle,
  disabled,
  tokens,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  value: boolean;
  onToggle: () => void;
  disabled: boolean;
  tokens: (typeof PagePay)['light'] | (typeof PagePay)['dark'];
}) {
  return (
    <View style={[styles.toggleRow, { opacity: disabled ? 0.5 : 1 }]}>
      <View style={styles.toggleLeft}>
        <Ionicons name={icon} size={20} color={tokens.inkMuted} />
        <View style={styles.toggleInfo}>
          <Text style={[styles.toggleLabel, { color: tokens.ink }]}>{label}</Text>
          <Text style={[styles.toggleHint, { color: tokens.inkMuted }]}>{hint}</Text>
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: tokens.border, true: tokens.mintSoft }}
        thumbColor={value ? tokens.mint : tokens.inkMuted}
      />
    </View>
  );
}

function Divider({ tokens }: { tokens: (typeof PagePay)['light'] | (typeof PagePay)['dark'] }) {
  return <View style={[styles.divider, { backgroundColor: tokens.border }]} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  saveButton: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_600SemiBold',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
    marginBottom: 8,
  },
  warningText: {
    flex: 1,
    gap: 2,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  warningSubtitle: {
    fontSize: 12,
  },
  warningButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  warningButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    marginTop: 24,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    marginLeft: 4,
  },
  sectionHint: {
    fontSize: 13,
    marginLeft: 4,
    marginBottom: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 60,
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  toggleInfo: {
    flex: 1,
    gap: 2,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  toggleHint: {
    fontSize: 12,
  },
  divider: {
    height: 1,
    marginLeft: 48,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  timeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  timeLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  timeRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeValue: {
    fontSize: 15,
    fontWeight: '600',
  },
  clearButton: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
