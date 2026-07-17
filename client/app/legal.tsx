import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { apiFetch, publicApiFetch } from '@/src/shared/api/client';
import { PageMark } from '@/components/PageMark';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type LegalParams = { slug?: string };

export default function LegalScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<LegalParams>();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const slug = params.slug || 'terms';

  const [title, setTitle] = useState(t('legal.loading'));
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await publicApiFetch(`/api/v1/legal/${slug}`);
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        if (!cancelled) {
          setTitle(data.title || slug);
          setContent(data.content || '');
        }
      } catch (e) {
        if (!cancelled) setError(t('legal.load_error'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, t]);

  return (
    <View style={[styles.root, { backgroundColor: tokens.paper }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.title, { color: tokens.ink }]}>{title}</Text>
          {error ? (
            <Text style={[styles.content, { color: tokens.signal }]}>{error}</Text>
          ) : (
            <Text style={[styles.content, { color: tokens.inkMuted }]}>
              {content}
            </Text>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <PageMark />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 12,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 8,
  },
  content: {
    fontSize: 15,
    lineHeight: 22,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
});
