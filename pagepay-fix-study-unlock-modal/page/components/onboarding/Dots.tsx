/**
 * Onboarding dot indicator. Renders `count` dots; the one at `active`
 * is a 22×8 pill in `tokens.mint`, the rest are 8×8 circles in
 * `tokens.border`. Pure layout — no motion here (the parent re-renders
 * when the active index changes, and the CSS transition on the dot
 * width/color is enough to feel smooth).
 */
import { StyleSheet, View } from 'react-native';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';

type OnboardingDotsProps = {
  count: number;
  active: number;
};

export function OnboardingDots({ count, active }: OnboardingDotsProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  return (
    <View
      style={styles.row}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${active + 1} of ${count}`}
    >
      {Array.from({ length: count }).map((_, i) => {
        const isActive = i === active;
        return (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: isActive ? tokens.mint : tokens.border,
                width: isActive ? 22 : 8,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
});
