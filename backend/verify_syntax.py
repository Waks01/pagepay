#!/usr/bin/env python3
import py_compile
import sys
import traceback

files = [
    'app/routers/study.py',
    'app/ai/router.py',
]

all_ok = True
for fname in files:
    try:
        py_compile.compile(fname, doraise=True)
        print(f"✓ {fname}")
    except py_compile.PyCompileError as e:
        print(f"✗ {fname}: {e}")
        traceback.print_exc()
        all_ok = False
    except Exception as e:
        print(f"✗ {fname}: {type(e).__name__}: {e}")
        traceback.print_exc()
        all_ok = False

if all_ok:
    print("\n✓ All files have valid Python syntax!")
    sys.exit(0)
else:
    print("\n✗ Some files have syntax errors")
    sys.exit(1)
