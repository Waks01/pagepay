import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { publicApiFetch } from '@/src/shared/api/client';
import { PageMark } from '@/components/PageMark';
import { Skeleton } from '@/components/Skeleton';
import { PagePay, PagePayScheme } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type LegalParams = { slug?: string };

type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' };

/**
 * Tiny markdown renderer for legal docs. Handles the subset the backend emits:
 *   # H1, ## H2, ### H3, - bullets, 1. numbered lists, **bold**, > quotes, ---.
 * Anything else falls through as a paragraph. No deps — react-native-markdown
 * or marked are heavyweight and pull Reanimated/Worklets we don't need here.
 */
function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Blank line — skip.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^-{3,}\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // Headings.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      if (level === 1) blocks.push({ kind: 'h1', text });
      else if (level === 2) blocks.push({ kind: 'h2', text });
      else blocks.push({ kind: 'h3', text });
      i++;
      continue;
    }

    // Blockquote (collapse consecutive `> ...` lines into one quote).
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trimEnd())) {
        buf.push(lines[i].trimEnd().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'quote', text: buf.join(' ') });
      continue;
    }

    // Unordered list (- or *).
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trimEnd())) {
        items.push(lines[i].trimEnd().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // Ordered list (1. 2. 3.).
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trimEnd())) {
        items.push(lines[i].trimEnd().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // Paragraph — collect until blank line / heading / list / quote.
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i].trimEnd()) &&
      !/^[-*]\s+/.test(lines[i].trimEnd()) &&
      !/^\d+\.\s+/.test(lines[i].trimEnd()) &&
      !/^>\s?/.test(lines[i].trimEnd()) &&
      !/^-{3,}\s*$/.test(lines[i].trimEnd())
    ) {
      buf.push(lines[i].trimEnd());
      i++;
    }
    blocks.push({ kind: 'p', text: buf.join(' ') });
  }
  return blocks;
}

/** Render inline markdown: **bold**, *italic*, `code`. Returns a React node tree. */
function renderInline(text: string, baseStyle: any, accentStyle: any) {
  // Split on **...**, *...*, `...`. Keeps order via token array.
  const nodes: any[] = [];
  let remaining = text;
  let key = 0;
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(remaining)) !== null) {
    if (m.index > lastIndex) {
      nodes.push({ k: key++, t: remaining.slice(lastIndex, m.index), b: false, i: false, c: false });
    }
    if (m[2] !== undefined) {
      nodes.push({ k: key++, t: m[2], b: true, i: false, c: false });
    } else if (m[3] !== undefined) {
      nodes.push({ k: key++, t: m[3], b: false, i: true, c: false });
    } else if (m[4] !== undefined) {
      nodes.push({ k: key++, t: m[4], b: false, i: false, c: true });
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < remaining.length) {
    nodes.push({ k: key++, t: remaining.slice(lastIndex), b: false, i: false, c: false });
  }
  return nodes.map((n) => {
    const styleArr = [baseStyle];
    if (n.b) styleArr.push(accentStyle);
    if (n.i) styleArr.push({ fontStyle: 'italic' as const });
    if (n.c) {
      styleArr.push({
        fontFamily: 'monospace',
        fontSize: (baseStyle.fontSize as number) - 1,
      });
    }
    return (
      <Text key={n.k} style={styleArr}>
        {n.t}
      </Text>
    );
  });
}

