/**
 * HERO 5 — Go premium.
 *
 * Lottie animation wrapper.
 */
import { OnboardingLottie } from '@/components/onboarding/OnboardingLottie';

export function PremiumHero() {
  return (
    <OnboardingLottie
      source={require('@/assets/animations/onboarding/premium.json')}
    />
  );
}
