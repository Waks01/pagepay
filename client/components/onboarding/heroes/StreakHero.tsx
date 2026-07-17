/**
 * HERO 4 — Reading streak.
 *
 * Lottie animation wrapper.
 */
import { OnboardingLottie } from '@/components/onboarding/OnboardingLottie';

export function StreakHero() {
  return (
    <OnboardingLottie
      source={require('@/assets/animations/onboarding/streak.json')}
    />
  );
}
