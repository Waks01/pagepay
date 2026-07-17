/**
 * HERO 2 — Study with AI.
 *
 * Lottie animation wrapper.
 */
import { OnboardingLottie } from '@/components/onboarding/OnboardingLottie';

export function StudyHero() {
  return (
    <OnboardingLottie
      source={require('@/assets/animations/onboarding/study.json')}
    />
  );
}
