import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { apiFetch } from '@/src/shared/api/client';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';
import { Field } from '@/components/Field';
import { PrimaryButton } from '@/components/PrimaryButton';

type ChangePasswordModalProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Self-contained modal for changing the user's password.
 *
 * Three fields: current password (proves ownership of the account),
 * new password, confirm new password. The backend requires a correct
 * current password — without it, a leaked session token could lock
 * the legitimate user out.
 *
 * On 200 we let the caller know via `onClose()`; on 401 we show "current
 * password is incorrect" inline; on any other error we alert.
 */
export function ChangePasswordModal({ visible, onClose }: ChangePasswordModalProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<{
    current?: string;
    next?: string;
    confirm?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
    setFieldErrors({});
    setShowCurrent(false);
    setShowNext(false);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  function validate(): boolean {
    const errs: typeof fieldErrors = {};
    if (current.length < 8) errs.current = 'Enter your current password.';
    if (next.length < 8) errs.next = 'Use at least 8 characters.';
    if (confirm !== next) errs.confirm = 'Passwords do not match.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/v1/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: current,
          new_password: next,
        }),
      });

      if (res.ok) {
        reset();
        onClose();
        Alert.alert('Password updated', 'Your new password is active.');
        return;
      }

      if (res.status === 401) {
        // Backend's message for an incorrect current password.
        setFieldErrors({ current: 'Current password is incorrect.' });
        return;
      }

      // Any other status is a server or network-shape problem.
      Alert.alert("Couldn't change password", 'Please try again in a moment.');
    } catch {
      // apiFetch already surfaces a useful network message; we just
      // defer to it instead of stacking a second modal alert.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
              Change password
            </Text>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={[styles.cancel, { color: tokens.inkMuted }]}>Cancel</Text>
            </Pressable>
          </View>

          <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
            You&apos;ll need to enter your current password to confirm it&apos;s you.
          </Text>

          <View style={styles.form}>
            <Field
              label="Current password"
              helper="At least 8 characters"
              secureTextEntry={!showCurrent}
              autoCapitalize="none"
              autoCorrect={false}
              value={current}
              onChangeText={(v) => {
                setCurrent(v);
                setFieldErrors((p) => (p.current ? { ...p, current: undefined } : p));
              }}
              error={fieldErrors.current ?? null}
              rightIcon={
                <Pressable onPress={() => setShowCurrent((s) => !s)} hitSlop={8}>
                  <Text style={[styles.eyeIcon, { color: tokens.inkMuted }]}>
                    {showCurrent ? 'Hide' : 'Show'}
                  </Text>
                </Pressable>
              }
            />
            <Field
              label="New password"
              helper="At least 8 characters"
              secureTextEntry={!showNext}
              autoCapitalize="none"
              autoCorrect={false}
              value={next}
              onChangeText={(v) => {
                setNext(v);
                setFieldErrors((p) => (p.next ? { ...p, next: undefined } : p));
              }}
              error={fieldErrors.next ?? null}
              rightIcon={
                <Pressable onPress={() => setShowNext((s) => !s)} hitSlop={8}>
                  <Text style={[styles.eyeIcon, { color: tokens.inkMuted }]}>
                    {showNext ? 'Hide' : 'Show'}
                  </Text>
                </Pressable>
              }
            />
            <Field
              label="Confirm new password"
              secureTextEntry={!showNext}
              autoCapitalize="none"
              autoCorrect={false}
              value={confirm}
              onChangeText={(v) => {
                setConfirm(v);
                setFieldErrors((p) => (p.confirm ? { ...p, confirm: undefined } : p));
              }}
              error={fieldErrors.confirm ?? null}
            />
          </View>

          <View style={styles.actions}>
            <PrimaryButton
              title={submitting ? 'Updating…' : 'Update password'}
              onPress={handleSubmit}
              loading={submitting}
            />
            <Pressable
              onPress={handleClose}
              hitSlop={10}
              disabled={submitting}
              style={styles.secondaryButton}
            >
              <Text style={[styles.secondaryText, { color: tokens.mint }]}>Cancel</Text>
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
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    letterSpacing: 0.1,
  },
  cancel: {
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 18,
  },
  form: {
    gap: 14,
    marginBottom: 18,
  },
  eyeIcon: {
    fontSize: 13,
    fontWeight: '600',
  },
  actions: {
    gap: 10,
  },
  secondaryButton: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: '600',
  },
});