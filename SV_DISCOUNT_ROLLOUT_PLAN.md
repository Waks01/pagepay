# SV Discount Rollout Plan - Remaining Bill Types

## Status
✅ **Completed:**
- Airtime (frontend + backend)
- Data (frontend + backend schemas)

🔄 **In Progress:**
- Data backend endpoint (needs SV discount logic)

⏳ **Remaining:**
1. Electricity
2. TV Subscriptions
3. Recharge Pins
4. Betting Wallets
5. ISP Data
6. Education Pins
7. Bulk SMS

---

## Pattern to Apply

### Backend Changes (for each endpoint)

#### 1. Update Schema (in `backend/app/schemas/__init__.py`)
Add `apply_sv_discount` field to request model:
```python
apply_sv_discount: int = Field(
    default=0,
    ge=0,
    description="Service credits (sv) to apply as discount (capped at 25% of amount)",
)
```

#### 2. Update Endpoint (in `backend/app/routers/bills.py`)

**A. Check discount eligibility:**
```python
actual_sv_discount = 0
if payload.apply_sv_discount > 0:
    from app.services.discount import check_discount_eligibility, SvShortfallError
    try:
        actual_sv_discount = await check_discount_eligibility(
            user=user_row,
            product_type="<service_name>",  # airtime, data, electricity, etc.
            price_kobo=amount_kobo,
            sv_requested=payload.apply_sv_discount,
            db=db,
        )
    except SvShortfallError as e:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "insufficient_sv",
                "shortfall_sv": e.shortfall_sv,
                "ads_needed": e.ads_needed,
                "ads_remaining": e.ads_remaining,
                "user_balance": e.user_balance,
                "requested_sv": e.requested_sv,
                "earn_route": "watch_ads",
            },
        )
```

**B. Calculate cash payment after discount:**
```python
sv_discount_kobo = actual_sv_discount * 10  # 1 sv = ₦0.10
cash_payment_kobo = amount_kobo - sv_discount_kobo
```

**C. Update balance checks:**
```python
if settings.wallet_split_enabled:
    if user_row.cashable_balance < kobo_to_points(cash_payment_kobo):
        raise HTTPException(status_code=402, detail="Insufficient cashable balance")
    if actual_sv_discount > 0 and user_row.service_credit_balance < actual_sv_discount:
        raise HTTPException(status_code=402, detail="Insufficient service credits")
```

**D. Debit both balances:**
```python
if settings.wallet_split_enabled:
    # Debit cashable for cash payment
    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(cashable_balance=User.cashable_balance - kobo_to_points(cash_payment_kobo))
    )
    # Debit service credits if discount applied
    if actual_sv_discount > 0:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(service_credit_balance=User.service_credit_balance - actual_sv_discount)
        )
```

**E. Credit commission to service_credit_balance:**
```python
if settings.wallet_split_enabled:
    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(service_credit_balance=User.service_credit_balance + points)
    )
```

**F. Return payment breakdown:**
```python
payment_breakdown = None
if actual_sv_discount > 0:
    payment_breakdown = {
        "cashable_paid_kobo": cash_payment_kobo,
        "sv_discount_kobo": sv_discount_kobo,
        "sv_discount_pts": actual_sv_discount,
        "commission_earned_sv": points,
    }

return <ResponseModel>(
    ...existing_fields...,
    payment_breakdown=payment_breakdown,
    new_service_credit_balance=new_service_credit if settings.wallet_split_enabled else None,
    new_cashable_balance=new_cashable if settings.wallet_split_enabled else None,
)
```

### Frontend Changes (for each screen)

#### 1. Add Imports
```typescript
import { DiscountSlider } from "@/src/components/bills/DiscountSlider";
import { ConfirmPurchaseModal } from "@/src/components/bills/ConfirmPurchaseModal";
import { ShortfallModal } from "@/src/components/bills/ShortfallModal";
```

#### 2. Add State
```typescript
const [applySvDiscountAmount, setApplySvDiscountAmount] = useState(0);
const [showShortfallModal, setShowShortfallModal] = useState(false);
const [shortfallSv, setShortfallSv] = useState(0);
```

#### 3. Add Profile Query
```typescript
const profileQ = useQuery({
  queryKey: ["me"],
  queryFn: async () => {
    const res = await apiFetch("/api/v1/me");
    if (!res.ok) throw new Error("Failed to load profile");
    return (await res.json()) as {
      service_credit_balance: number;
      cashable_balance: number;
      points_balance: number;
    };
  },
});

const userServiceCreditBalance = profileQ.data?.service_credit_balance || 0;
const userCashableBalance = profileQ.data?.cashable_balance || 0;
```

