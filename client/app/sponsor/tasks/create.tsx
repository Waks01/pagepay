import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { createTask, publishTask } from '@/src/features/sponsor/api';
import { usePlatformConfig } from '@/src/shared/hooks/use-platform-config';
import { useTaskRateCard, TaskRateEntry } from '@/src/shared/hooks/use-task-rate-card';

const PLATFORMS = ['twitter', 'instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'pinterest', 'telegram', 'snapchat', 'reddit', 'discord', 'website', 'app'];
const TASK_TYPES = ['follow', 'like', 'subscribe', 'retweet', 'comment', 'share', 'visit', 'signup', 'download', 'review'];

export default function CreateTaskScreen() {
  const { t } = useTranslation();
  const { data: platformConfig } = usePlatformConfig();
  const taskPlatformFeePercent = Math.round((platformConfig?.task_revenue_platform_percent ?? 0.30) * 100);
  const rateCard = useTaskRateCard(platform);
  const activeRate = rateCard.find((rate) => rate.taskType === taskType);
  const hasRates = rateCard.length > 0;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [platform, setPlatform] = useState('twitter');
  const [taskType, setTaskType] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState('');
  const [rewardKobo, setRewardKobo] = useState('5000');
  const [rewardMultiplier, setRewardMultiplier] = useState(1.0);
  const [maxCompletions, setMaxCompletions] = useState('500');

  useEffect(() => {
    setTaskType(null);
    setRewardKobo('5000');
    setRewardMultiplier(1.0);
  }, [platform]);

  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: async (data) => {
      Alert.alert(t('sponsor_create_task.success_title'), t('sponsor_create_task.publish_prompt'), [
        { text: t('sponsor_create_task.later_button'), onPress: () => router.back() },
        {
          text: t('sponsor_create_task.publish_button'),
          onPress: async () => {
            try {
              await publishTask(data.id);
              Alert.alert(t('sponsor_create_task.published_title'), t('sponsor_create_task.published_message'), [
                { text: 'OK', onPress: () => router.back() }
              ]);
            } catch (error: any) {
              Alert.alert(t('sponsor_create_task.errors.publish_failed'), error.message);
            }
          },
        },
      ]);
    },
    onError: (error: any) => {
      Alert.alert(t('sponsor_create_task.errors.creation_failed'), error.message);
    },
  });

  const handleSubmit = () => {
    if (!title || !description || !instructions) {
      Alert.alert(t('sponsor_create_task.errors.missing_fields'));
      return;
    }

    if (!taskType) {
      Alert.alert('Select a task type');
      return;
    }

    const reward = parseInt(rewardKobo);
    const max = parseInt(maxCompletions);

    if (isNaN(reward) || reward < 1000) {
      Alert.alert(t('sponsor_create_task.errors.invalid_reward'));
      return;
    }

    if (activeRate && reward < activeRate.baseRateKobo) {
      Alert.alert(
        'Invalid reward',
        `Minimum reward for ${activeRate.label} is ₦${(activeRate.baseRateKobo / 100).toFixed(2)}`,
      );
      return;
    }

    if (isNaN(max) || max < 500) {
      Alert.alert(t('sponsor_create_task.errors.invalid_completions'), 'Minimum 500 tasks per order');
      return;
    }

    createMutation.mutate({
      title,
      description,
      instructions,
      task_type: taskType,
      platform,
      category: 'social_media',
      target_url: targetUrl || undefined,
      proof_type: 'screenshot',
      reward_amount_kobo: reward,
      reward_multiplier: rewardMultiplier,
      max_completions: max,
      expires_in_days: 7,
      ai_verification_enabled: true,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('sponsor_create_task.title')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('sponsor_create_task.title_label')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('sponsor_create_task.title_placeholder')}
          value={title}
          onChangeText={setTitle}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('sponsor_create_task.description_label')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder={t('sponsor_create_task.description_placeholder')}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('sponsor_create_task.instructions_label')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder={t('sponsor_create_task.instructions_placeholder')}
          value={instructions}
          onChangeText={setInstructions}
          multiline
          numberOfLines={3}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('sponsor_create_task.platform_label')}</Text>
        <View style={styles.pillsContainer}>
          {PLATFORMS.map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.pill, platform === p && styles.pillActive]}
              onPress={() => setPlatform(p)}
            >
              <Text style={[styles.pillText, platform === p && styles.pillTextActive]}>
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('sponsor_create_task.task_type_label')}</Text>
        {hasRates ? (
          <View style={styles.rateGrid}>
            {rateCard.map((rate) => (
              <TouchableOpacity
                key={rate.taskType}
                style={[
                  styles.rateOption,
                  taskType === rate.taskType && styles.rateOptionActive,
                ]}
                onPress={() => handleSelectRate(rate)}
              >
                <Text style={[styles.rateOptionLabel, taskType === rate.taskType && styles.rateOptionLabelActive]}>
                  {rate.label}
                </Text>
                <Text style={[styles.rateOptionValue, taskType === rate.taskType && styles.rateOptionValueActive]}>
                  ₦{(rate.baseRateKobo / 100).toFixed(2)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.pillsContainer}>
            {TASK_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.pill, taskType === type && styles.pillActive]}
                onPress={() => setTaskType(type)}
              >
                <Text style={[styles.pillText, taskType === type && styles.pillTextActive]}>
                  {type}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('sponsor_create_task.target_url_label')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('sponsor_create_task.target_url_placeholder')}
          value={targetUrl}
          onChangeText={setTargetUrl}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.row}>
        <View style={[styles.section, styles.halfWidth]}>
          <Text style={styles.label}>{t('sponsor_create_task.reward_label')}</Text>
          {activeRate ? (
            <View style={styles.rateCard}>
              <Text style={styles.rateLabel}>Base rate</Text>
              <Text style={styles.rateValue}>₦{(activeRate.baseRateKobo / 100).toFixed(2)}</Text>
              <Text style={styles.rateNote}>Platform-controlled minimum</Text>
            </View>
          ) : null}
          <TextInput
            style={styles.input}
            placeholder={t('sponsor_create_task.reward_placeholder')}
            value={(parseInt(rewardKobo) / 100).toFixed(2)}
            onChangeText={(val) => setRewardKobo((parseFloat(val) * 100).toString())}
            keyboardType="numeric"
          />
        </View>

        <View style={[styles.section, styles.halfWidth]}>
          <Text style={styles.label}>{t('sponsor_create_task.max_workers_label')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('sponsor_create_task.max_workers_placeholder')}
            value={maxCompletions}
            onChangeText={setMaxCompletions}
            keyboardType="numeric"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Visibility boost</Text>
        <View style={styles.pillsContainer}>
          {[1.0, 1.5, 2.0, 3.0, 5.0].map((mult) => (
            <TouchableOpacity
              key={String(mult)}
              style={[styles.pill, rewardMultiplier === mult && styles.pillActive]}
              onPress={() => setRewardMultiplier(mult)}
            >
              <Text style={[styles.pillText, rewardMultiplier === mult && styles.pillTextActive]}>
                {mult}x
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.multiplierNote}>
          {rewardMultiplier > 1.0
            ? `Workers earn ₦${((parseInt(rewardKobo) * rewardMultiplier) / 100).toFixed(2)} per task`
            : 'No boost — workers earn the base rate'}
        </Text>
      </View>

      <View style={styles.costCard}>
        <Text style={styles.costLabel}>{t('sponsor_create_task.estimated_cost_label')}</Text>
        <Text style={styles.costValue}>
          ₦{((parseInt(rewardKobo) * rewardMultiplier * parseInt(maxCompletions)) / 100).toFixed(2)}
        </Text>
        <Text style={styles.costNote}>{t('sponsor_create_task.platform_fee_note', { percent: taskPlatformFeePercent })}</Text>
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
            <Text style={styles.submitButtonText}>{t('sponsor_create_task.submit_button')}</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  pillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  pillActive: {
    backgroundColor: '#6C5CE7',
    borderColor: '#6C5CE7',
  },
  pillText: {
    fontSize: 14,
    color: '#666',
    textTransform: 'capitalize',
  },
  pillTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  rateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  rateOption: {
    flexBasis: '48%',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    padding: 12,
  },
  rateOptionActive: {
    backgroundColor: '#6C5CE7',
    borderColor: '#6C5CE7',
  },
  rateOptionLabel: {
    fontSize: 13,
    color: '#333',
    marginBottom: 4,
    textTransform: 'capitalize',
  },
  rateOptionLabelActive: {
    color: '#fff',
  },
  rateOptionValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6C5CE7',
  },
  rateOptionValueActive: {
    color: '#fff',
  },
  rateCard: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  rateLabel: {
    fontSize: 12,
    color: '#2E7D32',
    marginBottom: 4,
  },
  rateValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1B5E20',
    marginBottom: 2,
  },
  rateNote: {
    fontSize: 11,
    color: '#2E7D32',
  },
  multiplierNote: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
    fontStyle: 'italic',
  },
  costCard: {
    backgroundColor: '#E3F2FD',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 24,
  },
  costLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  costValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#6C5CE7',
    marginBottom: 4,
  },
  costNote: {
    fontSize: 12,
    color: '#666',
  },
  submitButton: {
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
