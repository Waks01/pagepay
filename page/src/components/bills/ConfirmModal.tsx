import { ReactNode } from 'react';
import {
  View, Text, TouchableOpacity, Modal,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

export type ConfirmRow = {
  key: string;
  label: string;
  value: ReactNode;
  valueColor?: 'default' | 'mint' | 'muted';
  /** Optional flex-grow on the value side (e.g. for long message body). */
  valueStyle?: object;
};

type ConfirmModalProps = {
  visible: boolean;
  title: string;
  rows: ReadonlyArray<ConfirmRow>;
  onCancel: () => void;
  onConfirm: () => void;
  confirming?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
};

const VALUE_COLOR: Record<NonNullable<ConfirmRow['valueColor']>, 'ink' | 'mint' | 'inkMuted'> = {
  default: 'ink',
  mint: 'mint',
  muted: 'inkMuted',
};

function VALUE_COLOR_FN(
  variant: NonNullable<ConfirmRow['valueColor']>,
  tokens: typeof PagePay.light | typeof PagePay.dark | typeof PagePay.sepia,
): string {
  return tokens[VALUE_COLOR[variant]];
}

/**
 * ConfirmModal — standard confirm-purchase dialog.
 * Wraps Modal + overlay + content + title + divider + rows + cancel/confirm buttons.
 */
export function ConfirmModal({
  visible,
  title,
  rows,
  onCancel,
  onConfirm,
  confirming = false,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}: ConfirmModalProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.content,
            { backgroundColor: tokens.card, borderColor: tokens.border },
          ]}
        >
          <Text style={[styles.title, { color: tokens.ink }]}>{title}</Text>
          <View style={[styles.divider, { backgroundColor: tokens.border }]} />
          <View style={styles.rows}>
            {rows.map((row) => (
              <View key={row.key} style={styles.row}>
                <Text style={[styles.rowLabel, { color: tokens.inkMuted }]}>
                  {row.label}
                </Text>
                {typeof row.value === 'string' ? (
                  <Text
                    style={[
                      styles.rowValue,
                      {
                        color: VALUE_COLOR_FN(row.valueColor ?? 'default', tokens),
                        fontWeight: row.valueColor === 'mint' ? '700' : '600',
                      },
                      row.valueStyle,
                    ]}
                    numberOfLines={2}
                  >
                    {row.value}
                  </Text>
                ) : (
                  <View style={row.valueStyle}>{row.value}</View>
                )}
              </View>
            ))}
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onCancel}
              disabled={confirming}
              style={[
                styles.btn,
                styles.btnCancel,
                { borderColor: tokens.border },
              ]}
            >
              <Text style={[styles.btnText, { color: tokens.inkMuted }]}>
                {cancelLabel}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onConfirm}
              disabled={confirming}
              style={[
                styles.btn,
                styles.btnConfirm,
                { backgroundColor: tokens.mint },
              ]}
            >
              {confirming ? (
                <ActivityIndicator color={tokens.mintText} />
              ) : (
                <Text style={[styles.btnText, { color: tokens.mintText }]}>
                  {confirmLabel}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  divider: {
    height: 1,
    marginTop: 12,
  },
  rows: {
    gap: 12,
    marginVertical: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  rowValue: {
    fontSize: 14,
    textAlign: 'right',
    flexShrink: 1,
    marginLeft: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  btnCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  btnConfirm: {},
  btnText: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk_700Bold',
  },
});
