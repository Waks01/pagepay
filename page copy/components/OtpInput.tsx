import { useCallback, useEffect, useMemo, useState } from 'react';
import { TextInput, View, StyleSheet } from 'react-native';
import { useWindowDimensions } from 'react-native';
import { usePinInput } from '@/src/shared/hooks/use-pin-input';

type OtpInputProps = {
  length?: number;
  onChange?: (value: string) => void;
  onSubmit: (value: string) => void;
  error?: string | null;
  verifying?: boolean;
  disabled?: boolean;
  tokens: {
    ink: string;
    card: string;
    mint: string;
    signal?: string;
  };
  gap?: number;
};

export function OtpInput({
  length = 6,
  onChange,
  onSubmit,
  error,
  verifying = false,
  disabled = false,
  tokens,
  gap = 10,
}: OtpInputProps) {
  const { width } = useWindowDimensions();
  const [focused, setFocused] = useState(false);

  const boxWidth = useMemo(
    () =>
      Math.max(
        40,
        Math.min(56, Math.floor((width - 48 - (length - 1) * gap) / length))
      ),
    [width, length, gap]
  );

  const { values, inputs, handleChange, handleKeyPress, reset } = usePinInput({
    length,
    onSubmit,
    autoSubmit: true,
  });

  useEffect(() => {
    onChange?.(values.join(''));
  }, [values, onChange]);

  useEffect(() => {
    reset();
  }, [reset]);

  const borderColor = error
    ? tokens.signal || '#ef4444'
    : focused
      ? tokens.mint
      : tokens.mint;

  return (
    <View style={[styles.row, { gap }]}>
      {values.map((digit, i) => (
        <TextInput
          key={i}
          ref={(el) => {
            inputs.current[i] = el;
          }}
          value={digit}
          onChangeText={(v) => handleChange(i, v)}
          onKeyPress={(e) => handleKeyPress(i, e)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          maxLength={1}
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          returnKeyType="done"
          blurOnSubmit={false}
          editable={!verifying && !disabled}
          selectTextOnFocus
          style={[
            { width: boxWidth, height: boxWidth * 1.15 },
            styles.box,
            {
              color: tokens.ink,
              backgroundColor: tokens.card,
              borderColor,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  box: {
    borderRadius: 14,
    borderWidth: 2,
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 28,
    textAlign: 'center',
  },
});
