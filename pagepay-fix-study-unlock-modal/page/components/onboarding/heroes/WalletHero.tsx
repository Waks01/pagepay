/**
 * HERO 3 — Cash out / premium.
 *
 * Lottie animation wrapper.
 */
import { OnboardingLottie } from '@/components/onboarding/OnboardingLottie';

export function WalletHero() {
  return (
    <OnboardingLottie
      source={require('@/assets/animations/onboarding/wallet.json')}
    />
  );
}
