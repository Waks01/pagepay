import sys
import httpx
import json

sys.stdout.reconfigure(encoding='utf-8')

with open('backend/.env', encoding='utf-8') as f:
    env = f.read()
api_key = [l.split('=', 1)[1] for l in env.split('\n') if l.startswith('BIGISUB_API_KEY=')][0]
base_url = 'https://api.bigisub.ng/api/v2'
headers = {
    'Authorization': f'Token {api_key}',
    'Accept': 'application/json',
    'User-Agent': 'PagePay/1.0'
}

with httpx.Client(timeout=30, follow_redirects=True) as c:
    # Data plans
    print('=== DATA PLANS - ALL MTN ===')
    r = c.get(f'{base_url}/vtu/data/plans/', params={'network': 1}, headers=headers)
    data = r.json()
    plans = data.get('data', [])
    print('Total plans:', len(plans))
    print()
    for p in plans:
        disc = p.get('amount', 0) - p.get('corporate_amount', 0)
        pct = disc / p.get('amount', 1) * 100 if p.get('amount') else 0
        print(f"ID {p['id']:>4} | {p.get('plantype','?'):>12} | {str(p.get('size','?')):>6} {p.get('plan_volume',''):>6} | regular={p.get('amount','?')} corporate={p.get('corporate_amount','?')} | discount={disc:.1f} ({pct:.2f}%)")
    
    # Recharge pins
    print()
    print('=== RECHARGE PINS ===')
    r2 = c.get(f'{base_url}/vtu/recharge-pin/plans/', params={'network': 1}, headers=headers)
    if r2.status_code == 200:
        pins = r2.json().get('data', [])
        for p in pins:
            reg = p.get('regular_price', p.get('amount'))
            corp = p.get('corporate_price', p.get('corporate_amount'))
            disc = reg - corp if reg and corp else 0
            pct = disc / reg * 100 if reg else 0
            print(f"ID {p['id']}: regular={reg}, corporate={corp}, discount={disc:.1f} ({pct:.2f}%)")
    
    # Cable TV
    print()
    print('=== CABLE TV (DSTV) ===')
    r3 = c.get(f'{base_url}/vtu/cable/plans/', params={'cable_name': 'dstv'}, headers=headers)
    if r3.status_code == 200:
        cable = r3.json().get('data', [])
        print(f'Total plans: {len(cable)}')
        for p in cable[:3]:
            print(f"  ID {p['id']}: {p['product_name']} - amount={p['amount']}")
    
    # Electricity
    print()
    print('=== ELECTRICITY PROVIDERS ===')
    r4 = c.get(f'{base_url}/bills/electricity/providers/', headers=headers)
    if r4.status_code == 200:
        providers = r4.json().get('data', {}).get('providers', [])
        for p in providers:
            print(f"  {p['name']}: min_prepaid={p.get('min_amount_prepaid')}, min_postpaid={p.get('min_amount_postpaid')}, service_charge={p.get('service_charge')}")
