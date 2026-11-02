#!/usr/bin/env python
"""Test script to check if modified files compile."""
import sys
import traceback

def test_compile(filepath, name):
    """Try to compile a Python file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            code = f.read()
        compile(code, filepath, 'exec')
        print(f"✓ {name}: OK")
        return True
    except SyntaxError as e:
        print(f"✗ {name}: SyntaxError")
        print(f"  Line {e.lineno}: {e.msg}")
        print(f"  {e.text}")
        return False
    except Exception as e:
        print(f"✗ {name}: {type(e).__name__}: {e}")
        traceback.print_exc()
        return False

if __name__ == "__main__":
    results = []
    results.append(test_compile(r'c:\Users\kenik\OneDrive\Pictures\pagepay\backend\app\models\__init__.py', 'models/__init__.py'))
    results.append(test_compile(r'c:\Users\kenik\OneDrive\Pictures\pagepay\backend\app\routers\study.py', 'routers/study.py'))
    results.append(test_compile(r'c:\Users\kenik\OneDrive\Pictures\pagepay\backend\app\ai\prompts.py', 'ai/prompts.py'))
    
    print()
    if all(results):
        print("All files compiled successfully!")
        sys.exit(0)
    else:
        print("Some files had errors.")
        sys.exit(1)
