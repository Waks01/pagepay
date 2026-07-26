/**
 * Deep-link entry point for shared content.
 *
 * design-plan Step 7 — when a user shares a book via the ShareSheet, the
 * link is `client://read/{workId}`. This route handles that scheme and
 * drops the recipient straight into the reading experience: it redirects
 * to the book detail screen (`/book/{workId}`), which shows the slice list
 * and the "Continue reading" frontier. If the recipient is brand new to the
 * book they land on slice 1; if they've read it before, the book detail's
 * resume state takes them to their last slice.
 *
 * We use a thin redirect screen (no chrome) so the deep link feels instant
 * and the back button returns to wherever the OS share came from.
 */
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

export default function ReadDeepLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  useEffect(() => {
    const workId = Number(id);
    if (!workId || Number.isNaN(workId)) {
      (router as any).replace('/(tabs)');
      return;
    }
    // Defer one tick so the router has mounted the navigator before we
    // push — avoids a "navigator not ready" warning on cold deep-link.
    const t = setTimeout(() => {
      (router as any).replace(`/book/${workId}`);
    }, 0);
    return () => clearTimeout(t);
  }, [id, router]);

  return (
    <View style={[styles.center, { backgroundColor: tokens.paper }]}>
      <ActivityIndicator color={tokens.mint} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
