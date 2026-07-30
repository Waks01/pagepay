"""Time a direct query against Neon DB."""
import sys
from pathlib import Path
import time

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

# Warm up
cur.execute("SELECT 1")
cur.fetchone()

# Time 5 queries
for i in range(5):
    start = time.perf_counter()
    cur.execute("SELECT id, title, body_text, parent_work_id FROM content_catalog WHERE id = 1")
    cur.fetchone()
    elapsed = time.perf_counter() - start
    print(f"  Query {i+1}: {elapsed*1000:.0f}ms")

# Try a more complex query like the work children fetch
import time
total = 0
for i in range(3):
    start = time.perf_counter()
    cur.execute("""
        SELECT id, title, read_order, total_slices, estimated_read_minutes
        FROM content_catalog
        WHERE parent_work_id = %s
        ORDER BY read_order ASC
    """, (1,))
    cur.fetchall()
    elapsed = time.perf_counter() - start
    total += elapsed
    print(f"  Children query {i+1}: {elapsed*1000:.0f}ms")

print(f"  Avg children query: {total/3*1000:.0f}ms")
conn.close()