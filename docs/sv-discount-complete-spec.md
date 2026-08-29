# SV Economy — Complete Discount & Spending Spec

**Status:** Complete specification. Implementation: Post-wallet-split (Phase 4+)  
**Owner:** Product + Engineering  
**Last Updated:** 2026-08-26

---

## Executive Summary

This spec covers ALL ways users can spend service credits (sv):
1. **Bill discounts** (25% cap) — Airtime, Data, Electricity, TV, Betting, ISP, Education, Bulk SMS, Recharge Pins
2. **Study unlocks** — Video lessons, text materials, flashcards, exam mode, AI tutor
3. **Fee waivers** — Withdrawal fees (₦15/35/70), transaction fees
4. **Premium trials** — 7-day premium access, ad-free reading, multipliers

All implementations follow **Pattern A** (client-side modal, user-initiated).

---

## Part 1: Bill Purchase Discounts (25% Cap)

### 1.1 Covered Products

| Product | Discount Cap | Implementation Status |
|---------|--------------|----------------------|
| Airtime | 25% of purchase amount | Spec complete |
| Data Bundle | 25% of plan price | Spec complete |
| Electricity | 25% of token amount | Spec complete |
| TV Subscription | 25% of package price | Spec complete |
| Recharge Pin | 25% of denomination | Spec complete |
| Betting Wallet | 25% of fund amount | Spec complete |
| ISP Data | 25% of plan price | Spec complete |
| Education Pins | 25% of pin price | Spec complete |
| Bulk SMS | 25% of package price | Spec complete |

### 1.2 Backend Changes (All 9 Bill Endpoints)

**Add to each request schema:**
```python
apply_sv_discount: int = 0  # sv amount to apply (capped at 25%)
```

**Add to each response:**
```python
payment_breakdown: {
    total_kobo: int,
    cashable_paid_kobo: int,
    sv_discount_kobo: int,
    sv_discount_pts: int,
    commission_earned_sv: int
}
```

### 1.3 Frontend Changes (All 9 Bill Screens)

**Add after amount/plan selection:**
```tsx
<DiscountSlider
  productPriceKobo={totalAmount * 100}
  userServiceCreditBalance={user.service_credit_balance}
  onDiscountChange={setApplySvDiscount}
  maxDiscountPercent={25}
/>
```

**Add before final purchase:**
```tsx
<ConfirmPurchaseModal
  visible={showConfirmModal}
  productType="Airtime"
  productDetails="₦100 MTN to 08012345678"
  totalKobo={10000}
  cashPaymentKobo={7500}
  svDiscountSv={250}
  commissionSv={20}
  newCashableBalance={4500}
  newServiceCreditBalance={1250}
  onConfirm={handleConfirmPurchase}
  onCancel={() => setShowConfirmModal(false)}
/>
```

---

## Part 2: Study Content Unlocks (Full SV Payment)

### 2.1 Unlock Types & Costs

| Content Type | SV Cost | Payment Model | AdMob Risk |
|--------------|---------|---------------|------------|
| Text Study Asset | 50 sv | 100% sv, 0% cash | None |
| Video Study Asset | 200 sv | 100% sv, 0% cash | None |
| Flashcard Deck | 80 sv | 100% sv, 0% cash | None |
| Exam Mode (per attempt) | 100 sv | 100% sv, 0% cash | None |
| AI Tutor (30 min session) | 150 sv | 100% sv, 0% cash | None |

### 2.2 Backend Implementation

**New endpoint:**
```python
POST /study/unlock
{
  "asset_id": 123,
  "unlock_method": "sv"  # or "premium" or "free"
}

Response:
{
  "success": true,
  "asset_id": 123,
  "asset_type": "video",
  "sv_spent": 200,
  "new_service_credit_balance": 850,
  "unlock_expires_at": null  # permanent
}
```

**Error response (insufficient sv):**
```python
HTTP 402 {
  "error": {
    "code": "service_credit_shortfall",
    "message": "Need 50 more sv to unlock this asset.",
    "details": {
      "required_sv": 200,
      "user_balance": 150,
      "shortfall_sv": 50,
      "ads_needed": 4,
      "ads_remaining_today": 143,
      "earn_route": {
        "use_case": "wallet_topup",
        "deep_link": "pagepay://ad-wallet-topup?target=50"
      }
    }
  }
}
```

### 2.3 Frontend Implementation

