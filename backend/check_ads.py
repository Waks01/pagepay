"""Check app_config rows for the prod env."""
import sys
from pathlib import Path

env_file = Path(__file__).parent / ".env"
db_url = None
for line in env_file.read_text().splitlines():
    line = line.strip()
    if line.startswith("DATABASE_URL="):
        db_url = line.split("=", 1)[1].strip()
        break

import psycopg2
conn = psycopg2.connect(db_url, connect_timeout=10)
cur = conn.cursor()
cur.execute("SELECT key, value, environment FROM app_config ORDER BY environment, key")
for k, v, e in cur.fetchall():
    v_short = (v[:40] + '...') if v and len(v) > 40 else v
    print(f"  [{e:5}] {k:40} = {v_short}")

# Also test what fetch_ads_config would return
print("\n=== Simulating GET /api/v1/config/ads?env=prod ===")
# Read directly
cur.execute("SELECT key, value FROM app_config WHERE environment='prod'")
prod = dict(cur.fetchall())
for slot in ['android_app_id', 'ios_app_id', 'in_feed_android', 'in_feed_ios',
             'interstitial_android', 'interstitial_ios', 'rewarded_android',
             'rewarded_ios', 'banner_android', 'banner_ios']:
    # Map slot to db_key
    db_key = f"admob.{slot.split('_')[0]}.{slot.split('_')[-1]}" if 'app_id' not in slot else f"admob.app_id.{slot.split('_')[0]}"
    val = prod.get(db_key, '<MISSING>')
    print(f"  {slot:25} ({db_key:30}) = {val[:50] if val != '<MISSING>' else val}")

conn.close()