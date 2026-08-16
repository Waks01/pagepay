import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useState, useEffect, useMemo } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { createTask, publishTask } from '@/src/features/sponsor/api';
import { usePlatformConfig } from '@/src/shared/hooks/use-platform-config';
import { useTaskRateCard, TaskRateEntry } from '@/src/shared/hooks/use-task-rate-card';
import { TASK_TEMPLATES, getTemplatesForCategory, getTemplateByType, type TaskTemplate } from '@/src/features/tasks/templates';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

const PLATFORMS = [
  { key: 'twitter', label: 'Twitter/X', icon: 'logo-twitter' },
  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram' },
  { key: 'tiktok', label: 'TikTok', icon: 'logo-tiktok' },
  { key: 'youtube', label: 'YouTube', icon: 'logo-youtube' },
  { key: 'facebook', label: 'Facebook', icon: 'logo-facebook' },
  { key: 'linkedin', label: 'LinkedIn', icon: 'logo-linkedin' },
  { key: 'pinterest', label: 'Pinterest', icon: 'logo-pinterest' },
  { key: 'telegram', label: 'Telegram', icon: 'send-outline' },
  { key: 'snapchat', label: 'Snapchat', icon: 'logo-snapchat' },
  { key: 'reddit', label: 'Reddit', icon: 'logo-reddit' },
  { key: 'discord', label: 'Discord', icon: 'logo-discord' },
  { key: 'website', label: 'Website', icon: 'globe-outline' },
  { key: 'app', label: 'App', icon: 'phone-portrait-outline' },
];

const MULTIPLIERS = [1.0, 1.5, 2.0, 3.0, 5.0];

