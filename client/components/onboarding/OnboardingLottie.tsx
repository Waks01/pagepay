/**
 * Onboarding hero Lottie wrapper.
 *
 * Each hero screen loads its Lottie JSON from assets. If the animation
 * file is missing, the component renders nothing so the layout still
 * works and the user can still complete onboarding.
 *
 * Usage:
 *   <OnboardingLottie source={require('@/assets/animations/onboarding/earn.json')} />
 */
import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';

type OnboardingLottieProps = {
  source: number; // require(...) result
  autoPlay?: boolean;
  loop?: boolean;
};

export function OnboardingLottie({ source, autoPlay = true, loop = true }: OnboardingLottieProps) {
  const lottieRef = useRef<LottieView>(null);

  useEffect(() => {
    if (lottieRef.current && autoPlay) {
      lottieRef.current.play();
    }
    return () => {
      if (lottieRef.current) {
        lottieRef.current.reset();
      }
    };
  }, [autoPlay]);

  return (
    <View style={styles.container}>
      <LottieView
        ref={lottieRef}
        source={source}
        autoPlay={autoPlay}
        loop={loop}
        resizeMode="contain"
        style={styles.lottie}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lottie: {
    width: '100%',
    height: '100%',
  },
});
