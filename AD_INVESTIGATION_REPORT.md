# PagePay Production Ads Investigation Report

**Date:** July 17, 2026  
**Issue:** Rewarded and Native Advanced ads not showing in production

## Investigation Summary

### 1. Current Configuration Analysis

**Ad Units Configured:**

- Android App ID: `ca-app-pub-3898064484524772~6521009021`
- iOS App ID: `ca-app-pub-3898064484524772~4871553842`
- Rewarded Android: `ca-app-pub-3898064484524772/4958048285`
- Rewarded iOS: `ca-app-pub-3898064484524772/8242420273`
- Native Advanced Android: `ca-app-pub-3898064484524772/6538723260`
- Native Advanced iOS: `ca-app-pub-3898064484524772/9882805007`

**Environment Configuration:**

- Client requests ads with `PLATFORM_ENV` set via `app.config.js`
- Default: `__DEV__ ? 'dev' : 'prod'`
- **CRITICAL FINDING:** `client/.env` was missing `EXPO_PUBLIC_ADS_ENV=prod`
- Production builds were likely requesting test ad units instead of real units

### 2. Research Findings (June 2026)

**Common Causes for Ads Not Showing in Production:**

1. **Test vs Production Ad Units**
   - Test ad units (`ca-app-pub-3940256099942544/*`) don't serve in production
   - Production ad units require proper environment configuration

2. **New Ad Unit Activation Period**
   - New ad units take 1-2 hours to activate (typical)
   - In rare cases: up to 24-48 hours
   - Source: [AdMob Support](https://support.google.com/admob/answer/9469204)

3. **App Registration Issues**
   - Package name/Bundle ID must **exactly match** AdMob dashboard registration
   - App must be published on Google Play Store / Apple App Store
   - iOS apps don't show Google ads until listed in App Store

4. **Policy and Account Status**
   - Ad serving can be limited or disabled due to policy violations
   - Payment/verification issues can block live ads
   - Check AdMob dashboard for "Ad serving status"

5. **Fill Rate Issues (Error Code 3: NO_FILL)**
   - Successful ad request but no ad inventory available
   - Common in regions with lower advertiser demand (Nigeria)
   - Rewarded ads typically have 93%+ fill rate in developed markets
   - Nigerian market: Lower fill rates expected

6. **Technical Integration Issues**
   - App configuration: Must integrate Google Mobile Ads SDK correctly
   - SSV Webhook: Must be registered in AdMob for rewarded ads
   - Device/Network: Ad blockers, VPNs, DNS filtering can block ads

### 3. Nigerian Market Specifics (June 2026)

**eCPM Rates:**

- Native Advanced: ₦0.42 - ₦1.66 per impression (NGN, ₦1,384/USD)
- Rewarded: ₦2.08 - ₦6.23 per impression

**Fill Rate Reality:**

- Lower than Western markets due to reduced advertiser demand
- Mediation highly recommended (AppLovin, Unity Ads, Meta Audience Network)

### 4. Immediate Action Items

**To investigate further:**

1. **Check AdMob Dashboard**
   - Verify ad unit status (active/disabled)
   - Check for policy violations or warnings
   - Confirm app package name matches exactly
   - Review impression/request statistics

2. **Verify Production Environment**
   - Confirm production builds use `EXPO_PUBLIC_ADS_ENV=prod` (FIXED)
   - Check what environment parameter production app sends to `/api/v1/config/ads`
   - Monitor backend logs for ad request patterns

3. **Database Investigation**
   - Check `ad_ssv_logs` table for signature verification failures
   - Review `ad_events` table for ad load attempts
   - Analyze `ad_fill_rate_events` for no-fill errors

4. **App Store Configuration**
   - Verify "Contains Ads" declaration in Google Play Store
   - Confirm app is published and live (not draft/internal testing)
   - Check iOS App Store listing status

5. **SSV Webhook Configuration**
   - Verify webhook URL registered in AdMob: `https://pagepay-fff6.onrender.com/api/v1/ads/google/callback`
   - Test webhook endpoint accessibility
   - Monitor SSV callback logs

### 5. Technical Blockers Identified

**Environment Configuration (FIXED):**

- `client/.env` now includes `EXPO_PUBLIC_ADS_ENV=prod`
- Production builds need to be rebuilt with this variable

**Potential Issues Still To Check:**

- Production build process may not be loading `.env` correctly
- EAS build configuration may need explicit `extra.adsEnv` setting
- Backend may be serving wrong ad units despite env parameter

### 6. Next Steps

1. **Rebuild Production App**
   - Build new production version with corrected `.env`
   - Deploy to production
   - Test ad requests

2. **Monitor Production Logs**
   - Run `backend/debug_ads.py` to check database logs
   - Monitor API requests to `/api/v1/config/ads`
   - Check SSV webhook callbacks

3. **AdMob Dashboard Review**
   - Screenshot current ad unit status
   - Check impression statistics for last 7 days
   - Review any policy warnings

4. **If Still Not Working:**
   - Consider adding mediation (AppLovin MAX as per steering.md)
   - Check regional fill rate issues
   - Test with different ad formats (banner as fallback)

## References

- [AdMob Troubleshooting](https://support.google.com/admob/answer/9469204)
- [Common Error Codes](https://support.google.com/admob/answer/15090849)
- [SSV Documentation](https://developers.google.com/admob/android/ssv)
