import json

data_plans = [
    {'id': 97, 'amount': 355, 'corporate_amount': 352},
    {'id': 2, 'amount': 640, 'corporate_amount': 600},
    {'id': 207, 'amount': 435, 'corporate_amount': 430},
]

print('=== DATA PLANS ===')
print('ID   Regular   Corporate  Discount  Discount%')
for p in data_plans:
    discount = p['amount'] - p['corporate_amount']
    pct = discount / p['amount'] * 100
    print(f"{p['id']:>4} {p['amount']:>10} {p['corporate_amount']:>10} {discount:>10} {pct:>9.2f}%")

print()
print('=== RECHARGE PINS ===')
pins = [
    {'id': 1, 'regular': 99.8, 'corporate': 98.9},
    {'id': 10, 'regular': 998, 'corporate': 989},
]
for p in pins:
    discount = p['regular'] - p['corporate']
    pct = discount / p['regular'] * 100
    print(f"ID {p['id']}: regular={p['regular']}, corporate={p['corporate']}, discount={discount:.1f} ({pct:.2f}%)")

print()
print('=== CABLE TV ===')
print('No corporate_amount field - fixed retail pricing only')

print()
print('=== ELECTRICITY ===')
print('Service charge: 100 naira fixed per transaction')
print('Min amounts vary by provider (500-2000000)')

print()
print('=== BETTING ===')
print('Min/max per biller, no corporate pricing shown')

print()
print('=== ISP (Smile) ===')
print('plan_price = vtu_price, no corporate discount shown')

print()
print('=== RESULT CHECKER ===')
print('Fixed prices: NABTEB=1000, NECO=2500, WAEC=5250')

print()
print('=== SMS ===')
print('cost_per_page: 4 naira')