**Unlock modal (shown when user taps locked content):**
```tsx
<StudyUnlockModal
  visible={showUnlockModal}
  assetTitle="Introduction to Organic Chemistry"
  assetType="video"
  assetDuration="45 minutes"
  svCost={200}
  userBalance={150}
  shortfallSv={50}
  adsNeeded={4}
  onWatchAds={handleWatchAdsForUnlock}
  onUnlockWithSv={handleUnlockWithSv}
  onCancel={() => setShowUnlockModal(false)}
/>
```

**Component structure:**
```tsx
// page/src/components/study/StudyUnlockModal.tsx
export function StudyUnlockModal({
  assetTitle,
  assetType,
  svCost,
  userBalance,
  shortfallSv,
  adsNeeded,
  onWatchAds,
  onUnlockWithSv,
  onCancel
}) {
  const hasSufficientSv = userBalance >= svCost;
  
  return (
    <Modal visible={visible}>
      <Text>Unlock {assetType}</Text>
      <Text>{assetTitle}</Text>
      <Text>Cost: {svCost} sv</Text>
      <Text>Your Balance: {userBalance} sv</Text>
      
      {!hasSufficientSv && (
        <View>
          <Text>Need {shortfallSv} more sv</Text>
          <Button onPress={onWatchAds}>
            Watch {adsNeeded} Ads & Unlock
          </Button>
        </View>
      )}
      
      {hasSufficientSv && (
        <Button onPress={onUnlockWithSv}>
          Unlock with SV
        </Button>
      )}
      
      <Button onPress={onCancel}>Cancel</Button>
    </Modal>
  );
}
```

---

## Part 3: Transaction Fee Waivers

### 3.1 Withdrawal Fees (3 Tiers)

| Amount Range | Standard Fee | SV Waiver Cost | Ad Waiver (Alternative) |
|--------------|--------------|----------------|-------------------------|
| < ₦5,000 | ₦15 | 50 sv | 1 rewarded ad |
| ₦5,000 - ₦20,000 | ₦35 | 100 sv | 2 rewarded ads |
| > ₦20,000 | ₦70 | 200 sv | 4 rewarded ads |

### 3.2 Backend Implementation

**Extend withdrawal endpoint:**
```python
POST /wallet/withdraw
{
  "amount_naira": 5000,
  "bank_account_id": 123,
  "pin": "1234",
  "fee_waiver_method": "sv",  # NEW: "pay" | "sv" | "ad"
  "fee_waiver_proof_token": null  # NEW: for "ad" method only
}

Response:
{
  "success": true,
  "payout_id": 456,
  "amount_sent": 5000,
  "fee_charged": 0,  # waived
  "fee_waiver_method": "sv",
  "sv_spent": 100,
  "new_cashable_balance": 0,
  "new_service_credit_balance": 900,
  "estimated_arrival": "2026-08-27T12:00:00Z"
}
```

**Logic:**
```python
# Calculate fee tier
if amount_naira < 5000:
    standard_fee = 15
    sv_waiver_cost = 50
    ads_needed = 1
elif amount_naira <= 20000:
    standard_fee = 35
    sv_waiver_cost = 100
    ads_needed = 2
else:
    standard_fee = 70
    sv_waiver_cost = 200
    ads_needed = 4

# Apply waiver
if fee_waiver_method == "sv":
    if user.service_credit_balance < sv_waiver_cost:
        raise HTTPException(402, "Insufficient sv for fee waiver")
    user.service_credit_balance -= sv_waiver_cost
    actual_fee = 0
elif fee_waiver_method == "ad":
    # Validate proof_token from PendingFeeWaiver table
    waiver = await validate_fee_waiver_token(fee_waiver_proof_token)
    if not waiver or waiver.discounted_fee_naira != 0:
        raise HTTPException(403, "Invalid or expired fee waiver token")
    actual_fee = 0
else:  # "pay"
    actual_fee = standard_fee
```

### 3.3 Frontend Implementation

**Withdrawal screen with fee waiver options:**
```tsx
<View>
  <Text>Withdrawal Fee: ₦{feeAmount}</Text>
  
  <RadioGroup value={feeWaiverMethod} onChange={setFeeWaiverMethod}>
    <Radio value="pay">
      Pay ₦{feeAmount} (from cashable balance)
    </Radio>
    
    <Radio value="sv">
      Spend {svWaiverCost} sv (from service credits)
      {user.service_credit_balance < svWaiverCost && (
        <Text>Need {svWaiverCost - user.service_credit_balance} more sv</Text>
      )}
    </Radio>
    
    <Radio value="ad">
      Watch {adsNeeded} ads (free)
    </Radio>
  </RadioGroup>
  
  {feeWaiverMethod === "ad" && (
    <Button onPress={handleWatchAdsForFeeWaiver}>
      Watch {adsNeeded} Ads Now
    </Button>
  )}
  
  <Button onPress={handleWithdraw}>Proceed</Button>
</View>
```

