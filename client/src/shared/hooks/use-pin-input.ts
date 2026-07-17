import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';

type UsePinInputOptions = {
  length?: number;
  onSubmit: (value: string) => void;
  autoSubmit?: boolean;
};

type UsePinInputReturn = {
  values: string[];
  setValues: React.Dispatch<React.SetStateAction<string[]>>;
  inputs: React.RefObject<(any | null)[]>;
  handleChange: (index: number, value: string) => void;
  handleKeyPress: (index: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
  reset: () => void;
};

export function usePinInput({
  length = 4,
  onSubmit,
  autoSubmit = true,
}: UsePinInputOptions = {}): UsePinInputReturn {
  const [values, setValues] = useState<string[]>(() => Array(length).fill(''));
  const inputs = useRef<(any | null)[]>([]);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const reset = useCallback(() => {
    setValues(Array(length).fill(''));
    setTimeout(() => inputs.current[0]?.focus(), 50);
  }, [length]);

  useEffect(() => {
    if (!autoSubmit) return;
    if (values.every((d) => d !== '') && values.join('').length === length) {
      const full = values.join('');
      setTimeout(() => onSubmitRef.current(full), 0);
    }
  }, [values, length, autoSubmit]);

  const handleChange = useCallback((index: number, value: string) => {
    const digits = value.replace(/[^0-9]/g, '');

    setValues((prev) => {
      const next = [...prev];

      if (digits.length > 1) {
        for (let i = 0; i < Math.min(digits.length, length); i++) {
          next[i] = digits[i];
        }
      } else if (digits.length === 1) {
        next[index] = digits[0];
      }

      return next;
    });

    if (digits.length > 1) {
      const filledCount = Math.min(digits.length, length);
      setTimeout(() => inputs.current[filledCount - 1]?.focus(), 0);
    } else if (digits.length === 1 && index < length - 1) {
      setTimeout(() => inputs.current[index + 1]?.focus(), 0);
    }
  }, [length]);

  const handleKeyPress = useCallback(
    (index: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (e.nativeEvent.key !== 'Backspace') return;

      setValues((prev) => {
        if (prev[index].length === 1) {
          const next = [...prev];
          next[index] = '';
          return next;
        }
        if (index > 0) {
          const next = [...prev];
          next[index - 1] = '';
          setTimeout(() => inputs.current[index - 1]?.focus(), 0);
          return next;
        }
        return prev;
      });
    },
    [length],
  );

  return {
    values,
    setValues,
    inputs,
    handleChange,
    handleKeyPress,
    reset,
  };
}
