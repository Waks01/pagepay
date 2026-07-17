import { useCallback, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

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
  const flatListRef = useRef<FlatList>(null);
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
          body: JSON.stringify({ material_id: materialId, message: text.trim() }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || 'Chat failed');
        }

        const reader = res.body?.getReader();
        if (!reader) {
          const text = await res.text();
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text } : m)),
          );
          return;
        }

        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: accumulated } : m)),
          );
        }
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
    [materialId, streaming],
  );

  const title = materialQ.data?.title ?? t('study_chat.title');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <View style={[styles.header, { borderBottomColor: tokens.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color={tokens.mint} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>{t('study_chat.subtitle')}</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          ref={scrollViewRef}
          style={[styles.messagesArea, { backgroundColor: tokens.paper }]}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="chatbubbles-outline" size={40} color={tokens.mint} />
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
                  {streaming && msg.role === 'assistant' && msg.text === '' && (
                    <View style={styles.shimmerContainer}>
                      <ShimmerBar style={{ width: '60%' }} color={tokens.border} />
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                        <ShimmerBar style={{ width: '40%' }} color={tokens.border} />
                        <ShimmerBar style={{ width: '30%' }} color={tokens.border} />
                      </View>
                    </View>
                  )}
                </Text>
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
          <TouchableOpacity
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            activeOpacity={0.7}
            style={[
              styles.sendBtn,
              {
                backgroundColor: input.trim() && !streaming ? tokens.mint : tokens.border,
              },
            ]}
          >
            <Ionicons
              name="send"
              size={18}
              color={input.trim() && !streaming ? tokens.mintText : tokens.inkMuted}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  messagesArea: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  messagesContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  msgRow: {
    flexDirection: 'row',
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  assistantRow: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
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
