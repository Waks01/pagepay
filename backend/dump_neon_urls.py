"""Diagnostic: show the various Neon connection strings + which TLS mode they use."""
import sys
from pathlib import Path

env_file = Path(__file__).parent / ".env"
db_url = None
for line in env_file.read_text().splitlines():
    line = line.strip()
    if line.startswith("DATABASE_URL="):
        db_url = line.split("=", 1)[1].strip()
        break

if not db_url:
    print("ERROR: DATABASE_URL not found in .env")
    sys.exit(1)

from urllib.parse import urlparse
parsed = urlparse(db_url)
print(f"\nCurrent .env DATABASE_URL parses as:")
print(f"  Host:     {parsed.hostname}")
print(f"  Port:     {parsed.port}")
print(f"  Database: {parsed.path.lstrip('/')}")
print(f"  User:     {parsed.username}")
print(f"  SSL:      {parsed.query or 'none'}\n")

# Identify direct vs pooler
hostname = parsed.hostname or ""
if "-pooler" in hostname:
    print("This is the POOLED endpoint (good for Render).")
else:
    print("This is the DIRECT endpoint.")
    print("For Render, you'll want the POOLED one — ask Neon for it via:")
    print(f"  https://console.neon.tech/app/projects/<project_id>/connection-details")
    print(f"\nYour project hostname (current, direct): {hostname}")
    print("Your pooled hostname would be (same project id):")
    project_id = hostname.split(".", 1)[0]   # e.g. ep-orange-rice-a6m5onff
    print(f"  {project_id}-pooler.{hostname.split('.', 1)[1]}")
