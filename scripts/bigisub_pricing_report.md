# Bigisub Pricing Analysis: Airtime vs Data

## Data Plans
Data plans have a catalog with `amount` (regular price) and `corporate_amount` (corporate rate).

| ID | Network | Plan Type | Size | Regular | Corporate | Discount | Discount% |
|----|---------|-----------|------|---------|-----------|----------|-----------|
| 97 | MTN | DataTransfer | 500MB | 355 | 352 | 3 | 0.85% |
| 2 | MTN | SME | 1GB | 640 | 600 | 40 | 6.25% |
| 207 | MTN | SME | 1GB | 435 | 430 | 5 | 1.15% |

## Airtime
No separate plan catalog. User specifies network and amount. Bigisub returns `amount`, `charged`, and `discount` in the purchase response. The discount is applied dynamically.

## Key Difference
- **Data**: Fixed plans with `corporate_amount` in the plan catalog
- **Airtime**: User-specified amount, discount returned at purchase time

## Other Services
- **Recharge Pins**: `regular_price` vs `corporate_price` (0.90% discount)
- **Cable TV**: Fixed retail pricing only
- **Electricity**: Fixed service charge (100 naira) + variable amount
- **Betting**: Min/max per biller, no corporate pricing in list
- **ISP (Smile)**: `plan_price` = `vtu_price`, no corporate discount
- **Result Checker**: Fixed prices
- **SMS**: `cost_per_page`: 4 naira
