#!/usr/bin/env python3
"""Static validation of BIGISUB webhook implementation."""

import ast
import sys
from pathlib import Path

def validate_python_syntax(file_path):
    """Validate Python syntax of a file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            source = f.read()
        
        # Parse the AST to check for syntax errors
        ast.parse(source)
        return True, "Syntax valid"
        
    except SyntaxError as e:
        return False, f"Syntax error: {e}"
    except Exception as e:
        return False, f"Error reading file: {e}"

def check_webhook_implementation():
    """Check webhook implementation logic."""
    webhook_file = Path("backend/app/routers/webhooks.py")
    
    if not webhook_file.exists():
        return False, "Webhook file not found"
    
    # Check syntax
    valid, message = validate_python_syntax(webhook_file)
    if not valid:
        return False, f"Syntax error: {message}"
    
    # Read and analyze content
    try:
        with open(webhook_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Check for required functions and patterns
        checks = [
            ("bigisub_delivery_verification", "Main webhook function"),
            ("_verify_bigisub_signature", "Signature verification function"), 
            ("successful", "Handles successful status"),
            ("processing", "Handles processing status"),
            ("failed", "Handles failed status"),
            ("HMAC", "HMAC signature verification"),
            ("X-Signature", "Signature header handling"),
            ("BillTransaction", "Transaction model import"),
            ("delivery_status", "Delivery status field"),
            ("delivery_verified_at", "Delivery timestamp field"),
            ("points_balance", "Points refund logic"),
            ("notification", "User notification logic"),
        ]
        
        issues = []
        for pattern, description in checks:
            if pattern not in content:
                issues.append(f"Missing {description} ({pattern})")
        
        if issues:
            return False, f"Implementation issues: {'; '.join(issues)}"
        
        return True, "Implementation looks complete"
        
    except Exception as e:
        return False, f"Error analyzing file: {e}"

def check_imports_and_dependencies():
    """Check if required imports are present."""
    webhook_file = Path("backend/app/routers/webhooks.py")
    
    if not webhook_file.exists():
        return False, "Webhook file not found"
    
    try:
        with open(webhook_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        required_imports = [
            "from fastapi import",
            "from sqlalchemy", 
            "import hmac",
            "import hashlib",
            "from app.config import settings",
            "from app.models import",
            "from app.schemas import",
        ]
        
        missing = []
        for imp in required_imports:
            if imp not in content:
                missing.append(imp)
        
        if missing:
            return False, f"Missing imports: {missing}"
        
        return True, "All required imports present"
        
    except Exception as e:
        return False, f"Error checking imports: {e}"

def check_status_handling_logic():
    """Analyze status handling logic."""
    webhook_file = Path("backend/app/routers/webhooks.py")
    
    try:
        with open(webhook_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Check for proper status handling
        status_patterns = [
            ('status == "successful"', "Successful status handling"),
            ('status in ["processing"', "Processing status handling"), 
            ('status == "failed"', "Failed status handling"),
            ("delivery_status=", "Delivery status update"),
            ("points_balance", "Points refund logic"),
            ("create_notification_background", "Notification logic"),
        ]
        
        issues = []
        for pattern, description in status_patterns:
            if pattern not in content:
                issues.append(f"Missing {description}")
        
        # Check for proper transaction matching
        matching_patterns = [
            ("BillTransaction.reference ==", "Transaction reference matching"),
            ("BillTransaction.external_ref ==", "External reference matching"),
        ]
        
        for pattern, description in matching_patterns:
            if pattern not in content:
                issues.append(f"Missing {description}")
        
        if issues:
            return False, f"Status handling issues: {'; '.join(issues)}"
        
        return True, "Status handling logic complete"
        
    except Exception as e:
        return False, f"Error analyzing status logic: {e}"

def main():
    """Run all validation checks."""
    print("🔍 BIGISUB Webhook Static Validation")
    print("=" * 40)
    
    checks = [
        ("Python Syntax", check_webhook_implementation),
        ("Imports & Dependencies", check_imports_and_dependencies), 
        ("Status Handling Logic", check_status_handling_logic),
    ]
    
    results = []
    
    for check_name, check_func in checks:
        print(f"\n🧪 {check_name}...")
        try:
            success, message = check_func()
            status = "✅ PASS" if success else "❌ FAIL"
            print(f"  {status}: {message}")
            results.append((check_name, success))
        except Exception as e:
            print(f"  ❌ ERROR: {e}")
            results.append((check_name, False))
    
    # Summary
    print("\n" + "=" * 40)
    print("📋 VALIDATION SUMMARY:")
    print("=" * 40)
    
    passed = sum(1 for _, success in results if success)
    total = len(results)
    
    for check_name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} - {check_name}")
    
    print(f"\nOverall: {passed}/{total} checks passed ({passed/total*100:.1f}%)")
    
    if passed == total:
        print("\n🎉 Static validation passed! Webhook implementation looks correct.")
        print("\n📋 Next Steps:")
        print("1. Set BIGISUB_API_KEY in .env")
        print("2. Run Alembic migration for delivery tracking fields")
        print("3. Register webhook URL in BIGISUB dashboard")
        print("4. Test with real BIGISUB webhooks")
    else:
        print(f"\n⚠️  {total-passed} validation(s) failed. Please review the code.")
    
    return passed == total

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)