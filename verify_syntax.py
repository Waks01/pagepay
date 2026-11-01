#!/usr/bin/env python
"""Quick syntax verification script."""
import ast
import sys

files = [
    "backend/app/models/__init__.py",
    "backend/app/schemas/__init__.py",
    "backend/app/routers/study.py",
]

for file in files:
    print(f"Checking {file}...", end=" ")
    try:
        with open(file) as f:
            ast.parse(f.read())
        print("✓ OK")
    except SyntaxError as e:
        print(f"✗ SYNTAX ERROR")
        print(f"  Line {e.lineno}: {e.msg}")
        print(f"  {e.text}")
        sys.exit(1)
    except Exception as e:
        print(f"✗ ERROR: {e}")
        sys.exit(1)

print("\nAll files validated successfully!")
