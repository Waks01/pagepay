import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

type ErrorBannerProps = {
  message: string;
  onDismiss?: () => void;
};

/**
 * ErrorBanner — inline (non-modal) error pill rendered below the CTA.
 * Used by every VTU screen on mutation failure.
 */
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: tokens.signalSoft, borderColor: tokens.signal },
      ]}
    >
      <Ionicons name="alert-circle-outline" size={18} color={tokens.signal} />
      <Text style={[styles.text, { color: tokens.signal }]}>{message}</Text>
      {onDismiss && (
        <TouchableOpacity onPress={onDismiss} hitSlop={8}>
          <Ionicons name="close" size={18} color={tokens.signal} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  text: {
    flex: 1,
    fontSize: 13,
  },
});