export default function CreateTaskScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const { data: platformConfig } = usePlatformConfig();
  const taskPlatformFeePercent = Math.round((platformConfig?.task_revenue_platform_percent ?? 0.30) * 100);

  const [selectedCategory, setSelectedCategory] = useState<string>('social_media');
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(null);
  const [platform, setPlatform] = useState('twitter');
  const [taskType, setTaskType] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [rewardKobo, setRewardKobo] = useState('');
  const [rewardMultiplier, setRewardMultiplier] = useState(1.0);
  const [maxCompletions, setMaxCompletions] = useState('');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<string>('');

  const rateCard = useTaskRateCard(platform);
  const activeRate = rateCard.find((rate) => rate.taskType === taskType);

  const categoryTemplates = useMemo(
    () => getTemplatesForCategory(selectedCategory),
    [selectedCategory]
  );

  useEffect(() => {
    if (selectedTemplate) {
      setTaskType(selectedTemplate.task_type);
      setInstructions(selectedTemplate.instructions_template);
      if (selectedTemplate.suggested_reward_kobo) {
        setRewardKobo(String(selectedTemplate.suggested_reward_kobo));
      }
      if (selectedTemplate.suggested_time_limit_minutes) {
        setTimeLimitMinutes(String(selectedTemplate.suggested_time_limit_minutes));
      }
    }
  }, [selectedTemplate]);

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
                { text: 'OK', onPress: () => router.back() },
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
    if (!title || !description || !instructions || !taskType) {
      Alert.alert(t('sponsor_create_task.errors.missing_fields'));
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
        `Minimum reward for ${activeRate.label} is ₦${(activeRate.baseRateKobo / 100).toFixed(2)}`
      );
      return;
    }

    if (isNaN(max) || max < 500) {
      Alert.alert(t('sponsor_create_task.errors.invalid_completions'), t('sponsor_create_task.errors.min_order_quantity'));
      return;
    }

    createMutation.mutate({
      title,
      description,
      instructions,
      task_type: taskType,
      platform,
      category: selectedCategory,
      target_url: targetUrl || undefined,
      proof_type: selectedTemplate?.suggested_proof_type || 'screenshot',
      reward_amount_kobo: reward,
      reward_multiplier: rewardMultiplier,
      max_completions: max,
      expires_in_days: 7,
      ai_verification_enabled: true,
      time_limit_minutes: timeLimitMinutes ? parseInt(timeLimitMinutes) : undefined,
    });
  };

  const handleSelectTemplate = (template: TaskTemplate) => {
    setSelectedTemplate(template);
    setTaskType(template.task_type);
    setInstructions(template.instructions_template);
    if (template.suggested_reward_kobo) {
      setRewardKobo(String(template.suggested_reward_kobo));
    }
    if (template.suggested_time_limit_minutes) {
      setTimeLimitMinutes(String(template.suggested_time_limit_minutes));
    }
  };

  const renderTemplatePicker = () => (
    <View style={styles.section}>
      <Text style={styles.label}>{t('sponsor_create_task.template_label')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.templateScroll}>
        <TouchableOpacity
          style={[
            styles.templateCard,
            !selectedTemplate && styles.templateCardActive,
            !selectedTemplate && { borderColor: tokens.mint },
          ]}
          onPress={() => setSelectedTemplate(null)}
        >
          <Ionicons name="create-outline" size={24} color={!selectedTemplate ? tokens.mint : tokens.inkMuted} />
          <Text style={[styles.templateCardText, !selectedTemplate && { color: tokens.mint }]}>
            {t('sponsor_create_task.custom_template')}
          </Text>
        </TouchableOpacity>
        {TASK_TEMPLATES.map((cat) =>
          cat.templates.map((tmpl) => (
            <TouchableOpacity
              key={tmpl.task_type}
              style={[
                styles.templateCard,
                selectedTemplate?.task_type === tmpl.task_type && styles.templateCardActive,
                selectedTemplate?.task_type === tmpl.task_type && { borderColor: tokens.mint, backgroundColor: tokens.mintSoft },
              ]}
              onPress={() => handleSelectTemplate(tmpl)}
            >
              <Text style={[styles.templateCardText, selectedTemplate?.task_type === tmpl.task_type && { color: tokens.mint }]}>
                {tmpl.label}
              </Text>
              <Text style={styles.templateCardHint}>
                ₦{(tmpl.suggested_reward_kobo / 100).toFixed(0)}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );

  const renderCategoryPicker = () => (
    <View style={styles.section}>
      <Text style={styles.label}>{t('sponsor_create_task.category_label')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
        {TASK_TEMPLATES.map((cat) => {
          const isActive = selectedCategory === cat.category;
          return (
            <TouchableOpacity
              key={cat.category}
              style={[
                styles.categoryChip,
                isActive && { backgroundColor: tokens.mint },
                !isActive && { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
              onPress={() => {
                setSelectedCategory(cat.category);
                setSelectedTemplate(null);
              }}
            >
              <Ionicons name={cat.icon as any} size={16} color={isActive ? tokens.mintText : tokens.inkMuted} />
              <Text style={[styles.categoryChipText, isActive && { color: tokens.mintText }]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.paper }]} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { backgroundColor: tokens.card }]}>
          <Ionicons name="arrow-back" size={24} color={tokens.ink} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: tokens.ink }]}>{t('sponsor_create_task.title')}</Text>
      </View>

      {renderCategoryPicker()}
      {renderTemplatePicker()}

      <View style={styles.section}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_create_task.title_label')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('sponsor_create_task.title_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={title}
          onChangeText={setTitle}
        />
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_create_task.description_label')}</Text>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('sponsor_create_task.description_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
        />
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_create_task.instructions_label')}</Text>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('sponsor_create_task.instructions_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={instructions}
          onChangeText={setInstructions}
          multiline
          numberOfLines={4}
        />
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_create_task.platform_label')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillsScroll}>
          {PLATFORMS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[
                styles.pill,
                platform === p.key && { backgroundColor: tokens.mint },
                platform !== p.key && { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
              onPress={() => setPlatform(p.key)}
            >
              <Ionicons name={p.icon as any} size={14} color={platform === p.key ? tokens.mintText : tokens.inkMuted} />
              <Text style={[styles.pillText, platform === p.key && { color: tokens.mintText }]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_create_task.target_url_label')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('sponsor_create_task.target_url_placeholder')}
          placeholderTextColor={tokens.inkMuted}
          value={targetUrl}
          onChangeText={setTargetUrl}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.row}>
        <View style={[styles.section, styles.halfWidth]}>
          <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_create_task.reward_label')}</Text>
          {activeRate && (
            <View style={[styles.rateCard, { backgroundColor: tokens.mintSoft }]}>
              <Text style={[styles.rateLabel, { color: tokens.mint }]}>{t('sponsor_create_task.base_rate_label', { defaultValue: 'Base rate' })}</Text>
              <Text style={[styles.rateValue, { color: tokens.mint }]}>₦{(activeRate.baseRateKobo / 100).toFixed(2)}</Text>
              <Text style={[styles.rateNote, { color: tokens.mint }]}>
                {t('sponsor_create_task.platform_controlled_minimum')}
              </Text>
            </View>
          )}
          <TextInput
            style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
            placeholder={t('sponsor_create_task.reward_placeholder')}
            placeholderTextColor={tokens.inkMuted}
            value={(parseInt(rewardKobo) / 100).toFixed(2)}
            onChangeText={(val) => setRewardKobo((parseFloat(val) * 100).toString())}
            keyboardType="numeric"
          />
        </View>

        <View style={[styles.section, styles.halfWidth]}>
          <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_create_task.max_workers_label')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
            placeholder={t('sponsor_create_task.max_workers_placeholder')}
            placeholderTextColor={tokens.inkMuted}
            value={maxCompletions}
            onChangeText={setMaxCompletions}
            keyboardType="numeric"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('sponsor_create_task.time_limit_label')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: tokens.card, color: tokens.ink, borderColor: tokens.border }]}
          placeholder={t('sponsor_create_task.time_limit_placeholder', { defaultValue: 'e.g. 10' })}
          placeholderTextColor={tokens.inkMuted}
          value={timeLimitMinutes}
          onChangeText={setTimeLimitMinutes}
          keyboardType="numeric"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('sponsor_create_task.visibility_boost_label')}</Text>
        <View style={styles.pillsContainer}>
          {MULTIPLIERS.map((mult) => (
            <TouchableOpacity
              key={String(mult)}
              style={[
                styles.pill,
                rewardMultiplier === mult && { backgroundColor: tokens.mint },
                rewardMultiplier !== mult && { backgroundColor: tokens.card, borderColor: tokens.border },
              ]}
              onPress={() => setRewardMultiplier(mult)}
            >
              <Text style={[styles.pillText, rewardMultiplier === mult && { color: tokens.mintText }]}>
                {mult}x
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[styles.multiplierNote, { color: tokens.inkMuted }]}>
          {rewardMultiplier > 1.0
            ? t('sponsor_create_task.workers_earn_with_boost', {
                amount: ((parseInt(rewardKobo || '0') * rewardMultiplier) / 100).toFixed(2),
              })
            : t('sponsor_create_task.no_boost_note')}
        </Text>
      </View>

      <View style={[styles.costCard, { backgroundColor: tokens.mintSoft }]}>
        <Text style={[styles.costLabel, { color: tokens.mint }]}>{t('sponsor_create_task.estimated_cost_label')}</Text>
        <Text style={[styles.costValue, { color: tokens.mint }]}>
          ₦{((parseInt(rewardKobo || '0') * rewardMultiplier * parseInt(maxCompletions || '0')) / 100).toFixed(2)}
        </Text>
        <Text style={[styles.costNote, { color: tokens.mint }]}>
          {t('sponsor_create_task.platform_fee_note', { percent: taskPlatformFeePercent })}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.submitButton, { backgroundColor: tokens.mint }, createMutation.isPending && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={createMutation.isPending}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color={tokens.mintText} />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={24} color={tokens.mintText} />
            <Text style={[styles.submitButtonText, { color: tokens.mintText }]}>
              {t('sponsor_create_task.submit_button')}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
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
  pillsScroll: {
    flexDirection: 'row',
    gap: 8,
  },
  pillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_600',
    textTransform: 'capitalize',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  rateCard: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  rateLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  rateValue: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 2,
  },
  rateNote: {
    fontSize: 11,
  },
  multiplierNote: {
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  costCard: {
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 24,
  },
  costLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  costValue: {
    fontSize: 32,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 4,
  },
  costNote: {
    fontSize: 12,
  },
  submitButton: {
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  categoryScroll: {
    maxHeight: 44,
    marginBottom: 4,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk_600',
  },
  templateScroll: {
    flexDirection: 'row',
    gap: 10,
  },
  templateCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginRight: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E5E2DA',
    minWidth: 100,
    gap: 6,
  },
  templateCardActive: {
    borderWidth: 2,
  },
  templateCardText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
    textAlign: 'center',
    color: '#333',
  },
  templateCardHint: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
  },
});
