# Wallet Funding System - Complete Implementation Guide

## Overview
Users can now fund their wallet via Paystack to pay for utilities (data, airtime, electricity, TV). The wallet uses a points-based system where **10 points = ₦1**.

---

## System Flow

### 1. User Journey
```
User → Click "Fund Wallet" → Select/Enter Amount → Pay via Paystack → Wallet Credited
```

### 2. Technical Flow
```
Frontend                Backend                 Paystack               Webhook
   │                       │                       │                      │
   │ POST /wallet/deposit  │                       │                      │
   ├──────────────────────>│                       │                      │
   │                       │ Initialize payment    │                      │
   │                       ├──────────────────────>│                      │
   │                       │ Return payment URL    │                      │
   │                       │<──────────────────────┤                      │
   │ Return payment URL    │                       │                      │
   │<──────────────────────┤                       │                      │
   │                       │                       │                      │
   │ Open Paystack URL     │                       │                      │
   ├──────────────────────────────────────────────>│                      │
   │                       │                       │ User completes pay   │
   │                       │                       │                      │
   │                       │                       │ charge.success event │
   │                       │                       ├─────────────────────>│
   │                       │                       │                      │
   │                       │ POST /payments/webhook│                      │
   │                       │<──────────────────────┴──────────────────────┤
   │                       │ Verify signature      │                      │
   │                       │ Credit user wallet    │                      │
   │                       │ Update payment status │                      │
```

---

## Implementation Details

### Backend Components

#### 1. Wallet Deposit Endpoint
**File**: `backend/app/routers/wallet.py`

**Endpoint**: `POST /api/v1/wallet/deposit`

**Request**:
```json
{
  "amount_kobo": 50000  // Minimum ₦500 (50,000 kobo)
}
```

**Response**:
```json
{
  "payment_url": "https://checkout.paystack.com/...",
  "reference": "wallet_deposit_123_abc123",
  "amount_kobo": 50000
}
```

**Logic**:
- Validates minimum deposit (₦500)
- Generates unique reference: `wallet_deposit_{user_id}_{uuid}`
- Creates Payment record with `tier="wallet_deposit"`
- Initializes Paystack transaction
- Returns payment URL for user to complete payment

---

#### 2. Paystack Service (Transaction Initialization)
**File**: `backend/app/services/paystack.py`

**New Method**: `initialize_transaction()`

**Implementation**:
```python
async def initialize_transaction(
    self,
    *,
    email: str,
    amount_kobo: int,
    reference: str,
    callback_url: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Initialize a Paystack payment transaction."""
    # Calls POST /transaction/initialize
    # Returns authorization_url, access_code, reference
```

---

#### 3. Webhook Handler (Updated)
**File**: `backend/app/routers/payments.py`

**Endpoint**: `POST /api/v1/payments/webhook`

**New Logic for Wallet Deposits**:
```python
# Check if this is a wallet deposit (tier == "wallet_deposit")
if payment.tier == "wallet_deposit":
    # Credit user's wallet with deposited amount (1 kobo = 1 point)
    await db.execute(
        update(User)
        .where(User.id == payment.user_id)
        .values(points_balance=User.points_balance + payment.amount_kobo)
    )
    
    # Mark payment as successful
    await db.execute(
        update(Payment)
        .where(Payment.id == payment.id)
        .values(
            status="success",
            webhook_confirmed=True,
            confirmed_at=datetime.utcnow(),
        )
    )
```

**Webhook Verification**:
- Validates `X-Paystack-Signature` header using HMAC-SHA512
- Checks `event == "charge.success"`
- Finds Payment record by reference
- Credits wallet if payment successful
- Marks payment as confirmed

---

### Frontend Components

#### 1. Wallet Screen (Updated)
**File**: `client/app/(tabs)/wallet.tsx`

**New Button**:
```tsx
<TouchableOpacity onPress={() => router.push("/fund-wallet")}>
  <Text>💰 Fund Wallet</Text>
</TouchableOpacity>
```

---

#### 2. Fund Wallet Screen (New)
**File**: `client/app/fund-wallet.tsx`

**Features**:
- Quick amount selection: ₦500, ₦1,000, ₦2,000, ₦5,000, ₦10,000, ₦20,000
- Custom amount input (min ₦500, max 7 digits)
- Real-time points calculation (amount × 10)
- Summary card showing:
  - Amount to deposit
  - Points you'll receive
  - Payment method info
- Opens Paystack checkout via `Linking.openURL()`
- Invalidates queries after payment to refresh balance

---

## Configuration

### Backend Environment Variables

Add to `backend/.env`:
```env
# Paystack credentials (from https://dashboard.paystack.com)
PAYSTACK_SECRET_KEY=sk_test_xxxxx  # Test key for development
PAYSTACK_PUBLIC_KEY=pk_test_xxxxx  # For frontend reference
PAYSTACK_WEBHOOK_SECRET=xxxxx      # From webhook settings

# Frontend URL for callbacks (adjust for your setup)
FRONTEND_URL=exp://localhost:8081  # Expo dev default
# For production: FRONTEND_URL=https://pagepay.com
```

