# architecture
- Points earning model is a hybrid: users earn points from verified slice completion (2 pts Free / 4 pts Premium) and ad rewards (pre-read and post-read ad views). Reading time is verified via slice completion (dwell time >= 60s per slice). Confidence: 0.85
- Maintain the `/session/claim` call as a final point-commit mechanism. The reading-time point formula `(effective_duration // 600) * 5` is replaced by the slice completion bonus (flat rate per verified slice). Confidence: 0.80
- Ad revenue passed to the backend must come from AdMob's actual payout (e.g., SSV callback), not hardcoded `revenueUsd: 0.01` in `RewardedAd.tsx`. Confidence: 0.80
- SSV signature verification is crucial and must work properly — do not bypass or log-and-accept on failure; fix the actual verification instead. Confidence: 0.70
- Mobile bottom navigation: limit to 4 visible tabs max, with a 5th "More" tab that opens a drawer/popover for remaining items. Show a visual design mockup before implementing tab layout changes. Confidence: 0.85
- Tab ordering for the app: 4 visible tabs are Home, Catalog, Study, Wallet (in that order); More drawer contains Tasks, Community, Profile, Premium. Confidence: 0.70
- Use theme tokens (PagePay color tokens from theme.ts) instead of hardcoded colors/styles across all screens. Confidence: 0.85
