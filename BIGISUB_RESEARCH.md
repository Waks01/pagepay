# Bigisub.ng VTU & Developer API Research

**Researched:** 2026-08-01  
**Source:** Official Bigisub pages, RIF Africa API docs, GitHub SDKs  
**Status:** Public info only — full API spec appears gated behind login

---

## 1. Company Overview

| Field | Detail |
|-------|--------|
| **Company** | Bigisub.ng |
| **Parent** | RIF Africa / RIF Technotronics |
| **RC** | RC1805203 |
| **Headquarters** | Nigeria |
| **Claimed users** | 2M+ |
| **Apps built on API** | 500+ |
| **Countries** | 6 African countries |
| **Uptime SLA** | 99.9% |
| **Avg delivery** | 8 seconds (airtime/data/betting); 15-30s (cable/electricity) |

**Contact**
- WhatsApp: +234 915 740 4819
- Email: `[email protected]` (obfuscated on site)
- API docs URL: `https://rif.africa/technotronics/api/bigisub`
- Developer page: `https://bigisub.ng/landing/developers/`
- VTU API page: `https://bigisub.ng/vtu-api/`
- Pricing: `https://bigisub.ng/pricing/`
- GitHub org reference: `https://github.com/henryejemuta/laravel-megasub`

---

## 2. Consumer VTU Services

### 2.1 Airtime
- Networks: MTN, Glo, Airtel, 9mobile
- Discounts: 1%–4% below retail
- Delivery: Instant, 24/7
- Reselling: Allowed, no minimum order, no subscription fee

### 2.2 Data Bundles
- **MTN:** SME (from ₦25), Corporate Gifting (CG), Direct
- **Glo:** CG, Direct
- **Airtel:** SME, CG
- **9mobile:** Standard bundles
- Delivery: ~8 seconds
- Reselling: Wholesale rates, user sets retail price

### 2.3 Cable TV
- Providers: DStv, GOtv, Startimes, Showmax
- Features: Smart card/IUC validation, instant activation
- All packages available

### 2.4 Electricity
- DISCOs supported: IKEDC, EKEDC, AEDC, IBEDC, JED, KAEDCO, KEDCO, PHED, BEDC, EEDC
- Prepaid & postpaid meters
- Token delivered to email + SMS

### 2.5 Betting Wallet Funding
- Platforms: Bet9ja, SportyBet, 1xBet, BetKing, NairaBet, BetWay, MSport + 11 more
- Delivery: ~8 seconds

### 2.6 Bulk SMS
- Promotional & transactional
- DND routing
- Delivery reports

### 2.7 Education / Result Checkers
- WAEC, NECO, JAMB, NABTEB
- e-PIN delivery to email + SMS
- Prices: NECO ~₦650, WAEC ~₦700, JAMB ~₦500

### 2.8 Recharge Card Printing
- Networks: MTN, Glo, Airtel, 9mobile
- Denominations: ₦100, ₦200, ₦500, ₦1000
- Includes business name, serial number, load code, network logo
- No printing machine required — A4 printer

### 2.9 Social Media Growth
- Instagram followers, TikTok followers, YouTube subscribers, Facebook page likes
- Packages from ₦50
- Real engagement, real-time tracking

### 2.10 Other Services
- Internet plans: Spectranet, Smile
- CAC Registration
- Trade Guild / Afroxtend
- Affiliate program

---

## 3. Developer API

### 3.1 Base Configuration

| Field | Value |
|-------|-------|
| **Base URL** | `https://bigisub.ng/api/v2/` |
| **Auth** | Bearer token |
| **Format** | RESTful JSON |
| **Sandbox** | Yes — test wallets available |
| **Production keys** | From developer dashboard |
| **Pricing model** | Pay-per-transaction, no monthly fees |
| **Volume discounts** | Available for high-traffic integrations |

### 3.2 Documented Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v2/airtime/purchase` | Buy airtime |
| `POST` | `/api/v2/data/purchase` | Buy data bundle |
| `POST` | `/api/v2/cable/subscribe` | Cable TV subscription |
| `POST` | `/api/v2/electricity/purchase` | Buy electricity token |
| `POST` | `/api/v2/betting/fund` | Fund betting wallet |
| `POST` | `/api/v2/sms/send` | Send bulk SMS |
| `POST` | `/api/v2/education/purchase` | Buy result checker PIN |
| `GET` | `/api/v2/wallet/balance` | Check wallet balance |

**Claims:** 70+ endpoints total

### 3.3 Request/Response Examples

#### Buy Airtime
```javascript
const res = await fetch('https://bigisub.ng/api/v2/airtime/purchase', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer YOUR_API_KEY' },
  body: JSON.stringify({ network:'MTN', amount: 1000, phone:'08012345678' })
});
```

```python
import requests
response = requests.post(
    "https://bigisub.ng/api/v2/airtime/purchase",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"network": "MTN", "amount": 1000, "phone": "08012345678"}
)
# {"status": "success", "amount": 1000}
```