### Paystack Dashboard Setup

1. **Get API Keys**:
   - Login to https://dashboard.paystack.com
   - Navigate to Settings → API Keys & Webhooks
   - Copy Test Secret Key, Test Public Key

2. **Configure Webhook**:
   - Navigate to Settings → API Keys & Webhooks
   - Add webhook URL: `https://your-backend-url.com/api/v1/payments/webhook`
   - Copy webhook secret
   - Enable event: `charge.success`

3. **Test Mode**:
   - Use test keys for development
   - Test cards: https://paystack.com/docs/payments/test-payments/

---

## Testing the Complete Flow

### 1. Local Development Testing

**Prerequisites**:
- Backend running with Paystack credentials configured
- Frontend running on device/emulator
- Paystack webhook forwarding (or use ngrok for public URL)

**Test Steps**:

1. **Start Backend**:
   ```bash
   cd backend
   uvicorn app.main:app --reload
   ```

2. **Start Frontend**:
   ```bash
   cd client
   npx expo start
   ```

3. **Test Deposit Flow**:
   - Open app
   - Navigate to Wallet tab
   - Click "Fund Wallet"
   - Select ₦500 (or custom amount)
   - Verify points calculation (50,000 pts for ₦500)
   - Click "Deposit" button
   - Browser opens with Paystack checkout
   - Use test card: `4084 0840 8408 4081` (CVV: 408, PIN: 0000)
   - Complete payment
   - Check webhook received (backend logs)
   - Verify wallet credited (refresh app)

### 2. Paystack Test Cards

| Card Number | Type | 3DS |
|------------|------|-----|
| 4084084084084081 | Visa | No |
| 5060666666666666666 | Verve | No |
| 408408408408408181 | Visa | Yes (PIN: 0000) |

**Success Flow**:
- Use test card above
- Enter any future expiry date
- Enter CVV: 408
- For 3DS cards, enter PIN: 0000

**Failure Testing**:
- Card: 4111111111111111 (Always fails)
- Test webhook failure handling

### 3. Production Testing Checklist

- [ ] Switch to Live API keys in production
- [ ] Update webhook URL to production backend
- [ ] Test with real card (small amount first)
- [ ] Verify webhook signature validation works
- [ ] Confirm wallet credited correctly
- [ ] Test minimum deposit enforcement (₦500)
- [ ] Test transaction history display
- [ ] Monitor Render logs for errors

---

## Database Schema

### Payment Table (Updated)
```sql
CREATE TABLE payment (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    tier VARCHAR(50) NOT NULL,  -- "wallet_deposit" for deposits
    amount_kobo INTEGER NOT NULL,
    provider VARCHAR(20) NOT NULL,  -- "paystack"
    provider_tx_ref VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL,  -- "pending", "success", "failed"
    webhook_confirmed BOOLEAN DEFAULT FALSE,
    confirmed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**For Wallet Deposits**:
- `tier` = `"wallet_deposit"` (distinguishes from subscriptions)
- `provider_tx_ref` = `"wallet_deposit_{user_id}_{uuid}"`
- `status` = `"pending"` → `"success"` after webhook

### User Table (Existing)
```sql
-- points_balance column already exists
points_balance BIGINT DEFAULT 0  -- 1 kobo = 1 point, 100 pts = ₦1
```

---

## Conversion Rates

### Points to Naira
- **10 points = ₦1**
- **100 points = ₦10**
- **1,000 points = ₦100**
- **10,000 points = ₦1,000**

### Examples
| Deposit Amount | Points Received |
|---------------|----------------|
| ₦500 | 5,000 pts |
| ₦1,000 | 10,000 pts |
| ₦5,000 | 50,000 pts |
| ₦10,000 | 100,000 pts |

---

## Error Handling

### Common Errors and Solutions

#### 1. "Payment provider unavailable"
**Cause**: Paystack API down or invalid credentials
**Solution**: 
- Check `PAYSTACK_SECRET_KEY` is set correctly
- Verify API key is active in Paystack dashboard
- Check backend logs for detailed error

#### 2. "Minimum deposit is ₦500"
**Cause**: User entered amount less than ₦500
**Solution**: Frontend validates this, but backend also enforces

#### 3. Webhook not received
**Cause**: Webhook URL not reachable or signature mismatch
**Solution**:
- Verify webhook URL in Paystack dashboard
- Check `PAYSTACK_WEBHOOK_SECRET` matches dashboard
- Use ngrok or similar for local testing
- Check backend `/api/v1/payments/webhook` endpoint logs

#### 4. Payment successful but wallet not credited
**Cause**: Webhook failed or Payment record not found
**Solution**:
- Check Payment table for record with matching reference
- Verify Payment.status changed to "success"
- Check User.points_balance increased
- Look for errors in webhook handler logs

---

## Security Considerations

### 1. Webhook Signature Verification
- All webhooks verify `X-Paystack-Signature` header
- Uses HMAC-SHA512 with webhook secret
- Returns 403 if signature invalid
- Never process webhook without verification

### 2. Payment Reference Uniqueness
- References are unique per payment
- Format: `wallet_deposit_{user_id}_{uuid}`
- Prevents duplicate processing

### 3. Idempotency
- Webhook checks if payment already confirmed
- Returns `"already_confirmed"` if duplicate event
- Prevents double-crediting wallet

### 4. Minimum Deposit
- Backend enforces ₦500 minimum
- Prevents micro-transactions abuse
- Reduces payment processing costs

---

## Monitoring and Debugging

### Key Logs to Monitor

#### Backend (Render/Local)
```python
# Wallet deposit initiated
"Wallet deposit initiated: user_id=%d, amount=%d, ref=%s"

