import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { adminCreateTask } from '@/src/features/admin/api';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

const PLATFORMS = ['youtube', 'instagram', 'twitter', 'tiktok', 'facebook', 'website'];

export default function AdminCreateTaskScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [platform, setPlatform] = useState('youtube');
  const [targetUrl, setTargetUrl] = useState('');
  const [reward, setReward] = useState('100');
  const [maxCompletions, setMaxCompletions] = useState('500');
  const [expiresInDays, setExpiresInDays] = useState('30');

  const createMutation = useMutation({
    mutationFn: () =>
      adminCreateTask({
        title,
        description,
        instructions,
        platform,
        category: 'social',
        reward_type: 'points',
        reward_amount: parseInt(reward, 10),
        target_url: targetUrl || undefined,
        proof_type: 'screenshot',
        max_completions: parseInt(maxCompletions, 10),
        expires_in_days: parseInt(expiresInDays, 10),
      }),
    onSuccess: () => {
      Alert.alert('Task created', 'Your task is now live.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Failed to create task');
    },
  });

  const handleSubmit = () => {
    if (!title || !description || !instructions) {
      Alert.alert('Missing fields', 'Please fill in all required fields.');
      return;
    }
    const rewardNum = parseInt(reward, 10);
    const maxNum = parseInt(maxCompletions, 10);
    const daysNum = parseInt(expiresInDays, 10);

    if (Number.isNaN(rewardNum) || rewardNum < 1) {
      Alert.alert('Invalid reward', 'Reward must be at least 1 point.');
      return;
    }
    if (Number.isNaN(maxNum) || maxNum < 1) {
      Alert.alert('Invalid limit', 'Max completions must be at least 1.');
      return;
    }
    if (Number.isNaN(daysNum) || daysNum < 1) {
      Alert.alert('Invalid expiry', 'Expiry must be at least 1 day.');
      return;
    }

    createMutation.mutate();
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.paper }]}>
      <View style={[styles.header, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={tokens.ink} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: tokens.ink }]}>Create Task</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={[styles.label, { color: tokens.ink }]}>Task Title</Text>
          <TextInput
            style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Subscribe to PagePay on YouTube"
            placeholderTextColor={tokens.inkMuted}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: tokens.ink }]}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
            value={description}
            onChangeText={setDescription}
            placeholder="Short description shown on the task card"
            placeholderTextColor={tokens.inkMuted}
            multiline
            numberOfLines={3}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: tokens.ink }]}>Instructions</Text>
          <TextInput
            style={[styles.input, styles.textArea, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
            value={instructions}
            onChangeText={setInstructions}
            placeholder="Step-by-step instructions for the user"
            placeholderTextColor={tokens.inkMuted}
            multiline
            numberOfLines={4}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: tokens.ink }]}>Platform</Text>
          <View style={styles.pillsRow}>
            {PLATFORMS.map((p) => (
              <TouchableOpacity
                key={p}
                style={[
                  styles.pill,
                  platform === p && { backgroundColor: tokens.mint, borderColor: tokens.mint },
                ]}
                onPress={() => setPlatform(p)}
              >
                <Text
                  style={[
                    styles.pillText,
                    { color: platform === p ? '#fff' : tokens.inkMuted },
                  ]}
                >
                  {p}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: tokens.ink }]}>Task URL</Text>
          <TextInput
            style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
            value={targetUrl}
            onChangeText={setTargetUrl}
            placeholder="https://youtube.com/@pagepay"
            placeholderTextColor={tokens.inkMuted}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.section, styles.halfWidth]}>
            <Text style={[styles.label, { color: tokens.ink }]}>Points Reward</Text>
            <TextInput
              style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
              value={reward}
              onChangeText={setReward}
              placeholder="100"
              placeholderTextColor={tokens.inkMuted}
              keyboardType="numeric"
            />
          </View>

          <View style={[styles.section, styles.halfWidth]}>
            <Text style={[styles.label, { color: tokens.ink }]}>Max Completions</Text>
            <TextInput
              style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
              value={maxCompletions}
              onChangeText={setMaxCompletions}
              placeholder="500"
              placeholderTextColor={tokens.inkMuted}
              keyboardType="numeric"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: tokens.ink }]}>Expires In (days)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
            value={expiresInDays}
            onChangeText={setExpiresInDays}
            placeholder="30"
            placeholderTextColor={tokens.inkMuted}
            keyboardType="numeric"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, createMutation.isPending && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
              <Text style={styles.submitButtonText}>Create Task</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    fontFamily: 'SpaceGrotesk_600',
  },
  input: {
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    borderWidth: 1,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E2DA',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
    fontFamily: 'SpaceGrotesk_600',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  submitButton: {
    backgroundColor: '#0E7C66',
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#E5E2DA',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
});
