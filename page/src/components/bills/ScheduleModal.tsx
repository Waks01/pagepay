/**
 * ScheduleModal - Modal for scheduling recurring bill purchases
 * Supports one-time, daily, weekly, and monthly schedules
 */

import { useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";

import { apiFetch } from "@/src/shared/api/client";
import { PagePay } from "@/constants/theme";
import { useEffectiveScheme } from "@/src/shared/hooks/use-effective-scheme";

type ScheduleType = "once" | "daily" | "weekly" | "monthly";

type ScheduleOption = {
  id: ScheduleType;
  title: string;
  description: string;
  icon: string;
};

const SCHEDULE_OPTIONS: ScheduleOption[] = [
  {
    id: "once",
    title: "One Time",
    description: "Schedule for a specific date and time",
    icon: "calendar-outline",
  },
  {
    id: "daily",
    title: "Daily",
    description: "Repeat every day at the same time",
    icon: "refresh-outline",
  },
  {
    id: "weekly",
    title: "Weekly",
    description: "Repeat every week on the same day",
    icon: "calendar",
  },
  {
    id: "monthly",
    title: "Monthly",
    description: "Repeat every month on the same date",
    icon: "calendar-clear-outline",
  },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  service: string;
  defaultData?: {
    network?: string;
    phone?: string;
    amount?: number;
    plan_code?: string;
  };
};

export function ScheduleModal({
  visible,
  onClose,
  service,
  defaultData,
}: Props) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const queryClient = useQueryClient();

  const [scheduleType, setScheduleType] = useState<ScheduleType>("once");
  const [network, setNetwork] = useState(defaultData?.network || "mtn");
  const [phone, setPhone] = useState(defaultData?.phone || "");
  const [amount, setAmount] = useState(defaultData?.amount || 100);
  const [planCode, setPlanCode] = useState(defaultData?.plan_code || "");
  const [nextRunAt, setNextRunAt] = useState(
    new Date(Date.now() + 60 * 60 * 1000),
  ); // 1 hour from now
  const [showDatePicker, setShowDatePicker] = useState(false);

  const scheduleMutation = useMutation({
    mutationFn: async (data: {
      service: string;
      schedule_type: ScheduleType;
      next_run_at: string;
      network: string;
      phone: string;
      amount_naira: number;
      plan_code?: string;
    }) => {
      const response = await apiFetch("/api/v1/bills/schedule", {
        method: "POST",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to schedule purchase");
      }

      return response.json();
    },
    onSuccess: () => {
      Alert.alert(
        "Schedule Created",
        `Your ${service} purchase has been scheduled successfully. You'll receive notifications when it executes.`,
        [{ text: "OK" }],
      );
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      onClose();
      resetForm();
    },
    onError: (error: any) => {
      Alert.alert("Scheduling Failed", error.message);
    },
  });

  const resetForm = () => {
    setScheduleType("once");
    setNetwork(defaultData?.network || "mtn");
    setPhone(defaultData?.phone || "");
    setAmount(defaultData?.amount || 100);
    setPlanCode(defaultData?.plan_code || "");
    setNextRunAt(new Date(Date.now() + 60 * 60 * 1000));
  };

  const validateForm = () => {
    if (!phone.trim()) {
      Alert.alert("Validation Error", "Please enter a phone number");
      return false;
    }

    if (!/^0[789][01]\d{8}$/.test(phone.trim())) {
      Alert.alert(
        "Validation Error",
        "Please enter a valid Nigerian phone number",
      );
      return false;
    }

    if (amount < 50 || amount > 50000) {
      Alert.alert("Validation Error", "Amount must be between ₦50 and ₦50,000");
      return false;
    }

    if (service === "data" && !planCode.trim()) {
      Alert.alert("Validation Error", "Please select a data plan");
      return false;
    }

    if (nextRunAt <= new Date()) {
      Alert.alert("Validation Error", "Schedule time must be in the future");
      return false;
    }

    return true;
  };

  const handleSchedule = () => {
    if (!validateForm()) return;

    const scheduleOption = SCHEDULE_OPTIONS.find(
      (opt) => opt.id === scheduleType,
    );

    Alert.alert(
      "Confirm Schedule",
      `Schedule ${service} purchase?\n\n` +
        `Type: ${scheduleOption?.title}\n` +
        `Amount: ₦${amount.toLocaleString()}\n` +
        `Phone: ${phone}\n` +
        `Next Run: ${nextRunAt.toLocaleString()}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Schedule",
          onPress: () => {
            const data: any = {
              service,
              schedule_type: scheduleType,
              next_run_at: nextRunAt.toISOString(),
              network,
              phone: phone.trim(),
              amount_naira: amount,
            };

            if (service === "data" && planCode) {
              data.plan_code = planCode;
            }

            scheduleMutation.mutate(data);
          },
        },
      ],
    );
  };

  const formatNextRun = () => {
    const now = new Date();
    const diffMs = nextRunAt.getTime() - now.getTime();

    if (diffMs < 0) return "Past date";

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `In ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
    } else if (diffHours > 0) {
      return `In ${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
    } else {
      return `In ${Math.floor(diffMs / (1000 * 60))} minutes`;
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: tokens.paper }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: tokens.ink }]}>
              Schedule {service.charAt(0).toUpperCase() + service.slice(1)}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={tokens.inkMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Schedule Type Selection */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                Schedule Type
              </Text>

              {SCHEDULE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  onPress={() => setScheduleType(option.id)}
                  style={[
                    styles.scheduleOption,
                    {
                      backgroundColor:
                        scheduleType === option.id
                          ? tokens.mintSoft
                          : tokens.card,
                      borderColor:
                        scheduleType === option.id
                          ? tokens.mint
                          : tokens.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={option.icon as any}
                    size={20}
                    color={
                      scheduleType === option.id ? tokens.mint : tokens.inkMuted
                    }
                  />
                  <View style={styles.scheduleContent}>
                    <Text style={[styles.scheduleTitle, { color: tokens.ink }]}>
                      {option.title}
                    </Text>
                    <Text
                      style={[
                        styles.scheduleDescription,
                        { color: tokens.inkMuted },
                      ]}
                    >
                      {option.description}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.radioButton,
                      {
                        borderColor:
                          scheduleType === option.id
                            ? tokens.mint
                            : tokens.border,
                        backgroundColor:
                          scheduleType === option.id
                            ? tokens.mint
                            : "transparent",
                      },
                    ]}
                  >
                    {scheduleType === option.id && (
                      <Ionicons
                        name="checkmark"
                        size={12}
                        color={tokens.mintText}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Date & Time Selection */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                {scheduleType === "once" ? "Date & Time" : "Start Date & Time"}
              </Text>

              <TouchableOpacity
                onPress={() => setShowDatePicker(true)}
                style={[
                  styles.dateTimeButton,
                  { backgroundColor: tokens.card, borderColor: tokens.border },
                ]}
              >
                <Ionicons
                  name="time-outline"
                  size={20}
                  color={tokens.inkMuted}
                />
                <View style={styles.dateTimeContent}>
                  <Text style={[styles.dateTimeText, { color: tokens.ink }]}>
                    {nextRunAt.toLocaleString()}
                  </Text>
                  <Text
                    style={[styles.dateTimeSubtext, { color: tokens.inkMuted }]}
                  >
                    {formatNextRun()}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={tokens.inkMuted}
                />
              </TouchableOpacity>

              {showDatePicker && (
                <DateTimePicker
                  value={nextRunAt}
                  mode="datetime"
                  minimumDate={new Date()}
                  onChange={(event, selectedDate) => {
                    setShowDatePicker(false);
                    if (selectedDate) {
                      setNextRunAt(selectedDate);
                    }
                  }}
                />
              )}
            </View>

            {/* Network Selection */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                Network
              </Text>
              <View
                style={[
                  styles.networkDropdown,
                  { backgroundColor: tokens.card, borderColor: tokens.border },
                ]}
              >
                <TouchableOpacity
                  style={styles.networkSelector}
                  onPress={() => {
                    const networks = ["mtn", "airtel", "glo", "9mobile"];
                    const currentIndex = networks.indexOf(network);
                    const nextIndex = (currentIndex + 1) % networks.length;
                    setNetwork(networks[nextIndex]);
                  }}
                >
                  <Text style={[styles.networkText, { color: tokens.ink }]}>
                    {network.toUpperCase()}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={16}
                    color={tokens.inkMuted}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Phone Number */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                Phone Number
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: tokens.card,
                    borderColor: tokens.border,
                    color: tokens.ink,
                  },
                ]}
                value={phone}
                onChangeText={setPhone}
                placeholder="08012345678"
                placeholderTextColor={tokens.inkMuted}
                keyboardType="phone-pad"
                maxLength={11}
              />
            </View>

            {/* Amount */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                Amount (₦)
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: tokens.card,
                    borderColor: tokens.border,
                    color: tokens.ink,
                  },
                ]}
                value={amount.toString()}
                onChangeText={(text) => setAmount(parseInt(text) || 0)}
                placeholder="100"
                placeholderTextColor={tokens.inkMuted}
                keyboardType="numeric"
              />
            </View>

            {/* Data Plan (if service is data) */}
            {service === "data" && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: tokens.ink }]}>
                  Data Plan
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: tokens.card,
                      borderColor: tokens.border,
                      color: tokens.ink,
                    },
                  ]}
                  value={planCode}
                  onChangeText={setPlanCode}
                  placeholder="Select data plan"
                  placeholderTextColor={tokens.inkMuted}
                />
              </View>
            )}

            {/* Warning for recurring schedules */}
            {scheduleType !== "once" && (
              <View
                style={[
                  styles.warningBanner,
                  { backgroundColor: tokens.goldSoft },
                ]}
              >
                <Ionicons
                  name="warning-outline"
                  size={20}
                  color={tokens.gold}
                />
                <View style={styles.warningContent}>
                  <Text style={[styles.warningTitle, { color: tokens.gold }]}>
                    Recurring Purchase
                  </Text>
                  <Text style={[styles.warningText, { color: tokens.gold }]}>
                    This will automatically purchase {service} {scheduleType}{" "}
                    until you cancel the schedule. Ensure you have sufficient
                    balance for future purchases.
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Schedule Button */}
          <TouchableOpacity
            onPress={handleSchedule}
            disabled={scheduleMutation.isPending}
            style={[
              styles.scheduleBtn,
              {
                backgroundColor: scheduleMutation.isPending
                  ? tokens.cardSecondary
                  : tokens.mint,
              },
            ]}
          >
            <Text style={[styles.scheduleBtnText, { color: tokens.mintText }]}>
              {scheduleMutation.isPending
                ? "Scheduling..."
                : `Schedule ${service.charAt(0).toUpperCase() + service.slice(1)}`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    height: "90%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  closeBtn: {
    padding: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 12,
  },
  scheduleOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 12,
  },
  scheduleContent: {
    flex: 1,
    marginLeft: 12,
  },
  scheduleTitle: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  scheduleDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dateTimeButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  dateTimeContent: {
    flex: 1,
    marginLeft: 12,
  },
  dateTimeText: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 2,
  },
  dateTimeSubtext: {
    fontSize: 12,
  },
  textInput: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
  },
  warningBanner: {
    flexDirection: "row",
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  warningContent: {
    flex: 1,
    marginLeft: 8,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  warningText: {
    fontSize: 12,
    lineHeight: 16,
  },
  scheduleBtn: {
    height: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  scheduleBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
