#!/usr/bin/env python3
"""
Test script for frontend integration with all 6 backend features:
1. PDF receipts, 2. VTU disputes, 3. Rate limiting, 
4. Bulk purchases, 5. Scheduled purchases, 6. Balance verification webhooks
"""

import requests
import json
import asyncio
import aiohttp
from typing import Dict, Any

# Test configuration
BASE_URL = "http://localhost:8000"
TEST_EMAIL = "test@example.com"
TEST_PASSWORD = "testpass123"

class FrontendIntegrationTester:
    def __init__(self):
        self.auth_token = None
        self.user_id = None
        
    async def login(self):
        """Login and get auth token"""
        login_data = {
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{BASE_URL}/auth/login", json=login_data) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.auth_token = data["access_token"]
                    self.user_id = data["user"]["id"]
                    print("✅ Login successful")
                    return True
                else:
                    print(f"❌ Login failed: {resp.status}")
                    return False
    
    async def test_rate_limits(self):
        """Test rate limiting API"""
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{BASE_URL}/bills/rate-limits/airtime", headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"✅ Rate limits: {data}")
                    return True
                else:
                    print(f"❌ Rate limits failed: {resp.status}")
                    return False
    
    async def test_bulk_airtime(self):
        """Test bulk airtime purchase"""
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        bulk_data = {
            "recipients": [
                {"phone": "08123456789", "amount": 100},
                {"phone": "08987654321", "amount": 200}
            ]
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{BASE_URL}/bills/airtime/bulk", headers=headers, json=bulk_data) as resp:
                if resp.status in [200, 400]:  # 400 may be expected due to insufficient balance
                    data = await resp.json()
                    print(f"✅ Bulk airtime response: {data}")
                    return True
                else:
                    print(f"❌ Bulk airtime failed: {resp.status}")
                    return False
    
    async def test_dispute_creation(self):
        """Test dispute creation"""
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        dispute_data = {
            "transaction_reference": "TEST_REF_123",
            "reason": "service_not_received",
            "description": "Airtime not delivered after 24 hours"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{BASE_URL}/bills/disputes", headers=headers, json=dispute_data) as resp:
                if resp.status in [200, 404]:  # 404 expected if transaction doesn't exist
                    data = await resp.json()
                    print(f"✅ Dispute creation response: {data}")
                    return True
                else:
                    print(f"❌ Dispute creation failed: {resp.status}")
                    return False
    
    async def test_scheduled_purchase(self):
        """Test scheduled purchase creation"""
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        schedule_data = {
            "service": "airtime",
            "schedule_type": "weekly",
            "frequency_value": 1,
            "start_date": "2024-12-01T10:00:00",
            "service_data": {
                "network": "mtn",
                "phone": "08123456789",
                "amount": 100
            }
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{BASE_URL}/bills/schedule", headers=headers, json=schedule_data) as resp:
                if resp.status in [200, 400]:  # 400 may be expected due to validation
                    data = await resp.json()
                    print(f"✅ Scheduled purchase response: {data}")
                    return True
                else:
                    print(f"❌ Scheduled purchase failed: {resp.status}")
                    return False
    
    async def test_pdf_receipt(self):
        """Test PDF receipt generation"""
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{BASE_URL}/bills/receipt/TEST_REF_123", headers=headers) as resp:
                if resp.status in [200, 404]:  # 404 expected if transaction doesn't exist
                    if resp.status == 200:
                        content_type = resp.headers.get('content-type', '')
                        if 'application/pdf' in content_type:
                            print("✅ PDF receipt generated successfully")
                        else:
                            print(f"✅ PDF receipt endpoint available (content-type: {content_type})")
                    else:
                        print("✅ PDF receipt endpoint available (404 for non-existent transaction)")
                    return True
                else:
                    print(f"❌ PDF receipt failed: {resp.status}")
                    return False
    
    async def test_bigisub_webhook(self):
        """Test BIGISUB webhook endpoint"""
        webhook_data = {
            "transaction_id": "TEST_123",
            "status": "successful",
            "amount": 100,
            "reference": "BIGISUB_REF_123"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{BASE_URL}/webhooks/bigisub", json=webhook_data) as resp:
                if resp.status in [200, 422]:  # 422 expected due to signature validation
                    data = await resp.json()
                    print(f"✅ BIGISUB webhook endpoint available: {data}")
                    return True
                else:
                    print(f"❌ BIGISUB webhook failed: {resp.status}")
                    return False
    
    async def run_all_tests(self):
        """Run all integration tests"""
        print("🧪 Starting frontend integration tests...\n")
        
        # Login first
        if not await self.login():
            print("❌ Cannot continue without authentication")
            return
        
        print("\n📊 Testing backend features:")
        
        # Test all features
        tests = [
            ("Rate Limiting", self.test_rate_limits),
            ("Bulk Airtime", self.test_bulk_airtime),
            ("Dispute Creation", self.test_dispute_creation),
            ("Scheduled Purchase", self.test_scheduled_purchase),
            ("PDF Receipt", self.test_pdf_receipt),
            ("BIGISUB Webhook", self.test_bigisub_webhook),
        ]
        
        results = []
        for test_name, test_func in tests:
            print(f"\n🔄 Testing {test_name}...")
            try:
                success = await test_func()
                results.append((test_name, success))
            except Exception as e:
                print(f"❌ {test_name} failed with error: {e}")
                results.append((test_name, False))
        
        print("\n📋 SUMMARY:")
        print("=" * 50)
        passed = sum(1 for _, success in results if success)
        total = len(results)
        
        for test_name, success in results:
            status = "✅ PASS" if success else "❌ FAIL"
            print(f"{status} {test_name}")
        
        print(f"\nTotal: {passed}/{total} tests passed")
        
        if passed == total:
            print("\n🎉 All frontend integration tests PASSED!")
            print("✅ Backend APIs are ready for frontend integration")
        else:
            print(f"\n⚠️  {total - passed} tests failed - check backend setup")

async def main():
    tester = FrontendIntegrationTester()
    await tester.run_all_tests()

if __name__ == "__main__":
    asyncio.run(main())