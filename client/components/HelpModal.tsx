import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type HelpModalProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Read-only FAQ modal for the Profile screen.
 *
 * Phase 1 scope: three short answers plus a contact line. No network
 * calls — these rows are stable copy that doesn't depend on the user's
 * tier or wallet state.
 */
export function HelpModal({ visible, onClose }: HelpModalProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              Help & support
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={[styles.close, { color: tokens.inkMuted }]}>Done</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <QA
              tokens={tokens}
              q="How does earning work?"
              a="A verified 1-minute read credits 5 points. Ads you watch between sessions add a small bonus on top, paid out per impression. Points appear in your wallet after the post-read ad claim."
            />
            <QA
              tokens={tokens}
              q="Why was my session paused?"
              a="The reader pauses if no scroll activity is detected for 45 seconds, or if the app loses focus. Pause to keep your verified-reading time honest — we never credit paused time."
            />
            <QA
              tokens={tokens}
              q="How do I cash out?"
              a="Open the Wallet tab, tap Withdraw, and the money lands in your linked Nigerian bank account via Paystack. The minimum is ₦1,000 and there's a small flat fee per withdrawal (tiered by amount)."
            />

            <View style={[styles.contact, { borderTopColor: tokens.border }]}>
              <Text style={[styles.contactLabel, { color: tokens.inkMuted }]}>STILL STUCK?</Text>
              <Text style={[styles.contactValue, { color: tokens.ink }]}>
                support@pagepay.ng
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function QA({
  tokens,
  q,
  a,
}: {
  tokens: (typeof PagePay)['light'] | (typeof PagePay)['dark'];
  q: string;
  a: string;
}) {
  return (
    <View style={styles.qa}>
      <Text style={[styles.q, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
        {q}
      </Text>
      <Text style={[styles.a, { color: tokens.inkMuted }]}>{a}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    letterSpacing: 0.1,
  },
  close: {
    fontSize: 15,
    fontWeight: '600',
  },
  body: {
    gap: 18,
  },
  qa: {
    gap: 6,
  },
  q: {
    fontSize: 15,
    letterSpacing: 0.1,
  },
  a: {
    fontSize: 14,
    lineHeight: 20,
  },
  contact: {
    marginTop: 12,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  contactLabel: {
    fontSize: 11,
    letterSpacing: 1.0,
    fontWeight: '600',
  },
  contactValue: {
    fontSize: 15,
    fontWeight: '500',
  },
});