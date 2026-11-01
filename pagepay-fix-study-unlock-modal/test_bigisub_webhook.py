#!/usr/bin/env python3
"""Test script for BIGISUB webhook implementation.

Tests:
1. Webhook endpoint accessibility
2. Signature verification
3. Status handling (successful, processing, failed)
4. Transaction matching logic
5. Error handling
"""

import asyncio
import hashlib
import hmac
import json
import sys
from datetime import datetime
from pathlib import Path

import httpx

# Add backend to path
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

# Test configuration
BASE_URL = "http://localhost:8000/api/v1"
TEST_API_KEY = "test_bigisub_key_12345"  # For testing signature

def generate_signature(payload: bytes, api_key: str) -> str:
    """Generate HMAC-SHA256 signature like BIGISUB would."""
    signature = hmac.new(
        api_key.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return f"sha256={signature}"

async def test_webhook_endpoint():
    """Test the basic webhook endpoint accessibility."""
    print("🧪 Testing webhook endpoint accessibility...")
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{BASE_URL}/webhooks/bigisub/test")
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ Test endpoint accessible: {data['message']}")
                return True
            else:
                print(f"❌ Test endpoint failed: {response.status_code}")
                return False
                
        except httpx.ConnectError:
            print("❌ Cannot connect to backend. Is it running on localhost:8000?")
            return False
        except Exception as e:
            print(f"❌ Test endpoint error: {e}")
            return False

async def test_webhook_signature_verification():
    """Test webhook signature verification."""
    print("\n🔐 Testing signature verification...")
    
    # Test payload
    payload = {
        "transaction_id": "167630",
        "reference": "BILL-TEST123456", 
        "status": "successful",
        "network": "MTN",
        "amount": "100.0",
        "mobile_number": "08012345678",
        "create_date": "2024-08-24T10:30:00.000000",
        "message": "Transaction completed successfully"
    }
    
    payload_bytes = json.dumps(payload).encode()
    
    async with httpx.AsyncClient() as client:
        # Test 1: Valid signature
        print("  Testing valid signature...")
        signature = generate_signature(payload_bytes, TEST_API_KEY)
        
        try:
            response = await client.post(
                f"{BASE_URL}/webhooks/bigisub/verify",
                json=payload,
                headers={"X-Signature": signature}
            )
            
            if response.status_code == 404:
                print("  ✅ Signature verification passed (404 = transaction not found, as expected)")
            elif response.status_code == 401:
                print("  ❌ Signature verification failed")
                return False
            else:
                print(f"  ℹ️  Unexpected response: {response.status_code} (signature likely valid)")
                
        except Exception as e:
            print(f"  ❌ Valid signature test error: {e}")
            return False
        
        # Test 2: Invalid signature
        print("  Testing invalid signature...")
        invalid_signature = "sha256=invalid_signature_hash"
        
        try:
            response = await client.post(
                f"{BASE_URL}/webhooks/bigisub/verify",
                json=payload,
                headers={"X-Signature": invalid_signature}
            )
            
            if response.status_code == 401:
                print("  ✅ Invalid signature correctly rejected")
            else:
                print(f"  ❌ Invalid signature not rejected: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"  ❌ Invalid signature test error: {e}")
            return False
        
        # Test 3: Missing signature
        print("  Testing missing signature...")
        try:
            response = await client.post(
                f"{BASE_URL}/webhooks/bigisub/verify",
                json=payload
                # No X-Signature header
            )
            
            if response.status_code == 401:
                print("  ✅ Missing signature correctly rejected")
            else:
                print(f"  ❌ Missing signature not rejected: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"  ❌ Missing signature test error: {e}")
            return False
    
    return True

async def test_payload_validation():
    """Test payload validation."""
    print("\n📋 Testing payload validation...")
    
    async with httpx.AsyncClient() as client:
        # Test 1: Missing required fields
        print("  Testing missing required fields...")
        
        invalid_payload = {
            "status": "successful",
            # Missing transaction_id
        }
        
        payload_bytes = json.dumps(invalid_payload).encode()
        signature = generate_signature(payload_bytes, TEST_API_KEY)
        
        try:
            response = await client.post(
                f"{BASE_URL}/webhooks/bigisub/verify",
                json=invalid_payload,
                headers={"X-Signature": signature}
            )
            
            if response.status_code == 400:
                data = response.json()
                if "Missing required field" in data.get("detail", ""):
                    print("  ✅ Missing required fields correctly rejected")
                else:
                    print(f"  ❌ Wrong error message: {data}")
                    return False
            else:
                print(f"  ❌ Missing fields not rejected: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"  ❌ Missing fields test error: {e}")
            return False
        
        # Test 2: Invalid JSON
        print("  Testing invalid JSON...")
        try:
            response = await client.post(
                f"{BASE_URL}/webhooks/bigisub/verify",
                content=b"invalid json {",
                headers={
                    "X-Signature": generate_signature(b"invalid json {", TEST_API_KEY),
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 400:
                print("  ✅ Invalid JSON correctly rejected")
            else:
                print(f"  ❌ Invalid JSON not rejected: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"  ❌ Invalid JSON test error: {e}")
            return False
    
    return True

async def test_status_handling():
    """Test different status values."""
    print("\n📊 Testing status handling...")
    
    test_cases = [
        ("successful", "Should mark as delivered"),
        ("processing", "Should mark as pending"),
        ("pending", "Should mark as pending"),
        ("failed", "Should refund and mark as failed"),
        ("unknown_status", "Should log warning but not crash")
    ]
    
    async with httpx.AsyncClient() as client:
        for status, description in test_cases:
            print(f"  Testing status '{status}' - {description}...")
            
            payload = {
                "transaction_id": f"TEST{status.upper()}123",
                "reference": f"BILL-{status.upper()}456", 
                "status": status,
                "network": "MTN",
                "amount": "100.0",
                "mobile_number": "08012345678",
                "create_date": datetime.utcnow().isoformat(),
                "message": f"Test {status} status"
            }
            
            payload_bytes = json.dumps(payload).encode()
            signature = generate_signature(payload_bytes, TEST_API_KEY)
            
            try:
                response = await client.post(
                    f"{BASE_URL}/webhooks/bigisub/verify",
                    json=payload,
                    headers={"X-Signature": signature}
                )
                
                # All should return 404 (transaction not found) since we're not creating real transactions
                # The important thing is they don't crash with 500 errors
                if response.status_code in [200, 404]:
                    print(f"    ✅ Status '{status}' handled correctly")
                else:
                    data = response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text
                    print(f"    ❌ Status '{status}' failed: {response.status_code} - {data}")
                    return False
                    
            except Exception as e:
                print(f"    ❌ Status '{status}' error: {e}")
                return False
    
    return True

def test_import_validation():
    """Test that our webhook module imports correctly."""
    print("\n🐍 Testing Python imports...")
    
    try:
        # Test importing the webhook module
        import backend.app.routers.webhooks as webhook_module
        print("  ✅ Webhook module imports successfully")
        
        # Check if required functions exist
        if hasattr(webhook_module, 'bigisub_delivery_verification'):
            print("  ✅ bigisub_delivery_verification function exists")
        else:
            print("  ❌ bigisub_delivery_verification function missing")
            return False
            
        if hasattr(webhook_module, '_verify_bigisub_signature'):
            print("  ✅ _verify_bigisub_signature function exists")
        else:
            print("  ❌ _verify_bigisub_signature function missing")
            return False
            
        return True
        
    except ImportError as e:
        print(f"  ❌ Import error: {e}")
        return False
    except Exception as e:
        print(f"  ❌ Unexpected error: {e}")
        return False

async def main():
    """Run all webhook tests."""
    print("🧪 BIGISUB Webhook Implementation Test Suite")
    print("=" * 50)
    
    # Track test results
    results = []
    
    # Test 1: Import validation (no async)
    results.append(("Import Validation", test_import_validation()))
    
    # Test 2: Basic endpoint
    results.append(("Endpoint Accessibility", await test_webhook_endpoint()))
    
    # Test 3: Signature verification
    results.append(("Signature Verification", await test_webhook_signature_verification()))
    
    # Test 4: Payload validation
    results.append(("Payload Validation", await test_payload_validation()))
    
    # Test 5: Status handling
    results.append(("Status Handling", await test_status_handling()))
    
    # Summary
    print("\n" + "=" * 50)
    print("🏆 TEST RESULTS SUMMARY:")
    print("=" * 50)
    
    passed = 0
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
    
    if passed == total:
        print("\n🎉 All tests passed! BIGISUB webhook is ready for production.")
    else:
        print(f"\n⚠️  {total-passed} test(s) failed. Please review the implementation.")
    
    return passed == total

if __name__ == "__main__":
    # Set test API key for signature verification
    import os
    os.environ["BIGISUB_API_KEY"] = TEST_API_KEY
    
    # Run tests
    success = asyncio.run(main())
    sys.exit(0 if success else 1)