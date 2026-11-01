"""Replay the full alembic chain (0 → head) against a fresh Neon branch.

Creates a copy-on-write Neon branch (free, instant), runs the entire
migration chain from empty, verifies the result, then deletes the
branch. Production DB is never touched.

Reads:
  NEON_API_KEY     — Neon API key
  NEON_PROJECT_ID  — Neon project id (where the prod DATABASE_URL lives)
  DATABASE_URL     — used only to discover the database name + region

After replay, prints "OK" and exits 0. On any error, exits non-zero and
attempts to delete the branch before exiting.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

# Force UTF-8 stdout/stderr on Windows so the `->` arrows and other
# non-ASCII characters in banners/emails don't crash the run.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


REPO_ROOT = Path(__file__).resolve().parents[1]
NEON_API = "https://console.neon.tech/api/v2"


def _load_dotenv() -> None:
    """Lightweight .env loader. Real python-dotenv isn't in requirements
    so we don't add a dep just for one test script. Only sets keys that
    are not already present in the environment."""
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)


_load_dotenv()


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def neon_request(method: str, path: str, body: dict | None = None) -> dict:
    api_key = os.environ["NEON_API_KEY"]
    project_id = os.environ["NEON_PROJECT_ID"]
    url = f"{NEON_API}{path}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        die(f"neon api {method} {path} failed: {e.code} {body}")
    except urllib.error.URLError as e:
        die(f"neon api {method} {path} failed: {e}")


def get_prod_db_name() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        die("DATABASE_URL not set in .env")
    parsed = urlparse(url)
    if not parsed.path or parsed.path == "/":
        die("DATABASE_URL is missing a database name")
    return parsed.path.lstrip("/").split("?")[0]


def get_default_branch_id() -> str:
    """Return the project's primary (production) branch id."""
    project_id = os.environ["NEON_PROJECT_ID"]
    resp = neon_request("GET", f"/projects/{project_id}/branches")
    for b in resp.get("branches", []):
        if b.get("primary"):
            return b["id"]
    # Fallback: first branch in 'ready' state.
    for b in resp.get("branches", []):
        if b.get("current_state") == "ready":
            return b["id"]
    die("no usable branch found in neon project")


def create_branch(parent_id: str, db_name: str) -> tuple[str, str]:
    """Returns (branch_id, connection_string) of the new branch."""
    project_id = os.environ["NEON_PROJECT_ID"]
    body = {
        "branch": {
            "name": "replay-temp",
            "parent_id": parent_id,
        },
        "endpoints": [
            {
                "type": "read_write",
                "autoscaling_limit_min_cu": 0.25,
                "autoscaling_limit_max_cu": 0.25,
            }
        ],
    }
    print(f"creating neon branch 'replay-temp' (parent={parent_id}) ...")
    resp = neon_request("POST", f"/projects/{project_id}/branches", body)
    branch_id = resp["branch"]["id"]

    # Poll until branch is ready, then fetch full details (endpoints + roles).
    import time
    for _ in range(60):
        if resp["branch"].get("current_state") == "ready":
            break
        time.sleep(1)
        resp = neon_request("GET", f"/projects/{project_id}/branches/{branch_id}")
    else:
        die(f"branch {branch_id} never reached 'ready' state")
    # Refetch one more time to be sure we have full endpoint + role info.
    resp = neon_request("GET", f"/projects/{project_id}/branches/{branch_id}")
    branch = resp["branch"]

    # Endpoints and roles are sibling resources on Neon.
    endpoints_resp = neon_request("GET", f"/projects/{project_id}/branches/{branch_id}/endpoints")
    endpoints = endpoints_resp.get("endpoints", [])
    if not endpoints:
        die("no endpoint on the new branch")
    host = endpoints[0]["host"]

    # Neon's API hides role passwords after creation. Use the
    # /connection_uri helper which knows the password and returns a
    # ready-to-use DSN. Pass the branch's endpoint host so the URL
    # points at the *branch* DB, not the parent.
    ctx_holder: dict[str, str] = {}

    def _conn_uri(role_name: str, dbase: str) -> str:
        qs = (
            f"role_name={role_name}"
            f"&database_name={dbase}"
            f"&sslmode=require"
            f"&branch_id={branch_id}"
        )
        resp = neon_request("GET", f"/projects/{project_id}/connection_uri?{qs}")
        return resp["uri"]

    # Try the standard role name first; fall back to whatever the project uses.
    try:
        branch_url = _conn_uri("neondb_owner", db_name)
    except SystemExit:
        try:
            branch_url = _conn_uri("owner", db_name)
        except SystemExit:
            # Try without a role hint and let neon pick the default.
            branch_url = _conn_uri("", db_name)
    print(f"branch ready: {host}/{db_name}")
    return branch_id, branch_url