#### Buy Data
```javascript
const res = await fetch('https://bigisub.ng/api/v2/data/purchase', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer YOUR_API_KEY' },
  body: JSON.stringify({ network:'MTN', plan:'SME-1GB', phone:'080...' })
});
```

#### Pay Electricity
```bash
curl -X POST https://bigisub.ng/api/v2/electricity/purchase \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "disco": "IKEDC",
    "meter_number": "04251xxxxxx",
    "meter_type": "prepaid",
    "amount": 5000
  }'
```

### 3.4 Inferred Response Shapes (from Laravel MegaSub SDK)

#### Airtime Success
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

#### Data Success
```json
{
  "id": 108602,
  "network": 1,
  "balance_before": "2698.6",
  "balance_after": "2459.6",
  "mobile_number": "08134567890",
  "plan": 7,
  "Status": "successful",
  "plan_network": "MTN",
  "plan_name": "1.0GB",
  "plan_amount": "₦239.0",
  "create_date": "2021-08-28T21:27:41.169631",
  "Ported_number": true
}
```

### 3.5 Laravel MegaSub SDK Methods

| Method | Purpose |
|--------|---------|
| `checkUserDetails()` | Get account balance + details |
| `buyAirtime(network, amount, phone, portedNumber, airtimeType)` | Buy airtime |
| `buyData(network, plan, phone, portedNumber)` | Buy data bundle |
| `CableTv()->verifyIUC(cableTv, smartCardNo)` | Validate cable smart card |
| `CableTv()->purchasePackage(cableTv, package, smartCardNo)` | Buy cable subscription |
| `Electricity()->verifyMeterNumber(disco, meterNumber, meterType)` | Validate meter |
| `Electricity()->buyElectricity(disco, meterNumber, amount, meterType)` | Buy electricity |
| `Transaction()->getAllDataTransaction()` | All transactions |
| `Transaction()->queryDataTransaction(txnId)` | Query by ID |
| `Transaction()->queryAirtimeTransaction(txnId)` | Query airtime TX |
| `Transaction()->queryElectricityBillTransaction(txnId)` | Query electricity TX |
| `Transaction()->queryCableTvTransaction(txnId)` | Query cable TV TX |

### 3.6 Webhooks
- Supported for async transaction status updates
- Configured in dashboard
- No polling required if webhooks enabled

### 3.7 Sandbox
- Full sandbox environment available
- Test wallets included
- Switch to production by changing API key

---

## 4. Business Programs

| Program | Details |
|---------|---------|
| **Reseller/Agent** | Better rates, dedicated support, high-volume tools |
| **White-label VTU** | Full platform with branding, domain, custom design — from ₦200,000 |
| **Affiliate** | Commission-based referrals |
| **Corporate account** | Volume pricing |
| **API access** | No separate fee, pay same rates as platform users |

---

## 5. Gaps / Unknowns

The following are **not publicly documented** and would require account access or traffic inspection:

- Full list of all 70+ endpoints
- Exact request/response schemas for cable, electricity, betting, SMS, education endpoints
- Error code catalog
- Rate limits / concurrency limits
- Webhook payload format
- Exact pricing per network/plan (requires login)
- Corporate vs regular user rate differences
- Meter number validation endpoint details
- Smart card / IUC validation details

---

## 6. Comparison vs Other Nigerian VTU APIs

| Feature | Bigisub | VTPass | MobileNig |
|---------|---------|--------|-----------|
| Airtime & Data | Yes | Yes | Yes |
| Cable TV | Yes | Rare | Yes |
| Electricity | Yes | Rare | Yes |
| Betting Wallets | 17+ | No | No |
| Bulk SMS | Yes | Separate | Separate |
| Result Checkers | Yes | No | No |
| Sandbox | Yes | Some | Yes |
| Webhooks | Yes | Some | Some |
| Sub-8s Delivery | Claims 8s | Varies | Varies |
| White-label | Yes | No | No |

---

## 7. Integration Considerations for PagePay

If PagePay were to integrate Bigisub:

1. **Wallet abstraction:** Bigisub wallet balance is separate from PagePay wallet — need reconciliation
2. **Transaction mapping:** Their response shape differs from PagePay's internal `Transaction` type
3. **Webhook handling:** Need endpoint to receive Bigisub status callbacks
4. **Error handling:** Their `Status` field uses strings like `"successful"` — need normalization
5. **Ported numbers:** `Ported_number` flag exists in responses — may affect routing
6. **Plan identification:** Data plans use numeric `plan` IDs — need mapping table
7. **Meter/smart card validation:** Pre-transaction verification endpoints exist
8. **Rate limits:** Unknown — need account access
9. **Settlement:** Bigisub uses wallet balance, not per-transaction charging

---

## 8. Sources

- `https://bigisub.ng/vtu-api/`
- `https://bigisub.ng/landing/developers/`
- `https://bigisub.ng/pricing/`
- `https://bigisub.ng/airtime/`
- `https://bigisub.ng/data/`
- `https://rif.africa/technotronics/api/bigisub`
- `https://github.com/henryejemuta/laravel-megasub`
- `https://github.com/henryejemuta/laravel-megasubplug`
