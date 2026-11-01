#!/usr/bin/env python
"""Syntax check for implementation files."""
import sys

files_to_check = [
    'backend/app/models/__init__.py',
    'backend/app/schemas/__init__.py',
    'backend/app/routers/study.py',
]

print("Checking Python syntax...\n")

all_ok = True
for filepath in files_to_check:
    try:
        with open(filepath, 'r') as f:
            compile(f.read(), filepath, 'exec')
        print(f"✓ {filepath}: OK")
    except SyntaxError as e:
        print(f"✗ {filepath}: SYNTAX ERROR")
        print(f"  Line {e.lineno}: {e.msg}")
        if e.text:
            print(f"  {e.text.strip()}")
        all_ok = False
    except Exception as e:
        print(f"✗ {filepath}: ERROR - {e}")
        all_ok = False

print()
if all_ok:
    print("All files passed syntax check!")
    sys.exit(0)
else:
    print("Some files failed syntax check.")
    sys.exit(1)