### 3.4 Deposit Fees (Paystack — Cannot Waive)

**Note:** Paystack charges ₦10 + 1.5% on deposits. We **cannot** waive external fees.

**Frontend message:**
```tsx
<Text>
  Paystack Fee: ₦{paystackFee} (external fee, cannot be waived)
</Text>
```

---

## Part 4: Premium Features

### 4.1 Premium Trial (7 Days)

**Cost:** 1,500 sv  
**What User Gets:**
- Ad-free reading & study
- 2× points multiplier on all earnings
- Unlimited AI tutor sessions
- Priority support
- Skip reading session ads

**Backend:**
```python
POST /premium/trial/purchase-with-sv
{}

Response:
{
  "success": true,
  "sv_spent": 1500,
  "new_service_credit_balance": 300,
  "premium_tier": "premium",
  "premium_expires_at": "2026-09-02T12:00:00Z",
  "features_unlocked": [
    "ad_free_reading",
    "2x_points_multiplier",
    "unlimited_ai_tutor",
    "priority_support"
  ]
}
```

**Frontend:**
```tsx
<PremiumTrialModal
  visible={showPremiumTrial}
  svCost={1500}
  userBalance={1200}
  shortfallSv={300}
  adsNeeded={19}
  onPurchase={handlePurchasePremiumTrial}
  onWatchAds={handleWatchAdsForPremium}
  onCancel={() => setShowPremiumTrial(false)}
/>
```

### 4.2 Ad-Free Reading (24 Hours)

**Cost:** 80 sv  
**What User Gets:** Skip pre/post-read ads for 24 hours

### 4.3 2× Reading Multiplier (24 Hours)

**Cost:** 50 sv  
**What User Gets:** Double reading bonus points for 24 hours

### 4.4 Premium Monthly/Yearly Subscriptions

❌ **NO SV DISCOUNT ALLOWED**

Premium subscriptions remain cash-only:
- Study+ Monthly: ₦1,000/month via Paystack
- Study+ Yearly: ₦10,000/year via Paystack
- Complete+ Monthly: ₦2,000/month via Paystack
- Complete+ Yearly: ₦20,000/year via Paystack

**Why?** AdMob policy: sv-for-recurring-revenue = "compensation program" violation.

---

## Part 5: Shared Components

### 5.1 DiscountSlider Component

```tsx
// page/src/components/bills/DiscountSlider.tsx
interface DiscountSliderProps {
  productPriceKobo: number;
  userServiceCreditBalance: number;
  maxDiscountPercent: number;  // 25 for bills
  onDiscountChange: (svAmount: number) => void;
}

export function DiscountSlider({
  productPriceKobo,
  userServiceCreditBalance,
  maxDiscountPercent,
  onDiscountChange,
}: DiscountSliderProps) {
  const maxDiscountSv = Math.ceil(
    (productPriceKobo / 10) * (maxDiscountPercent / 100)
  );
  const [selectedSv, setSelectedSv] = useState(0);
  
  const shortfallSv = Math.max(0, selectedSv - userServiceCreditBalance);
  const adsNeeded = Math.ceil(shortfallSv / 16);
  
  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        Apply SV Discount (Save up to {maxDiscountPercent}%)
      </Text>
      
      <Slider
        value={(selectedSv / maxDiscountSv) * 100}
        onValueChange={(value) => {
          const sv = Math.round((value / 100) * maxDiscountSv);
          setSelectedSv(sv);
          onDiscountChange(sv);
        }}
        minimumValue={0}
        maximumValue={100}
        step={1}
      />
      
      <View style={styles.info}>
        <Text>Save ₦{(selectedSv * 10) / 100} ({selectedSv} sv)</Text>
        <Text>Max: {maxDiscountSv} sv ({maxDiscountPercent}%)</Text>
      </View>
      
      {shortfallSv > 0 && (
        <View style={styles.warning}>
          <Ionicons name="warning-outline" size={16} color="orange" />
          <Text>Need {shortfallSv} more sv → Watch {adsNeeded} ads</Text>
        </View>
      )}
    </View>
  );
}
```

