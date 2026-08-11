import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';

type PremiumUpsellModalProps = {
  visible: boolean;
  title: string;
  body: string;
  cta: string;
  onClose: () => void;
};

/**
 * Modal that suggests upgrading to premium.
 * 
 * Used by ad gates, study limits, and other upgrade prompts.
 */
export function PremiumUpsellModal({
  visible,
  title,
  body,
  cta,
  onClose,
}: PremiumUpsellModalProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const router = useRouter();

  const handleUpgrade = () => {
    onClose();
    router.push('/(tabs)/premium');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.icon}>
            <Ionicons name="star" size={40} color={tokens.mint} />
          </View>

          <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
            {title}
          </Text>

          <Text style={[styles.body, { color: tokens.inkMuted }]}>{body}</Text>

          <View style={styles.buttons}>
            <PrimaryButton title={cta} onPress={handleUpgrade} />
            <Pressable onPress={onClose} style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.5 : 1 }]}>
              <Text style={[styles.dismissText, { color: tokens.inkMuted }]}>Maybe later</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 16,
  },
  icon: {
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  buttons: {
    width: '100%',
    gap: 12,
    marginTop: 8,
  },
  dismiss: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
