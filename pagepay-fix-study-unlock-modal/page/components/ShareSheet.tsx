/**
 * ShareSheet — the bottom-sheet that opens when a user taps "Share" on a
 * content card, book detail, or reader (design-plan Step 7).
 *
 * Shows native share targets (WhatsApp, Instagram, X, Facebook) plus a
 * copyable deep link. Tapping a target fires React Native's
 * `Share.share()` (same pattern as the existing referral share) so the
 * OS presents the real share sheet; we pass a deep link that routes
 * straight back into the reader/book inside the app.
 *
 * Deep link shape: `client://read/{workId}`. The matching route lives at
 * `app/read/[id].tsx`. On the web/desktop the link is still copyable; the
 * copy button uses `expo-clipboard` (already a dependency).
 *
 * The sheet is purely presentational — the parent owns the `workId`,
 * `title`, and the deep-link. We log the share via `onShare(platform)`
 * so the caller can record the analytics event (the backend's
 * `/works/{id}/share` endpoint, already implemented).
 *
 * The sheet is rendered inside a `Modal` so it overlays whatever screen
 * called it without needing a dedicated route. The parent controls
 * `visible` / `onClose`.
 */
import { useState } from 'react';
import {
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

export type ShareTarget = 'whatsapp' | 'instagram' | 'x' | 'facebook' | 'more';

type ShareSheetProps = {
  visible: boolean;
  /** Parent work id the link points to. The deep link is
   *  `client://read/{workId}`. */
  workId: number;
  /** Human-readable title, shown in the sheet header and embedded in the
   *  share message. Falls back to a generic string if empty. */
  title: string;
  /** Called when the user picks a share target, before the OS sheet
   *  opens. The caller records the analytics event. */
  onShare?: (target: ShareTarget) => void;
  onClose: () => void;
};

/** Build the deep link that routes into the app. Expo Router resolves
 *  `client://read/{id}` because `app.json` declares `scheme: "client"`
 *  and we add `app/read/[id].tsx` to handle it. */
export function buildContentDeepLink(workId: number): string {
  return `client://read/${workId}`;
}

export function ShareSheet({ visible, workId, title, onShare, onClose }: ShareSheetProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const [copied, setCopied] = useState(false);
  const styles = makeStyles(tokens);

  const link = buildContentDeepLink(workId);
  const shareTitle = title || 'this book on PagePay';

  const openNativeShare = (target: ShareTarget) => {
    onShare?.(target);
    const message = `Read "${shareTitle}" and earn points on PagePay — ${link}`;
    Share.share(
      {
        message,
        title: 'PagePay',
        url: link,
      },
      {
        // On Android, dialogTitle shows above the sheet. iOS ignores it.
        dialogTitle: `Share "${shareTitle}"`,
      },
    )
      .then(() => onClose())
      .catch(() => {
        /* user dismissed — keep the sheet open */
      });
  };

  const copyLink = async () => {
    onShare?.('more');
    try {
      await Clipboard.setStringAsync(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  const targets: Array<{
    key: ShareTarget;
    icon: string;
    label: string;
    bg: string;
    color: string;
  }> = [
    { key: 'whatsapp', icon: 'logo-whatsapp', label: 'WhatsApp', bg: '#25D366', color: '#fff' },
    { key: 'instagram', icon: 'logo-instagram', label: 'Instagram', bg: '#0095F6', color: '#fff' },
    { key: 'x', icon: 'logo-twitter', label: 'X', bg: '#1DA1F2', color: '#fff' },
    { key: 'facebook', icon: 'logo-facebook', label: 'Facebook', bg: '#1877F2', color: '#fff' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close share sheet">
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
            Share “{shareTitle}”
          </Text>

          <View style={styles.grid}>
            {targets.map((t) => (
              <Pressable
                key={t.key}
                style={styles.option}
                onPress={() => openNativeShare(t.key)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Share to ${t.label}`}
              >
                <View style={[styles.circle, { backgroundColor: t.bg }]}>
                  <Ionicons name={t.icon as keyof typeof Ionicons.glyphMap} size={22} color={t.color} />
                </View>
                <Text style={[styles.label, { color: tokens.inkMuted }]}>{t.label}</Text>
              </Pressable>
            ))}

            <Pressable
              style={styles.option}
              onPress={copyLink}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Copy link"
            >
              <View style={[styles.circle, { backgroundColor: tokens.mintSoft }]}>
                <Ionicons name={copied ? 'checkmark' : 'link'} size={22} color={tokens.mint} />
              </View>
              <Text style={[styles.label, { color: tokens.inkMuted }]}>
                {copied ? 'Copied!' : 'Copy Link'}
              </Text>
            </Pressable>
          </View>

          <View style={[styles.linkBox, { backgroundColor: tokens.paper, borderColor: tokens.border }]}>
            <Text numberOfLines={1} style={[styles.linkText, { color: tokens.inkMuted }]}>
              {link}
            </Text>
            <Pressable
              onPress={copyLink}
              hitSlop={8}
              style={[styles.copyBtn, { backgroundColor: tokens.mintSoft }]}
              accessibilityRole="button"
              accessibilityLabel="Copy link"
            >
              <Text style={[styles.copyBtnText, { color: tokens.mint, fontFamily: 'SpaceGrotesk_700Bold' }]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
          </View>

          <Pressable
            style={styles.cancel}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={[styles.cancelText, { color: tokens.inkMuted }]}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function makeStyles(tokens: (typeof PagePay)['light']) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(14,17,22,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: tokens.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 24,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: tokens.border,
      alignSelf: 'center',
      marginBottom: 16,
    },
    title: {
      fontSize: 16,
      textAlign: 'center',
      marginBottom: 16,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
      gap: 16,
      marginBottom: 16,
    },
    option: {
      width: '18%',
      alignItems: 'center',
      gap: 6,
    },
    circle: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      fontSize: 10,
      textAlign: 'center',
    },
    linkBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
    },
    linkText: {
      flex: 1,
      fontSize: 12,
    },
    copyBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    copyBtnText: {
      fontSize: 11,
    },
    cancel: {
      alignItems: 'center',
      paddingVertical: 10,
    },
    cancelText: {
      fontSize: 14,
      fontWeight: '600',
    },
  });
}
