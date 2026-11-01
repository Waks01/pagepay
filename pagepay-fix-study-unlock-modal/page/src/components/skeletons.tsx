import { View, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import { PagePay, useEffectiveScheme } from '@/constants/theme';
import { Skeleton } from './Skeleton';

export function SkeletonBalanceCard() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  return (
    <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <View style={[styles.shimmer, { backgroundColor: tokens.border, opacity }]} />
      <View style={[styles.shimmer, { backgroundColor: tokens.border, width: '60%', opacity }]} />
      <View style={[styles.shimmer, { backgroundColor: tokens.border, width: '40%', opacity }]} />
    </View>
  );
}

export function SkeletonTransactionRow() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  return (
    <View style={[styles.row, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <View style={[styles.shimmer, { backgroundColor: tokens.border, width: 40, height: 40, borderRadius: 20, opacity }]} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[styles.shimmer, { backgroundColor: tokens.border, width: '70%', height: 14, opacity }]} />
        <View style={[styles.shimmer, { backgroundColor: tokens.border, width: '40%', height: 12, opacity }]} />
      </View>
    </View>
  );
}

export function SkeletonDetailPage() {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: tokens.paper }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
        <View style={{ marginRight: 12 }}>
          <Skeleton width={32} height={32} borderRadius={16} />
        </View>
      </View>

      <Skeleton height={18} width={80} borderRadius={4} marginBottom={12} />

      <Skeleton height={26} width="90%" marginBottom={8} />
      <Skeleton height={26} width="60%" marginBottom={16} />

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
        <Skeleton width={90} height={28} borderRadius={14} />
        <Skeleton width={100} height={28} borderRadius={14} />
      </View>

      <View style={{ gap: 10 }}>
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="85%" />
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="70%" />
      </View>
    </View>
  );
}

type SkeletonPageProps = {
  count?: number;
  header?: boolean;
};

export function SkeletonPage({ count = 3, header = true }: SkeletonPageProps) {
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: tokens.paper }}>
      {header && (
        <View style={{ marginBottom: 20 }}>
          <Skeleton height={24} width="55%" marginBottom={12} />
        </View>
      )}

      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            backgroundColor: tokens.card,
            borderRadius: 12,
            padding: 16,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: tokens.border,
            gap: 10,
          }}
        >
          <Skeleton height={14} width="40%" borderRadius={6} />
          <Skeleton height={18} width="85%" />
          <Skeleton height={14} width="65%" />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Skeleton width={80} height={24} borderRadius={6} />
            <Skeleton width={60} height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  shimmer: {
    borderRadius: 6,
    height: 16,
  },
});
