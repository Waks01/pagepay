/**
 * HERO 1 — Read & earn.
 *
 * Lottie animation wrapper. Replace the source path with your actual
 * Lottie JSON file once you have it.
 */
import { OnboardingLottie } from '@/components/onboarding/OnboardingLottie';

export function EarnHero() {
  return (
    <OnboardingLottie
      source={require('@/assets/animations/onboarding/earn.json')}
    />
  );
}
