# Bigisub vs PayFlex — API Costs, Structures & PagePay Integration Guide

**Date:** 2026-08-01  
**Status:** Based on public docs + SDKs only — not verified by account access

---

## 1. Real API Costs (Not White-Label)

### Bigisub
- **API access:** Free to integrate
- **Monthly fees:** None
- **Pricing model:** Pay-per-transaction from wallet balance
- **Wallet funding:** Bank transfer, card, USSD
- **Bank charges:** ₦50 for payments below ₦5,000; ₦5 for payments above ₦5,000
- **Corporate upgrade:** ₦10,000/year for 15-40% discount on all services, API access, priority support
- **Regular rates:** MTN SME data from ₦25; airtime 1-4% discount
- **Corporate rates:** Data from ₦200/GB (vs ₦300 regular); airtime 2-5% off

### PayFlex (Peyflex)
- **API access:** 100% free
- **Setup fee:** None
- **Monthly subscription:** None
- **Pricing model:** Pay-per-transaction from wallet balance
- **Data discount:** 5% for all API users; 6% for top resellers (₦5,000 one-time upgrade)
- **Wallet funding:** Bank transfer or payment gateway

### Bottom Line on Costs
Both are effectively **free to integrate** — you only pay for the actual transactions. Bigisub’s ₦200k is only for their **white-label platform**, not API access. PayFlex is more transparent about free API access, while Bigisub requires reading between the lines.

---

## 2. API Structure Comparison

### 2.1 Bigisub API

**Base URL:** `https://bigisub.ng/api/v2/`

**Authentication:** Bearer token in `Authorization` header

**Response style:** Flat JSON with provider-specific fields

**Key endpoints:**
```
POST /api/v2/airtime/purchase
POST /api/v2/data/purchase
POST /api/v2/cable/subscribe
POST /api/v2/electricity/purchase
POST /api/v2/betting/fund
POST /api/v2/sms/send
POST /api/v2/education/purchase
GET  /api/v2/wallet/balance
```

**Sample request:**
```bash
curl -X POST https://bigisub.ng/api/v2/airtime/purchase \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "network": "MTN",
    "amount": 1000,
    "phone": "08012345678"
  }'
```

**Sample response (airtime):**
```json
{
  "id": 167630,
  "airtime_type": "VTU",
  "network": 1,
  "paid_amount": "97.0",
  "mobile_number": "08134567890",
  "amount": "100",
  "plan_amount": "₦100",
  "plan_network": "MTN",
  "balance_before": "2892.6",
  "balance_after": "2795.6",
  "Status": "successful",
  "create_date": "2021-08-28T21:02:54.311846",
  "Ported_number": true
}
```

**Sample response (electricity):**
```json
{
  "status": "success",
  "token": "1234-5678-9012-3456"
}
```

**Features:**
- ✅ Sandbox environment
- ✅ Webhooks for async status
- ✅ 99.9% uptime SLA
- ✅ 70+ endpoints
- ✅ 8-second avg delivery

---

### 2.2 PayFlex (Peyflex) API

**Base URL:** `https://client.peyflex.com.ng/api/`

**Authentication:** API token in header

**Response style:** RESTful JSON

**Key endpoints:**
```
POST /services/airtime
POST /services/data
POST /services/cable
POST /services/electricity
POST /services/betting
POST /services/education
GET  /services/data/networks
GET  /services/data/plans/{network}
```

**Sample request (airtime):**
```javascript
const res = await fetch(`${API_BASE}/services/airtime`, {
  method: 'POST',
  headers: {
    'apikey': `${API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    phone: "08012345678",
    network: "MTN",
    amount: 500,
    transactionPin: "1234"
  })
});
```

**Sample request (data):**
```javascript
{
  phone: "08012345678",
  network: "MTN",
  planId: "16", // From pricing endpoint
  planType: "CORPORATE GIFTING",
  transactionPin: "1234"
}
```

**Features:**
- ✅ Free API integration
- ✅ Step-by-step docs + video guides
- ✅ PHP package on Packagist
- ⚠️ No mentioned sandbox
- ⚠️ No mentioned webhooks
- ⚠️ Smaller service coverage

---

### 2.3 Side-by-Side

| Feature | Bigisub | PayFlex |
|---------|---------|---------|
| **Base URL** | `bigisub.ng/api/v2/` | `client.peyflex.com.ng/api/` |
| **Auth header** | `Authorization: Bearer {token}` | `apikey: {token}` |
| **Auth type** | Bearer token | API key |
| **Request format** | JSON body | JSON body |
| **Response format** | Flat JSON | Flat JSON |
| **Status field** | `Status: "successful"` | Not standardized |
| **Balance tracking** | `balance_before` / `balance_after` | Not in response |
| **Transaction ID** | `id` (numeric) | Not documented |
| **Webhooks** | Yes | Not mentioned |
| **Sandbox** | Yes | Not mentioned |
| **Documentation** | Marketing-heavy, details gated | Public docs + video guides |
| **SDK quality** | Unofficial Laravel package | Official PHP package |
| **Plan identification** | Plan name string (`"SME-1GB"`) | Plan code (`"16"`) + plan type |
| **Meter/smart card validation** | Separate verify endpoints | Separate verify endpoints |
| **Ported number flag** | Yes (`Ported_number`) | Not documented |

---

## 3. How to Integrate Either Into PagePay

### 3.1 Architecture Decision

**Option A: Direct client-side calls (NOT recommended)**
- Mobile app calls Bigisub/PayFlex API directly
- ❌ Exposes API keys in mobile app
- ❌ No server-side reconciliation
- ❌ No control over pricing/ margins

**Option B: Backend proxy (RECOMMENDED)**
- PagePay backend acts as middleware
- Mobile app calls PagePay backend
- PagePay backend calls VTU provider
- ✅ API keys stay server-side
- ✅ Can add margins, fees, commissions
- ✅ Centralized error handling
- ✅ Can cache prices, validate users
- ✅ Webhook handling on server

### 3.2 Backend Integration (Option B)

#### Step 1: Add VTU service router to PagePay backend

```python
# backend/app/routers/vtu.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

