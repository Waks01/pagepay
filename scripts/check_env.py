import re

with open('backend/.env', encoding='utf-8') as f:
    env = f.read()
with open('backend/app/config.py', encoding='utf-8') as f:
    cfg = f.read()
with open('client/.env', encoding='utf-8') as f:
    client_env = f.read()

settings_keys = {
    'bills_user_share': float(re.search(r'bills_user_share:\s*float\s*=\s*([\d.]+)', cfg).group(1)),
    'points_per_naira': int(re.search(r'points_per_naira:\s*int\s*=\s*(\d+)', cfg).group(1)),
    'bills_provider': re.search(r'bills_provider:\s*str\s*=\s*"(\w+)"', cfg).group(1),
}

env_vals = {}
for k in ['BILLS_USER_SHARE', 'POINTS_PER_NAIRA', 'BILLS_PROVIDER']:
    m = re.search(rf'{k}=(.+)', env)
    env_vals[k] = m.group(1).strip() if m else 'NOT SET'

client_vals = {}
for k in ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_ADS_ENV']:
    m = re.search(rf'{k}=(.+)', client_env)
    client_vals[k] = m.group(1).strip() if m else 'NOT SET'

print('=== CONFIG.PY DEFAULTS ===')
for k, v in settings_keys.items():
    print(f'{k}: {v}')

print()
print('=== BACKEND .ENV OVERRIDES ===')
for k, v in env_vals.items():
    print(f'{k}: {v}')

print()
print('=== CLIENT .ENV ===')
for k, v in client_vals.items():
    print(f'{k}: {v}')
