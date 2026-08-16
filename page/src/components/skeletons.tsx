import { View, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import { PagePay, useEffectiveScheme } from '@/constants/theme';

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