router = APIRouter(prefix="/vtu", tags=["vtu"])

class AirtimeRequest(BaseModel):
    network: str  # MTN, GLO, AIRTEL, 9MOBILE
    amount: int
    phone: str

class DataRequest(BaseModel):
    network: str
    plan: str
    phone: str

class ElectricityRequest(BaseModel):
    disco: str
    meter_number: str
    meter_type: str  # prepaid/postpaid
    amount: int

@router.post("/airtime/purchase")
async def purchase_airtime(
    req: AirtimeRequest,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 1. Check user has enough PagePay wallet balance
    # 2. Call Bigisub/PayFlex API
    # 3. Record transaction in PagePay DB
    # 4. Return result to mobile app
    pass

@router.post("/data/purchase")
async def purchase_data(req: DataRequest, ...):
    pass

@router.post("/electricity/purchase")
async def purchase_electricity(req: ElectricityRequest, ...):
    pass
```

#### Step 2: Add VTU transaction model

```python
# backend/app/models/vtu.py
class VTUTransaction(Base):
    __tablename__ = "vtu_transactions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    provider = Column(String(20))  # bigisub, payflex
    service_type = Column(String(20))  # airtime, data, electricity, cable
    provider_txn_id = Column(String(100))
    amount = Column(Integer)  # in kobo
    phone_number = Column(String(20))
    status = Column(String(20))  # pending, success, failed
    provider_response = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
```

#### Step 3: Add wallet deduction logic

```python
# When VTU transaction succeeds:
user.wallet_balance -= req.amount + commission
# Record both the VTU transaction and wallet deduction
```

#### Step 4: Frontend screens

Create new screens in PagePay mobile app:
- `app/vtu/airtime.tsx`
- `app/vtu/data.tsx`
- `app/vtu/electricity.tsx`
- `app/vtu/history.tsx`

Each screen calls PagePay backend endpoints, which proxy to VTU provider.

### 3.3 Provider Configuration

Store provider credentials in environment variables:

```bash
# .env
VTU_PROVIDER=bigisub  # or payflex
BIGISUB_API_KEY=your_production_key
BIGISUB_BASE_URL=https://bigisub.ng/api/v2
PAYFLEX_API_KEY=your_payflex_key
PAYFLEX_BASE_URL=https://client.peyflex.com.ng/api
```

### 3.4 Reconciliation Flow

```
User pays ₦1000 for airtime
    ↓
PagePay checks wallet: ₦1000 available
    ↓
PagePay calls Bigisub API with provider key
    ↓
Bigisub returns success + provider_txn_id
    ↓
PagePay deducts ₦1000 + ₦50 commission from user wallet
    ↓
PagePay records VTUTransaction + WalletTransaction
    ↓
Mobile app shows success
```

### 3.5 Webhook Handling (Bigisub only)

```python
# backend/app/routers/vtu.py
@router.post("/webhooks/bigisub")
async def bigisub_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.json()
    # Verify webhook signature if Bigisub provides one
    # Update VTUTransaction status
    # Notify user via push notification
    pass
```

---

## 4. Recommendation for PagePay

### Use Bigisub if:
- You need the widest service coverage (betting, SMS, social media growth)
- You want sandbox testing
- You need webhooks for real-time status
- You plan to offer white-label to other businesses later

### Use PayFlex if:
- You want explicitly free API with no ambiguity
- You only need core services (airtime, data, cable, electricity)
- You prefer simpler, more transparent pricing (5% data discount)
- You want an official PHP SDK

### My Recommendation: **Start with PayFlex, migrate to Bigisub later**

**Why:**
1. PayFlex is explicitly free, no hidden costs
2. Simpler integration, clearer docs
3. Test the VTU feature with users before committing
4. If volume grows, negotiate with Bigisub for better rates or migrate

**Migration path:**
- Abstract VTU provider behind PagePay’s own API
- Start with PayFlex as the only provider
- Add Bigisub as a second provider later
- Route requests to whichever provider has better rates/availability

---

## 5. Implementation Checklist

- [ ] Create VTU router in PagePay backend
- [ ] Add VTUTransaction model
- [ ] Add wallet deduction logic for VTU
- [ ] Choose provider (PayFlex recommended for start)
- [ ] Get API keys from provider
- [ ] Implement airtime purchase flow
- [ ] Implement data purchase flow
- [ ] Implement electricity purchase flow
- [ ] Add frontend screens for VTU services
- [ ] Add transaction history screen
- [ ] Test in provider sandbox (if available)
- [ ] Add webhook endpoint (Bigisub)
- [ ] Add error handling and user notifications
- [ ] Document commission/margin structure

---

## 6. Sources

- Bigisub docs: `https://bigisub.ng/vtu-api/`
- Bigisub developers: `https://bigisub.ng/landing/developers/`
- Bigisub pricing: `https://bigisub.ng/pricing/`
- Bigisub corporate: `https://bigisub.ng/corporate-upgrade/`
- Bigisub Laravel SDK: `https://github.com/henryejemuta/laravel-megasub`
- PayFlex docs: `https://peyflex.com.ng/`
- PayFlex API: `https://peyflex.com.ng/best-reliable-vtu-api-for-resellers-in-nigeria/`
- PayFlex PHP SDK: `https://packagist.org/packages/henryejemuta/php-peyflex-vtu`
