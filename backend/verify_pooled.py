"""Verify the NEON_DATABASE_URL pooled endpoint parses + connects."""
import re
from pathlib import Path
from urllib.parse import urlparse, unquote

env_file = Path(__file__).parent / ".env"
neon_line = None
for line in env_file.read_text().splitlines():
    line = line.strip()
    if line.startswith("NEON_DATABASE_URL="):
        neon_line = line.split("=", 1)[1].strip()
        break

if not neon_line:
    print("ERROR: NEON_DATABASE_URL not found in .env")
    raise SystemExit(1)

# Strip leading "psql '" / trailing "'"
cleaned = neon_line
if cleaned.startswith("psql "):
    cleaned = cleaned[len("psql "):]
if cleaned.startswith("'") and cleaned.endswith("'"):
    cleaned = cleaned[1:-1]

print(f"Raw line:     {neon_line}")
print(f"Cleaned URL:  {cleaned}\n")

# Unescape any shell escapes
cleaned = cleaned.replace("\\&", "&")
parsed = urlparse(cleaned)
print(f"Host:     {parsed.hostname}")
print(f"Port:     {parsed.port}")
print(f"Database: {parsed.path.lstrip('/')}")
print(f"User:     {parsed.username}")
print(f"SSL:      {parsed.query}\n")

is_pooler = "-pooler" in (parsed.hostname or "")
print(f"Is pooler: {is_pooler}")
if not is_pooler:
    print("WARNING: This is the DIRECT endpoint, not the pooled one.")
    raise SystemExit(0)

# Try to actually connect using this URL
import psycopg2
try:
    conn = psycopg2.connect(cleaned, connect_timeout=10)
    cur = conn.cursor()
    cur.execute("SELECT current_database(), inet_server_addr(), inet_server_port()")
    print("CONNECT OK:", cur.fetchone())
    cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
    print("public tables:", cur.fetchone()[0])
    conn.close()
except Exception as e:
    print(f"CONNECT FAILED: {e}")
