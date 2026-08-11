import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type StudyHeaderProps = {
  /** Editorial serif heading. Pass `sub` for the muted line beneath. */
  title: string;
  sub?: string;
  /** Right-side slot — icon buttons, badges, anything short. */
  right?: ReactNode;
  /** Back handler. Defaults to `router.back()`. Pass null to hide back. */
  onBack?: (() => void) | null;
};

/**
 * Shared header used by every study sub-screen and the detail view.
 * Centralizes the back button + editorial serif heading so the per-screen
 * `backBtn`/`title` duplication goes away.
 */
export function StudyHeader({ title, sub, right, onBack }: StudyHeaderProps) {
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const showBack = onBack !== null;
  const handleBack = onBack ?? (() => router.back());

  return (
    <View style={styles.row}>
      {showBack && (
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [
            styles.back,
            { borderColor: tokens.border, backgroundColor: tokens.card },
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="arrow-back" size={20} color={tokens.ink} />
        </Pressable>
      )}
      <View style={styles.titles}>
        <Text
          style={[styles.title, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {sub ? (
          <Text style={[styles.sub, { color: tokens.inkMuted }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
    paddingBottom: 16,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 22,
    letterSpacing: -0.4,
  },
  sub: {
    fontSize: 12,
    marginTop: 2,
  },
  right: { flexDirection: 'row', gap: 8 },
});