#### 4. Update Skeleton Loading
```typescript
if (networksQ.isLoading || profileQ.isLoading) {
  return <BuyScreenSkeleton sections={3} />;
}
```

#### 5. Update handleBuyPress
```typescript
const handleBuyPress = () => {
  if (!canSubmit) return;
  
  if (applySvDiscountAmount > 0 && applySvDiscountAmount > userServiceCreditBalance) {
    const shortfall = applySvDiscountAmount - userServiceCreditBalance;
    setShortfallSv(shortfall);
    setShowShortfallModal(true);
    return;
  }
  
  setShowConfirmModal(true);
};
```

#### 6. Update Purchase Mutation
```typescript
body: JSON.stringify({
  ...existing_fields,
  apply_sv_discount: applySvDiscountAmount,
}),
```

#### 7. Add DiscountSlider (after amount/plan selection)
```typescript
{finalAmount >= 25 && (
  <DiscountSlider
    productPriceKobo={finalAmount * 100}
    userServiceCreditBalance={userServiceCreditBalance}
    maxDiscountPercent={25}
    onDiscountChange={(svAmount) => {
      setApplySvDiscountAmount(svAmount);
    }}
  />
)}
```

#### 8. Replace ConfirmModal with ConfirmPurchaseModal
```typescript
<ConfirmPurchaseModal
  visible={showConfirmModal}
  productType="<Product Type>"
  productDetails="<details>"
  totalKobo={finalAmount * 100}
  cashPaymentKobo={finalAmount * 100 - applySvDiscountAmount * 10}
  svDiscountSv={applySvDiscountAmount}
  commissionSv={estPoints}
  newCashableBalance={userCashableBalance - (finalAmount * 100 - applySvDiscountAmount * 10)}
  newServiceCreditBalance={userServiceCreditBalance - applySvDiscountAmount + estPoints}
  onConfirm={handleConfirmPurchase}
  onCancel={() => setShowConfirmModal(false)}
/>
```

#### 9. Add ShortfallModal
```typescript
<ShortfallModal
  visible={showShortfallModal}
  shortfallSv={shortfallSv}
  adsNeeded={Math.ceil(shortfallSv / 16)}
  onWatchAds={() => {
    setShowShortfallModal(false);
    // TODO: Navigate to ad watching flow
  }}
  onCancel={() => {
    setShowShortfallModal(false);
    setApplySvDiscountAmount(0);
  }}
/>
```

---

## Implementation Order

### Phase 1: Quick Wins (Similar to Airtime/Data)
1. **Electricity** - Single amount input, similar flow
2. **Recharge Pins** - Network + quantity, simple
3. **Betting** - Platform + amount, straightforward

### Phase 2: Multi-Step Flows
4. **TV Subscriptions** - Provider + package selection
5. **ISP Data** - Provider + plan selection
6. **Education Pins** - Exam type + quantity

### Phase 3: Complex
7. **Bulk SMS** - Multi-field form (sender, recipients, message)

---

## File Checklist

### Per Service Type

**Backend:**
- [ ] Update schema in `backend/app/schemas/__init__.py`
- [ ] Update endpoint in `backend/app/routers/bills.py`
- [ ] Test with Postman/curl

**Frontend:**
- [ ] Update screen in `page/src/app/(app)/home/buy-<service>.tsx`
- [ ] Test locally (Metro bundler)
- [ ] Test purchase flow with/without discount
- [ ] Test shortfall modal

---

## Testing Scenarios

For each service:
1. ✅ Purchase with 0% discount (no SV applied)
2. ✅ Purchase with 10% discount (partial SV)
3. ✅ Purchase with 25% discount (max SV cap)
4. ✅ Attempt purchase with insufficient SV (shortfall modal appears)
5. ✅ Verify cashable and service_credit balances update correctly
6. ✅ Verify commission credited to service_credit_balance
7. ✅ Verify payment breakdown shows in response

---

## Next Steps

1. Complete Data backend endpoint (in progress)
2. Apply pattern to Electricity (frontend + backend)
3. Apply pattern to remaining 6 services
4. Run full test suite
5. Update `SV_DISCOUNT_IMPLEMENTATION_SUMMARY.md` with completion status

---

## Automation Opportunity

Consider creating a code generator script that:
- Takes service name as input
- Generates backend SV discount boilerplate
- Generates frontend SV discount boilerplate
- Reduces copy-paste errors

Example:
```bash
python scripts/generate_sv_discount.py --service electricity --screen buy-electricity
```