### 5.2 ConfirmPurchaseModal Component

```tsx
// page/src/components/bills/ConfirmPurchaseModal.tsx
interface ConfirmPurchaseModalProps {
  visible: boolean;
  productType: string;
  productDetails: string;
  totalKobo: number;
  cashPaymentKobo: number;
  svDiscountSv: number;
  commissionSv: number;
  newCashableBalance: number;
  newServiceCreditBalance: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPurchaseModal(props: ConfirmPurchaseModalProps) {
  return (
    <Modal visible={props.visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Confirm Purchase</Text>
          
          <Text style={styles.product}>
            ₦{props.totalKobo / 100} {props.productType}
          </Text>
          <Text style={styles.details}>{props.productDetails}</Text>
          
          <View style={styles.breakdown}>
            <Text style={styles.sectionTitle}>Payment Breakdown:</Text>
            
            <View style={styles.row}>
              <Text>├─ Cash Payment:</Text>
              <Text style={styles.amount}>₦{props.cashPaymentKobo / 100}</Text>
            </View>
            <Text style={styles.subtext}>  (from cashable balance)</Text>
            
            {props.svDiscountSv > 0 && (
              <>
                <View style={styles.row}>
                  <Text>├─ SV Discount:</Text>
                  <Text style={styles.amount}>
                    ₦{(props.svDiscountSv * 10) / 100}
                  </Text>
                </View>
                <Text style={styles.subtext}>  (from service credits)</Text>
              </>
            )}
            
            <View style={styles.row}>
              <Text>└─ Commission:</Text>
              <Text style={styles.amount}>+{props.commissionSv} sv</Text>
            </View>
            <Text style={styles.subtext}>  (earned after purchase)</Text>
          </View>
          
          <View style={styles.newBalances}>
            <Text style={styles.sectionTitle}>New Balances After:</Text>
            <Text>• Cashable: ₦{props.newCashableBalance / 100}</Text>
            <Text>• Service Credits: {props.newServiceCreditBalance} sv</Text>
          </View>
          
          <View style={styles.actions}>
            <Button title="Cancel" onPress={props.onCancel} variant="outline" />
            <Button
              title="Confirm Purchase"
              onPress={props.onConfirm}
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
```

### 5.3 ShortfallModal Component

```tsx
// page/src/components/bills/ShortfallModal.tsx
interface ShortfallModalProps {
  visible: boolean;
  userBalance: number;
  requestedSv: number;
  shortfallSv: number;
  adsNeeded: number;
  adsRemaining: number;
  onWatchAds: () => void;
  onCancel: () => void;
}

export function ShortfallModal(props: ShortfallModalProps) {
  return (
    <Modal visible={props.visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Ionicons name="wallet-outline" size={48} color="#FF9500" />
          <Text style={styles.title}>Need More Service Credits</Text>
          
          <Text style={styles.message}>
            You have {props.userBalance} sv but need {props.requestedSv} sv
            for this action.
          </Text>
          
          <View style={styles.earnInfo}>
            <Text style={styles.earnText}>
              Watch {props.adsNeeded} ads to earn ~{props.adsNeeded * 16} sv
            </Text>
            <Text style={styles.adsRemaining}>
              (ads remaining today: {props.adsRemaining}/200)
            </Text>
          </View>
          
          <View style={styles.actions}>
            <Button
              title="Cancel"
              onPress={props.onCancel}
              variant="outline"
            />
            <Button
              title="Watch Ads Now"
              onPress={props.onWatchAds}
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
```

---

## Part 6: Translation Keys (All Locales)

