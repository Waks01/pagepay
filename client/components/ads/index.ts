/**
 * Ad slot components — the four surfaces the Phase 2 spec
 * calls for: banner, native (in-feed), interstitial, and
 * rewarded. Each is a thin pass-through to the real AdMob
 * SDK with a styled placeholder fallback so the screens
 * never have an "ad failed to load" hole.
 *
 * Today (no native SDK installed): every slot renders the
 * `AdPlaceholder` stand-in. The props / shape are stable
 * so the call sites won't need to change when the native
 * modules are wired in a follow-up release.
 */

export { BannerAd } from './BannerAd';
export type { BannerAdProps } from './BannerAd';

export { NativeAdBanner } from './NativeAdBanner';
export type { NativeAdBannerProps } from './NativeAdBanner';

export { InterstitialAd } from './InterstitialAd';
export type { InterstitialAdProps } from './InterstitialAd';

export { RewardedAd } from './RewardedAd';
export type { RewardedAdProps } from './RewardedAd';

export { AdPlaceholder } from './AdPlaceholder';
export type { AdPlaceholderProps } from './AdPlaceholder';