# Webhook received
"Webhook signature mismatch"  # 403 error
"Payment not found for reference: %s"  # Missing Payment record
"Payment already confirmed: %s"  # Duplicate webhook

# Wallet credited
"Wallet deposit confirmed: user_id=%s amount=%d kobo"
```

#### Frontend (Expo logs)
```
Deposit initiated: ₦500
Opening Paystack URL: https://checkout.paystack.com/...
Invalidating queries after deposit
```

### Database Queries for Debugging

**Check Payment status**:
```sql
SELECT * FROM payment 
WHERE provider_tx_ref = 'wallet_deposit_123_abc123';
```

**Check User balance**:
```sql
SELECT id, email, points_balance FROM users WHERE id = 123;
```

**Recent wallet deposits**:
```sql
SELECT p.*, u.email 
FROM payment p
JOIN users u ON p.user_id = u.id
WHERE p.tier = 'wallet_deposit'
ORDER BY p.created_at DESC
LIMIT 10;
```

---

## Future Enhancements

### Planned Features (Not Yet Implemented)
1. **Transaction History**:
   - Show deposit history in wallet screen
   - Display pending/completed status
   - Link to Paystack receipt

2. **Auto-Refresh After Payment**:
   - Deep linking from Paystack callback
   - Auto-refresh balance when app reopens
   - Show confirmation toast

3. **Payment Status Polling**:
   - Poll payment status while waiting
   - Show "Processing..." state
   - Handle timeout gracefully

4. **Promo Codes**:
   - Apply bonus points on deposit
   - First-time deposit bonuses
   - Seasonal promotions

5. **Multiple Payment Methods**:
   - Bank transfer via Paystack
   - USSD payment
   - Card tokenization for faster repeat payments

---

## Troubleshooting Guide

### Issue: Webhook Never Received

**Symptoms**:
- Payment succeeds in Paystack
- Wallet not credited
- No webhook logs in backend

**Debug Steps**:
1. Check Paystack dashboard → Logs → Webhooks
2. Look for failed delivery attempts
3. Verify webhook URL is correct
4. Test webhook manually:
   ```bash
   curl -X POST https://your-backend/api/v1/payments/webhook \
     -H "X-Paystack-Signature: test" \
     -d '{"event":"charge.success","data":{"reference":"test"}}'
   ```

### Issue: Signature Mismatch

**Symptoms**:
- Backend logs: "Webhook signature mismatch"
- Returns 403 Forbidden

**Debug Steps**:
1. Verify `PAYSTACK_WEBHOOK_SECRET` matches dashboard
2. Check for extra whitespace in env var
3. Ensure using correct webhook secret (test vs live)
4. Test with Paystack CLI:
   ```bash
   paystack webhooks test --event charge.success
   ```

### Issue: Points Not Showing

**Symptoms**:
- Webhook received and logged as success
- Database shows increased points_balance
- Frontend still shows old balance

**Debug Steps**:
1. Check if queries invalidated after payment
2. Force refresh wallet screen
3. Check React Query cache
4. Verify `/api/v1/auth/me` returns updated points_balance

---

## Contact and Support

For issues related to:
- **Paystack Integration**: Check [Paystack Docs](https://paystack.com/docs)
- **Backend Errors**: Review Render logs or local server logs
- **Frontend Issues**: Check Expo dev tools and React Query DevTools
- **Database**: Query PostgreSQL directly on Render dashboard

---

## Changelog

### v1.0.0 (Current)
- ✅ Basic wallet deposit via Paystack
- ✅ Webhook handling for automatic crediting
- ✅ Frontend UI with quick amounts
- ✅ Minimum deposit validation (₦500)
- ✅ Payment record tracking

### Future Versions
- ⏳ Transaction history display
- ⏳ Auto-refresh after payment
- ⏳ Payment status polling
- ⏳ Multiple payment methods
- ⏳ Promo codes and bonuses
