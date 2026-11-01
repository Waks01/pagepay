import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';

export type SegmentOption<T extends string | number> = {
  value: T;
  label?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  textTransform?: 'capitalize' | 'none' | 'uppercase';
};

type SegmentedControlProps<T extends string | number> = {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Whether to render the active segment with a faint shadow. Default true. */
  elevated?: boolean;
};

/**
 * Segmented control — foggy-tab-style selector used across VTU screens.
 * Active segment has a mint border + faint shadow.
 */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  elevated = true,
}: SegmentedControlProps<T>) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View style={styles.container}>
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <TouchableOpacity
            key={String(opt.value)}
            onPress={() => onChange(opt.value)}
            style={[
              styles.btn,
              {
                backgroundColor: isActive ? tokens.card : 'transparent',
                borderColor: isActive ? tokens.mint : 'transparent',
                shadowColor: isActive && elevated ? '#000' : 'transparent',
                shadowOpacity: isActive && elevated ? 0.08 : 0,
                shadowRadius: isActive && elevated ? 4 : 0,
              },
            ]}
          >
            {opt.icon && (
              <Ionicons
                name={opt.icon}
                size={16}
                color={isActive ? tokens.mint : tokens.inkMuted}
              />
            )}
            {opt.label !== undefined && (
              <Text
                style={[
                  styles.label,
                  {
                    color: isActive ? tokens.ink : tokens.inkMuted,
                    textTransform: opt.textTransform,
                  },
                ]}
              >
                {opt.label}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
});