export default function LegalScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<LegalParams>();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const slug = params.slug || 'terms';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await publicApiFetch(`/api/v1/legal/${slug}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setTitle(data.title || slug);
          setContent(data.content || '');
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(t('legal.load_error'));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, t]);

  const blocks = useMemo(() => (content ? parseMarkdown(content) : []), [content]);

  // Drop the leading H1 — we render it as the screen header so we don't repeat.
  const bodyBlocks = useMemo(() => {
    if (!blocks.length) return blocks;
    if (blocks[0].kind === 'h1') return blocks.slice(1);
    return blocks;
  }, [blocks]);

  const styles = makeStyles(scheme);

  return (
    <View style={[styles.root, { backgroundColor: tokens.paper }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView edges={['top']} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.body}>
              {/* Header skeleton */}
              <Skeleton height={28} width="70%" borderRadius={6} />
              <View style={styles.headerAccent} />
              {/* H2 skeleton */}
              <Skeleton height={18} width="45%" borderRadius={4} marginBottom={4} />
              {/* Paragraph skeleton */}
              <View style={{ gap: 10, marginBottom: 14 }}>
                <Skeleton height={14} width="100%" />
                <Skeleton height={14} width="100%" />
                <Skeleton height={14} width="88%" />
              </View>
              {/* H2 + paragraph skeleton */}
              <Skeleton height={18} width="55%" borderRadius={4} marginBottom={4} />
              <View style={{ gap: 10, marginBottom: 14 }}>
                <Skeleton height={14} width="100%" />
                <Skeleton height={14} width="95%" />
                <Skeleton height={14} width="100%" />
                <Skeleton height={14} width="72%" />
              </View>
              {/* Bulleted list skeleton */}
              <Skeleton height={18} width="40%" borderRadius={4} marginBottom={4} />
              <View style={styles.list}>
                <Skeleton height={14} width="92%" />
                <Skeleton height={14} width="86%" />
                <Skeleton height={14} width="78%" />
                <Skeleton height={14} width="90%" />
              </View>
              {/* More paragraphs */}
              <View style={{ gap: 10, marginTop: 8 }}>
                <Skeleton height={14} width="100%" />
                <Skeleton height={14} width="84%" />
                <Skeleton height={14} width="100%" />
              </View>
            </View>
          ) : error ? (
            <Text style={[styles.error, { color: tokens.signal }]}>{error}</Text>
          ) : (
            <View style={styles.body}>
              {title ? (
                <Text style={[styles.headerTitle, { color: tokens.ink }]}>{title}</Text>
              ) : null}
              <View style={styles.headerAccent} />
              {bodyBlocks.map((b, idx) => renderBlock(b, idx, styles, tokens))}
            </View>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <PageMark />
        </View>
      </SafeAreaView>
    </View>
  );
}

function renderBlock(
  b: Block,
  idx: number,
  styles: ReturnType<typeof makeStyles>,
  tokens: (typeof PagePay)[PagePayScheme]
) {
  switch (b.kind) {
    case 'h1':
      return null;
    case 'h2':
      return (
        <Text key={idx} style={[styles.h2, { color: tokens.ink }]}>
          {renderInline(b.text, styles.h2, { color: tokens.mint, fontFamily: 'SpaceGrotesk_700Bold' })}
        </Text>
      );
    case 'h3':
      return (
        <Text key={idx} style={[styles.h3, { color: tokens.ink }]}>
          {renderInline(b.text, styles.h3, { color: tokens.mint, fontFamily: 'SpaceGrotesk_700Bold' })}
        </Text>
      );
    case 'p':
      return (
        <Text key={idx} style={[styles.p, { color: tokens.inkMuted }]}>
          {renderInline(b.text, styles.p, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' })}
        </Text>
      );
    case 'ul':
      return (
        <View key={idx} style={styles.list}>
          {b.items.map((it, i) => (
            <View key={i} style={styles.liRow}>
              <Text style={[styles.bullet, { color: tokens.mint }]}>•</Text>
              <Text style={[styles.liText, { color: tokens.inkMuted }]}>
                {renderInline(it, styles.liText, {
                  color: tokens.ink,
                  fontFamily: 'SpaceGrotesk_700Bold',
                })}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'ol':
      return (
        <View key={idx} style={styles.list}>
          {b.items.map((it, i) => (
            <View key={i} style={styles.liRow}>
              <Text style={[styles.olNumber, { color: tokens.mint }]}>{i + 1}.</Text>
              <Text style={[styles.liText, { color: tokens.inkMuted }]}>
                {renderInline(it, styles.liText, {
                  color: tokens.ink,
                  fontFamily: 'SpaceGrotesk_700Bold',
                })}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'quote':
      return (
        <View
          key={idx}
          style={[styles.quote, { borderLeftColor: tokens.mint, backgroundColor: tokens.mintSoft }]}
        >
          <Text style={[styles.quoteText, { color: tokens.inkMuted }]}>
            {renderInline(b.text, styles.quoteText, {
              color: tokens.ink,
              fontFamily: 'SpaceGrotesk_700Bold',
            })}
          </Text>
        </View>
      );
    case 'hr':
      return <View key={idx} style={[styles.hr, { backgroundColor: tokens.border }]} />;
  }
}

function makeStyles(scheme: PagePayScheme) {
  return StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    scroll: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 32,
      flexGrow: 1,
    },
    body: { gap: 14 },
    headerTitle: {
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.5,
      fontFamily: 'SpaceGrotesk_700Bold',
    },
    headerAccent: {
      width: 36,
      height: 3,
      borderRadius: 2,
      backgroundColor: '#0E7C66',
      marginTop: 6,
      marginBottom: 6,
    },
    h2: {
      fontSize: 18,
      lineHeight: 24,
      letterSpacing: -0.2,
      fontFamily: 'SpaceGrotesk_700Bold',
      marginTop: 14,
    },
    h3: {
      fontSize: 15,
      lineHeight: 22,
      letterSpacing: 0,
      fontFamily: 'SpaceGrotesk_700Bold',
      marginTop: 6,
    },
    p: {
      fontSize: 15,
      lineHeight: 22,
    },
    list: { gap: 8 },
    liRow: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
    },
    bullet: {
      fontSize: 18,
      lineHeight: 22,
      width: 14,
      textAlign: 'center',
      marginTop: -1,
    },
    olNumber: {
      fontSize: 14,
      lineHeight: 22,
      width: 18,
      fontFamily: 'SpaceGrotesk_700Bold',
      marginTop: 0,
    },
    liText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 22,
    },
    quote: {
      borderLeftWidth: 3,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 4,
    },
    quoteText: {
      fontSize: 14,
      lineHeight: 21,
      fontStyle: 'italic',
    },
    hr: {
      height: 1,
      marginVertical: 10,
    },
    error: {
      fontSize: 14,
      lineHeight: 20,
      paddingVertical: 8,
    },
    footer: {
      padding: 16,
      alignItems: 'center',
    },
  });
}