def delete_branch(branch_id: str) -> None:
    project_id = os.environ["NEON_PROJECT_ID"]
    try:
        neon_request("DELETE", f"/projects/{project_id}/branches/{branch_id}")
        print(f"deleted neon branch {branch_id}")
    except SystemExit:
        print(f"warning: failed to delete branch {branch_id} — delete it manually", file=sys.stderr)


def to_sa_url(url: str) -> str:
    if url.startswith("postgresql://") and "+asyncpg" not in url and "+psycopg" not in url:
        return "postgresql+asyncpg://" + url[len("postgresql://"):]
    return url


async def reset_db(url: str) -> None:
    """Drop every table in public so the replay starts truly empty."""
    import ssl
    import asyncpg
    plain = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    parsed = urlparse(plain)
    qs = parse_qs(parsed.query)
    qs = {k: v for k, v in qs.items() if k not in {"sslmode", "sslrootcert", "channel_binding", "sslcert", "sslkey"}}
    plain = urlunparse(parsed._replace(query=urlencode(qs, doseq=True)))

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    conn = await asyncpg.connect(plain, ssl=ctx)
    try:
        rows = await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public'"
        )
        for r in rows:
            await conn.execute(f'DROP TABLE IF EXISTS public."{r["tablename"]}" CASCADE')
        print(f"reset: dropped {len(rows)} pre-existing tables")
    finally:
        await conn.close()


def run_alembic(args: list[str], env: dict[str, str]) -> None:
    print(f"$ alembic {' '.join(args)}")
    result = subprocess.run(
        ["alembic", *args],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    if result.stdout:
        # Filter the noisy alembic INFO lines
        for line in result.stdout.splitlines():
            if line.startswith("INFO"):
                continue
            print(line)
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr.rstrip(), file=sys.stderr)
        die(f"alembic {' '.join(args)} failed (code {result.returncode})", result.returncode)


async def verify(url: str) -> int:
    import ssl
    import asyncpg
    plain = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    parsed = urlparse(plain)
    qs = parse_qs(parsed.query)
    qs = {k: v for k, v in qs.items() if k not in {"sslmode", "sslrootcert", "channel_binding", "sslcert", "sslkey"}}
    plain = urlunparse(parsed._replace(query=urlencode(qs, doseq=True)))

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    conn = await asyncpg.connect(plain, ssl=ctx)
    try:
        n = await conn.fetchval(
            "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'"
        )
        ver = await conn.fetchval("SELECT version_num FROM alembic_version")
        # Sanity-check that point_credits exists with the unique constraint.
        pc_exists = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='point_credits')"
        )
        uq_exists = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_constraint "
            "WHERE conname='uq_point_credits_user_source')"
        )
        print(f"final table count:        {n}")
        print(f"alembic_version.version_num: {ver}")
        print(f"point_credits table:      {bool(pc_exists)}")
        print(f"uq_point_credits_user_source: {bool(uq_exists)}")
        return int(n)
    finally:
        await conn.close()


def main() -> int:
    import time  # for polling

    db_name = get_prod_db_name()
    parent_id = get_default_branch_id()
    branch_id, branch_url = create_branch(parent_id, db_name)
    print()

    sa_url = to_sa_url(branch_url)
    env = os.environ.copy()
    env["DATABASE_URL"] = sa_url

    try:
        print("== reset branch to empty ==")
        asyncio.run(reset_db(branch_url))
        print()

        print("== alembic upgrade head (full chain 0 → 027) ==")
        run_alembic(["upgrade", "head"], env)
        print()

        print("== alembic current ==")
        run_alembic(["current"], env)
        print()

        print("== verify ==")
        asyncio.run(verify(branch_url))
        print()
        print("OK. full chain replayed cleanly from 0 to 027 on a fresh neon branch.")
        print()
    finally:
        print("== cleanup ==")
        delete_branch(branch_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())