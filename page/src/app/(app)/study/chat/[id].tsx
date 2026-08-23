import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PageHeader } from '@/components/PageHeader';

function ShimmerBar({ style: extraStyle, color }: { style?: object; color?: string }) {
  const opacity = useSharedValue(0.4);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  opacity.value = withRepeat(
    withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
    -1,
    true
  );

  return (
    <Animated.View style={[styles.shimmerBar, { backgroundColor: color ?? '#ccc' }, animatedStyle, extraStyle]} />
  );
}

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
};

export default function StudyChatScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const materialId = Number(id);
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [educationLevel, setEducationLevel] = useState<string>('secondary');
  const [difficulty, setDifficulty] = useState<string>('medium');
  const [showSettings, setShowSettings] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  const materialQ = useQuery({
    queryKey: ['study', 'material', materialId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  useEffect(() => {
    if (messages.length > 0) {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;

      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        text: text.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setStreaming(true);

      const assistantId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', text: '', timestamp: Date.now() },
      ]);

      try {
        const res = await apiFetch('/api/v1/study/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            material_id: materialId,
            message: text.trim(),
            education_level: educationLevel,
            difficulty,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || 'Chat failed');
        }

        const text = await res.text();
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text } : m)),
        );
      } catch (err) {
        const errorText = err instanceof Error ? err.message : 'Something went wrong';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: `Error: ${errorText}` }
              : m,
          ),
        );
      } finally {
        setStreaming(false);
      }
    },
    [materialId, streaming, educationLevel, difficulty],
  );

  const title = materialQ.data?.title ?? t('study_chat.title');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <PageHeader
        title={title}
        subtitle={t('study_chat.subtitle')}
        showBack
        onBack={() => router.back()}
        backgroundColor={tokens.card}
        borderBottomColor={tokens.border}
        tokens={tokens}
        right={
          <Pressable
            onPress={() => setShowSettings(!showSettings)}
            accessibilityRole="button"
            accessibilityLabel="Toggle chat settings"
            style={({ pressed }) => [
              styles.iconBtn,
              {
                borderColor: showSettings ? tokens.mint : tokens.border,
                backgroundColor: showSettings ? tokens.mintSoft : tokens.card,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              name={showSettings ? 'settings' : 'settings-outline'}
              size={18}
              color={showSettings ? tokens.mint : tokens.ink}
            />
          </Pressable>
        }
      />

      {showSettings && (
        <Animated.View
          entering={FadeInDown.duration(200).springify()}
          style={[styles.settingsBar, { backgroundColor: tokens.card, borderBottomColor: tokens.border }]}
        >
          <View style={styles.settingGroup}>
            <Text style={[styles.settingLabel, { color: tokens.inkMuted }]}>Level</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.settingOptions}>
              {['primary', 'secondary', 'tertiary', 'research'].map((level) => (
                <Pressable
                  key={level}
                  onPress={() => setEducationLevel(level)}
                  style={({ pressed }) => [
                    styles.settingChip,
                    {
                      backgroundColor: educationLevel === level ? tokens.mint : tokens.paper,
                      borderColor: educationLevel === level ? tokens.mint : tokens.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.settingChipText,
                      { color: educationLevel === level ? tokens.mintText : tokens.ink },
                    ]}
                  >
                    {level}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <View style={styles.settingGroup}>
            <Text style={[styles.settingLabel, { color: tokens.inkMuted }]}>Difficulty</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.settingOptions}>
              {['easy', 'medium', 'hard'].map((diff) => (
                <Pressable
                  key={diff}
                  onPress={() => setDifficulty(diff)}
                  style={({ pressed }) => [
                    styles.settingChip,
                    {
                      backgroundColor: difficulty === diff ? tokens.mint : tokens.paper,
                      borderColor: difficulty === diff ? tokens.mint : tokens.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.settingChipText,
                      { color: difficulty === diff ? tokens.mintText : tokens.ink },
                    ]}
                  >
                    {diff}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Animated.View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesArea}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: tokens.mintSoft }]}>
                <Ionicons name="chatbubbles-outline" size={28} color={tokens.mint} />
              </View>
              <Text
                style={[styles.emptyTitle, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}
              >
                Ask anything
              </Text>
              <Text style={[styles.emptyText, { color: tokens.inkMuted }]}>
                {t('study_chat.empty_message')}
              </Text>
            </View>
          )}
          {messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.msgRow,
                msg.role === 'user' ? styles.userRow : styles.assistantRow,
              ]}
            >
              {msg.role === 'assistant' ? (
                <View style={[styles.assistantAvatar, { backgroundColor: tokens.mintSoft }]}>
                  <Ionicons name="sparkles" size={14} color={tokens.mint} />
                </View>
              ) : null}
              <View
                style={[
                  styles.bubble,
                  {
                    backgroundColor: msg.role === 'user' ? tokens.mint : tokens.card,
                    borderColor: msg.role === 'user' ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    { color: msg.role === 'user' ? tokens.mintText : tokens.ink },
                  ]}
                >
                  {msg.text}
                </Text>
                {streaming && msg.role === 'assistant' && msg.text === '' ? (
                  <View style={styles.shimmerContainer}>
                    <ShimmerBar style={{ width: '60%' }} color={tokens.border} />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <ShimmerBar style={{ width: '40%' }} color={tokens.border} />
                      <ShimmerBar style={{ width: '30%' }} color={tokens.border} />
                    </View>
                  </View>
                ) : streaming && msg.role === 'assistant' ? (
                  <View style={[styles.streamingDot, { backgroundColor: tokens.mint }]} />
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={[styles.inputBar, { backgroundColor: tokens.card, borderTopColor: tokens.border }]}>
          <TextInput
            style={[styles.input, { backgroundColor: tokens.paper, color: tokens.ink, borderColor: tokens.border }]}
            placeholder={t('study_chat.placeholder')}
            placeholderTextColor={tokens.inkMuted}
            value={input}
            onChangeText={setInput}
            editable={!streaming}
            multiline
            maxLength={2000}
          />
          <Pressable
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: input.trim() && !streaming ? tokens.mint : tokens.border,
                opacity: pressed && input.trim() ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons
              name="arrow-up"
              size={20}
              color={input.trim() && !streaming ? tokens.mintText : tokens.inkMuted}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsBar: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingGroup: {
    gap: 6,
  },
  settingLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  settingOptions: {
    flexDirection: 'row',
    gap: 6,
  },
  settingChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  settingChipText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  messagesArea: {
    flex: 1,
  },
  messagesContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 10,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 18,
    letterSpacing: -0.3,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  assistantRow: {
    justifyContent: 'flex-start',
  },
  assistantAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  streamingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 4,
    opacity: 0.6,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shimmerContainer: {
    gap: 6,
    paddingVertical: 4,
  },
  shimmerBar: {
    height: 12,
    borderRadius: 6,
  },
});
