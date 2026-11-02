#!/usr/bin/env python3
import ast
import sys

files_to_check = [
    'c:\\Users\\kenik\\OneDrive\\Pictures\\pagepay\\backend\\app\\routers\\study.py',
    'c:\\Users\\kenik\\OneDrive\\Pictures\\pagepay\\backend\\app\\ai\\router.py',
]

for filepath in files_to_check:
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            code = f.read()
        ast.parse(code)
        print(f"✓ {filepath} - syntax OK")
    except SyntaxError as e:
        print(f"✗ {filepath} - SYNTAX ERROR at line {e.lineno}:")
        print(f"  {e.msg}")
        print(f"  {e.text}")
        sys.exit(1)
    except Exception as e:
        print(f"✗ {filepath} - ERROR: {e}")
        sys.exit(1)

print("\nAll files have valid Python syntax!")
