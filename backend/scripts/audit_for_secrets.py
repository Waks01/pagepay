"""The three questions that actually matter about a secret in a script.

1. Is a credential *hardcoded* — a literal string next to a credential
   name?
2. Is a credential *printed* — could running the script put it in a
   log, a CI transcript or a screenshot?
3. Is the file that holds the credentials (`.env`) kept out of git?

Everything else is noise.
"""
import io
import os
import re
import subprocess
import sys

FILES = [
    "backend/scripts/run_pipeline_on_page.py",
    "backend/scripts/sample_pipeline.py",
    "backend/scripts/check_figure_extraction.py",
    "backend/scripts/check_docx_extraction.py",
    "backend/scripts/audit_for_secrets.py",
    "backend/tests/test_study_artifacts.py",
    "page/scripts/check-latex.js",
]

# A credential name, and a literal string assigned next to it.
HARDCODED = re.compile(
    r"""(?ix)
    \b (CLOUDFLARE_API_TOKEN | CLOUDFLARE_SECRET_ACCESS_KEY
      | CLOUDFLARE_ACCESS_KEY | SECRET_KEY | DATABASE_URL | ADMIN_TOKEN
      | PAYSTACK_SECRET_KEY | KILO_API_KEY | GEMINI_API_KEY
      | OPENAI_API_KEY | CLOUDFLARE_R2_PUBLIC_URL )
    \s* [:=] \s* ["'] (?P<value> [^"']+ ) ["']
    """
)

# A credential read out of the settings object.
PRINTED = re.compile(
    r"(?i)(print|log|console\.\w+|logger\.\w+)\s*\([^)]*"
    r"(api_token|secret_key|access_key|admin_token|password|"
    r"cloudflare_api_token)"
)

# The identifiers a script pulls credentials from.
READS_SETTINGS = re.compile(
    r"settings\.(cloudflare_api_token|cloudflare_account_id|"
    r"cloudflare_access_key|cloudflare_secret_access_key|"
    r"cloudflare_r2_public_key|database_url|secret_key|admin_token)"
)


def main() -> None:
    print("=" * 68)
    print("1. HARDCODED CREDENTIAL LITERALS")
    print("=" * 68)
    hardcoded = 0
    for path in FILES:
        if not os.path.exists(path):
            continue
        text = io.open(path, encoding="utf-8", errors="replace").read()
        for match in HARDCODED.finditer(text):
            value = match.group("value")
            if value in ("sync", "false", "true", "changeme", ""):
                continue
            print(f"  {path}: {match.group(1)} = {value[:12]}...")
            hardcoded += 1
    if not hardcoded:
        print("  none")

    print()
    print("=" * 68)
    print("2. CREDENTIALS PRINTED TO THE CONSOLE")
    print("=" * 68)
    printed = 0
    for path in FILES:
        if not os.path.exists(path):
            continue
        text = io.open(path, encoding="utf-8", errors="replace").read()
        for number, line in enumerate(text.splitlines(), start=1):
            if PRINTED.search(line):
                print(f"  {path}:{number}: {line.strip()[:90]}")
                printed += 1
    if not printed:
        print("  none")

    print()
    print("=" * 68)
    print("3. WHERE THE CREDENTIALS COME FROM")
    print("=" * 68)
    for path in FILES:
        if not os.path.exists(path):
            continue
        text = io.open(path, encoding="utf-8", errors="replace").read()
        used = sorted(set(READS_SETTINGS.findall(text)))
        if used:
            print(f"  {path}")
            for name in used:
                print(f"      settings.{name}")

    print()
    print("=" * 68)
    print("4. IS .env OUT OF GIT?")
    print("=" * 68)
    for path in (".gitignore", "backend/.gitignore"):
        if not os.path.exists(path):
            continue
        text = io.open(path, encoding="utf-8", errors="replace").read()
        entries = [
            line.strip()
            for line in text.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        covers_env = any(
            entry in (".env", "*.env", ".env*", "env/", ".env.local")
            for entry in entries
        )
        print(f"  {path}: .env covered = {covers_env}")
        if not covers_env:
            print("      entries:", ", ".join(entries[:24]))

    print()
    print("=" * 68)
    print("5. DOES GIT TRACK .env OR ANY CREDENTIAL FILE?")
    print("=" * 68)
    result = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True
    )
    tracked = result.stdout.splitlines()
    suspicious = [
        name
        for name in tracked
        if re.search(r"(^|/)\.env", name) or name.endswith(".pem") or name.endswith(".key")
    ]
    if suspicious:
        for name in suspicious:
            print(f"  TRACKED: {name}")
    else:
        print("  no .env / .pem / .key file is tracked by git")

    print()
    print(f"summary: {hardcoded} hardcoded, {printed} printed")


if __name__ == "__main__":
    main()
