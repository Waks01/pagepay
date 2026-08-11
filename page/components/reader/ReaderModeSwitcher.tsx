/**
 * ReaderModeSwitcher — the 3-segment pill pinned to the bottom
 * of the reader screen. Picks between Read / Study / Listen.
 *
 * v3 §3.4 spec:
 *   - Default is 'read' for new users.
 *   - The choice is persisted per-user (in this app: locally via
 *     expo-secure-store, and synced to the server per-work via
 *     POST /progress/finish { reader_mode }).
 *   - Listen mode is a placeholder for the audio narration feature
 *     that is gated behind Premium and the first unit of a work.
 *
 * Why a custom component (not just the existing SegmentedControl):
 *   - We want the switcher to include the listen-mode paywall
 *     modal trigger without making the SegmentedControl aware of
 *     PagePay's paywall flow.
 *   - We want the icons inline with the labels — SegmentedControl
 *     takes an `icon?: string` prop but currently renders it as
 *     text. The book/headphones/pencil icons here are the v3
 *     design tokens; we render them as <Text> glyphs to avoid a
 *     hard Ionicons dependency in the primitive.
 *
 * The switcher renders above the safe-area inset so it never sits
 * underneath the iOS home indicator. The reader's ScrollView
 * already pads to a safe-area inset at the bottom; we just stack
 * the switcher in a `View` between the ScrollView and the
 * RewardedAd modals.
 */
import { StyleSheet, Text, View } from 'react-native';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import {
  usePreferences,
  persistReaderMode,
  type ReaderMode,
} from '@/src/shared/lib/preferences';

const MODES: ReadonlyArray<{ value: ReaderMode; label: string; glyph: string }> = [
  { value: 'read', label: 'Read', glyph: '◧' },
  { value: 'study', label: 'Study', glyph: '✎' },
  { value: 'listen', label: 'Listen', glyph: '◉' },
];

export interface ReaderModeSwitcherProps {
  /**
   * True when the user is on unit 1 of a work — the only unit
   * where Listen is unlocked for free users. We use this to gate
   * the paywall modal. The screen passes it down from
   * `slice_order === 0` (or `slice_order === 1` in 1-indexed UIs).
   */
  isFirstUnit: boolean;
  /**
   * True when the user has an active premium subscription. The
   * screen computes this from the `me` query.
   */
  isPremium: boolean;
  /**
   * Called when the user picks 'listen' but does not have access
   * (not premium AND not on the first unit). The screen wires
   * this to the existing paywall modal.
   */
  onLockedListenTapped?: () => void;
}

export function ReaderModeSwitcher({
  isFirstUnit,
  isPremium,
  onLockedListenTapped,
}: ReaderModeSwitcherProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const readerMode = usePreferences((s) => s.readerMode);
  const setReaderMode = usePreferences((s) => s.setReaderMode);

  const onChange = (next: ReaderMode) => {
    if (next === 'listen' && !isPremium && !isFirstUnit) {
      // Gate. We don't change the underlying mode; the user
      // stays in their current mode until they paywall-resolve.
      onLockedListenTapped?.();
      return;
    }
    setReaderMode(next);
    // Fire-and-forget. The store is the source of truth; the
    // secure-store write is a debounced mirror so the next
    // launch restores the choice.
    void persistReaderMode(next);
  };

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={[styles.headerLabel, { color: tokens.inkMuted }]}>Mode</Text>
        {!isPremium && !isFirstUnit && (
          <Text style={[styles.gateHint, { color: tokens.signal }]}>
            Listen is part of Premium
          </Text>
        )}
      </View>
      <SegmentedControl
        options={MODES}
        value={readerMode}
        onChange={onChange}
        activeBackground={tokens.mint}
        activeText={tokens.mintText}
        inactiveBackground={tokens.paper}
        inactiveText={tokens.inkMuted}
        borderColor={tokens.border}
        accessibilityLabel="Reader mode"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  gateHint: {
    fontSize: 11,
    fontWeight: '600',
  },
});
