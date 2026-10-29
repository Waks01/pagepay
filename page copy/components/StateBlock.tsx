import { ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PagePay } from '@/constants/theme';

type StateBlockProps = {
  message: string;
  onRetry?: () => void;
  tokens: (typeof PagePay)['light'];
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  variant?: 'error' | 'empty';
  action?: ReactNode;
};

export function StateBlock({
  message,
  onRetry,
  tokens,
  icon = 'cloud-offline-outline',
  iconColor,
  variant = 'error',
  action,
}: StateBlockProps) {
  const isError = variant === 'error';
  const borderColor = isError ? tokens.signal : tokens.border;
  const textColor = isError ? tokens.signal : tokens.inkMuted;
  const resolvedIconColor = iconColor || tokens.signal;

  return (
    <View style={[styles.stateBlock, { borderColor }]}>
      {isError && (
        <Ionicons name={icon} size={20} color={resolvedIconColor} />
      )}
      <Text style={[styles.stateText, { color: textColor }]}>
        {message}
      </Text>
      {onRetry && !action && (
        <TouchableOpacity
          onPress={onRetry}
          style={[styles.retry, { borderColor: tokens.signal }]}
          activeOpacity={0.7}
        >
          <Text style={[styles.retryText, { color: tokens.signal }]}>Try again</Text>
        </TouchableOpacity>
      )}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  stateBlock: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  stateText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  retry: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