```json
{
  "sv_discount": {
    "slider_label": "Apply SV Discount (Save up to {{percent}}%)",
    "save_amount": "Save ₦{{amount}} ({{sv}} sv)",
    "max_discount": "Max: {{sv}} sv ({{percent}}%)",
    "insufficient_sv": "Need {{sv}} more sv → Watch {{ads}} ads",
    "shortfall_title": "Need More Service Credits",
    "shortfall_message": "You have {{balance}} sv but need {{required}} sv for this action.",
    "earn_via_ads": "Watch {{count}} ads to earn ~{{sv}} sv",
    "ads_remaining": "(ads remaining today: {{count}}/200)",
    "watch_ads_now": "Watch Ads Now",
    "confirm_title": "Confirm Purchase",
    "payment_breakdown": "Payment Breakdown:",
    "cash_payment": "Cash Payment",
    "sv_discount_label": "SV Discount",
    "commission_earned": "Commission",
    "from_cashable": "(from cashable balance)",
    "from_service_credits": "(from service credits)",
    "earned_after": "(earned after purchase)",
    "new_balances": "New Balances After:",
    "cashable_balance": "Cashable: ₦{{amount}}",
    "service_credit_balance": "Service Credits: {{sv}} sv"
  },
  "study_unlock": {
    "title": "Unlock {{type}}",
    "cost": "Cost: {{sv}} sv",
    "your_balance": "Your Balance: {{balance}} sv",
    "insufficient_sv": "Need {{sv}} more sv",
    "watch_and_unlock": "Watch {{ads}} Ads & Unlock",
    "unlock_with_sv": "Unlock with SV",
    "unlock_success": "Content unlocked!",
    "unlock_failed": "Unlock failed. Please try again."
  },
  "withdrawal": {
    "fee_label": "Withdrawal Fee: ₦{{fee}}",
    "fee_waiver_options": "Waive Fee Options:",
    "pay_fee": "Pay ₦{{fee}} (from cashable balance)",
    "use_sv": "Spend {{sv}} sv (from service credits)",
    "watch_ads": "Watch {{ads}} ads (free)",
    "insufficient_sv_for_waiver": "Need {{sv}} more sv for fee waiver",
    "watch_ads_for_fee": "Watch {{ads}} Ads for Free Withdrawal"
  },
  "premium_trial": {
    "title": "Unlock 7-Day Premium Trial",
    "features": {
      "ad_free": "Ad-free reading & study",
      "2x_points": "2× points on all earnings",
      "unlimited_ai": "Unlimited AI tutor sessions",
      "priority_support": "Priority support"
    },
    "cost": "Cost: {{sv}} sv",
    "purchase_success": "Premium trial activated!",
    "expires_at": "Expires: {{date}}"
  }
}
```

---

## Part 7: Implementation Checklist

### Backend (Migration 039+)

- [ ] Create `services/discount.py` with `check_discount_eligibility()`
- [ ] Add `apply_sv_discount` field to all 9 bill request schemas
- [ ] Add payment_breakdown to all 9 bill response schemas
- [ ] Create `POST /study/unlock` endpoint
- [ ] Extend `POST /wallet/withdraw` with fee_waiver_method
- [ ] Create `POST /premium/trial/purchase-with-sv` endpoint
- [ ] Create `discount_redemptions` audit table
- [ ] Create `pending_fee_waivers` table
- [ ] Update all bill routers to handle sv discounts
- [ ] Write unit tests for discount calculation
- [ ] Write integration tests for shortfall flow

### Frontend (Parallel)

- [ ] Create `DiscountSlider.tsx` component
- [ ] Create `ConfirmPurchaseModal.tsx` component
- [ ] Create `ShortfallModal.tsx` component
- [ ] Create `StudyUnlockModal.tsx` component
- [ ] Create `FeeWaiverSelector.tsx` component
- [ ] Create `PremiumTrialModal.tsx` component
- [ ] Integrate discount slider into all 9 bill screens
- [ ] Add translation keys to all 5 locales (en/yo/ha/ig/pcm)
- [ ] Update API client with new endpoints
- [ ] Wire up ad-watching flow with deep links
- [ ] Test shortfall → watch ads → retry flow

### Testing

- [ ] Test 25% cap enforcement (should never exceed)
- [ ] Test shortfall calculation accuracy
- [ ] Test ad count calculation (free vs premium tier)
- [ ] Test preview modal with correct balances
- [ ] Test study unlock with insufficient sv
- [ ] Test withdrawal fee waiver (all 3 methods)
- [ ] Test premium trial purchase
- [ ] Test AdMob compliance (audit table)

---

## Part 8: Rollout Plan

**Phase 1 (Week 1):** Backend + 1 bill type (Airtime only)  
**Phase 2 (Week 2):** All 9 bill types  
**Phase 3 (Week 3):** Study unlocks + fee waivers  
**Phase 4 (Week 4):** Premium trials  
**Phase 5 (Week 5+):** Full monitoring + optimization

---

**Document Status:** ✅ Complete  
**Implementation Status:** ⏳ Pending wallet split completion  
**Next Review:** Post-Phase 4 launch
