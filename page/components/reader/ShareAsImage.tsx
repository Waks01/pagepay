/**
 * ShareAsImage — render a 1080x1080 quote card and share it.
 *
 * v3 §3.2 calls for a one-tap "share as image" action on each
 * highlight. We:
 *   1. Build an off-screen card (positioned absolute, off-viewport)
 *      with the highlighted quote, work title, author, and a
 *      PagePay wordmark.
 *   2. Use `react-native-view-shot`'s `captureRef` to render that
 *      card to a PNG file in the app's cache directory.
 *   3. Hand the file URL to `expo-sharing` so the user can pick
 *      their target (WhatsApp, X, status, etc.).
 *
 * Why off-screen, not on-screen:
 *   - The card is meant to look designed, not match the rest of
 *     the app. Mixing its styles with the reader's would mean
 *     scoping everything inside this component. Off-screen
 *     + captureRef keeps the card completely isolated.
 *   - The card's natural size is 1080x1080 (square, social-
 *     friendly). We can't put a 1080x1080 view on a phone screen
 *     without it dominating the UI.
 *
 * Why we don't save to the photo library:
 *   - Per v3 §3.2, share is the primary action. The user can
 *     save from the share sheet's "Save Image" affordance. Going
 *     directly to the library would require an extra permission
 *     prompt and would surprise users who didn't ask to save.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform, View, Text, StyleSheet } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { colorTintFor, type HighlightEntry } from '@/components/reader/StudyPanel';

const CARD_SIZE = 1080;

export interface ShareAsImageProps {
  highlight: HighlightEntry | null;
  bodyText: string;
  workTitle: string;
  workAuthor: string | null;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export function ShareAsImage({
  highlight,
  bodyText,
  workTitle,
  workAuthor,
  onDone,
  onError,
}: ShareAsImageProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!highlight) return;
    if (sharing) return;
    setSharing(true);
    (async () => {
      try {
        // Give React one paint cycle to lay out the off-screen
        // card. captureRef is sync but the underlying native
        // capture reads the most recent layout pass. Without
        // this, an iOS user occasionally gets a 0x0 PNG.
        await new Promise((r) => setTimeout(r, 50));
        const uri = await captureRef(cardRef, {
          format: 'png',
          quality: 1,
          result: 'tmpfile',
          // Match the card's render size. Without this RN
          // captures the View at its on-screen size, which is
          // wrong because the card is positioned off-screen.
          width: CARD_SIZE,
          height: CARD_SIZE,
        });
        const available = await Sharing.isAvailableAsync();
        if (!available) {
          // On web, the share sheet doesn't exist. Fall back to
          // a copy-to-clipboard hint through onError.
          throw new Error('Sharing is not available on this platform');
        }
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Share your highlight',
        });
        onDone?.();
      } catch (e) {
        onError?.(e as Error);
      } finally {
        setSharing(false);
      }
    })();
  }, [highlight, bodyText, workTitle, workAuthor, onDone, onError, sharing]);

  if (!highlight) return null;

  const quote = bodyText.slice(highlight.start, highlight.end).trim();
  // Word-wrap the quote. We do a rough 60-char-per-line split on
  // word boundaries. The card has padding so we target 56 chars
  // per visual line.
  const wrapped = wrap(quote, 56);
  const tint = colorTintFor(highlight.color);

  return (
    <View pointerEvents="none" style={styles.host} testID="share-card-host">
      <View
        ref={cardRef}
        collapsable={false}
        style={[
          styles.card,
          { backgroundColor: tokens.paper, borderColor: tokens.border },
        ]}
      >
        {/* Top brand row. */}
        <View style={styles.cardHeader}>
          <View style={[styles.brandDot, { backgroundColor: tokens.mint }]} />
          <Text style={[styles.brandText, { color: tokens.ink }]}>PagePay</Text>
        </View>

        {/* Quote. */}
        <View style={styles.cardBody}>
          <Text style={[styles.quoteText, { color: tokens.ink }]}>
            {wrapped.map((line, i) => (
              <Text key={i} style={i > 0 ? styles.quoteLine : undefined}>
                {i > 0 ? '\n' : ''}
                <Text
                  style={{
                    backgroundColor: tint,
                  }}
                >
                  {line}
                </Text>
              </Text>
            ))}
          </Text>
        </View>

        {/* Footer: title + author. */}
        <View style={styles.cardFooter}>
          <Text style={[styles.workTitle, { color: tokens.ink }]} numberOfLines={1}>
            {workTitle}
          </Text>
          {workAuthor && (
            <Text style={[styles.workAuthor, { color: tokens.inkMuted }]} numberOfLines={1}>
              {workAuthor}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * Word-wrap a string to `width` characters per line, breaking on
 * the last whitespace that fits. Returns an array of lines. We
 * keep the algorithm simple — the card is for social sharing, not
 * for a typeset book.
 */
function wrap(s: string, width: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (current.length === 0) {
      current = w;
    } else if (current.length + 1 + w.length <= width) {
      current += ' ' + w;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const styles = StyleSheet.create({
  host: {
    // Off-screen: positioned at -10000px on both axes. captureRef
    // resolves the absolute position internally, so this works
    // cross-platform.
    position: 'absolute',
    top: -100000,
    left: -100000,
  },
  card: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    padding: 72,
    borderWidth: 4,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 14,
  },
  brandText: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 1,
  },
  cardBody: {
    flex: 1,
    justifyContent: 'center',
  },
  quoteText: {
    fontSize: 56,
    lineHeight: 72,
    fontWeight: '500',
  },
  quoteLine: {
    // Per-line text node so we can wrap mid-quote without the
    // whole block becoming one giant span.
  },
  cardFooter: {
    borderTopWidth: 2,
    borderTopColor: 'rgba(0,0,0,0.08)',
    paddingTop: 24,
  },
  workTitle: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 4,
  },
  workAuthor: {
    fontSize: 24,
    fontWeight: '400',
  },
});
