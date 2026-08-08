import re
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('client/app/buy-airtime.tsx', encoding='utf-8') as f:
    text = f.read()

keys = set(re.findall(r"t\('bills\.airtime\.([^']+)'", text))
print('Airtime keys used in buy-airtime.tsx:')
for k in sorted(keys):
    print(f'  {k}')

with open('client/src/lib/locales/en.json', encoding='utf-8') as f:
    data = json.load(f)

airtime = data.get('bills', {}).get('airtime', {})
missing = [k for k in keys if k not in airtime]
print(f'\nMissing keys: {missing}')
