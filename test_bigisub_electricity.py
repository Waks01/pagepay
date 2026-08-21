#!/usr/bin/env python3
"""
Test script for BigSub electricity meter validation
Tests the /api/v2/bills/electricity/verify/ endpoint
"""

import requests
import json
from typing import Dict, Any

# BigSub credentials from .env
BIGISUB_API_KEY = "8586ce72b639df4dbb0985ab578597097429a41c"
BIGISUB_BASE_URL = "https://api.bigisub.ng/api/v2"

def test_electricity_providers() -> Dict[str, Any]:
    """Get list of electricity providers"""
    url = f"{BIGISUB_BASE_URL}/bills/electricity/providers/"
    headers = {
        "Authorization": f"Token {BIGISUB_API_KEY}",
        "Content-Type": "application/json"
    }
    
    print("\n" + "="*60)
    print("STEP 1: Getting Electricity Providers")
    print("="*60)
    print(f"URL: {url}")
    
    response = requests.get(url, headers=headers)
    
    print(f"\nStatus Code: {response.status_code}")
    print(f"\nResponse:")
    print(json.dumps(response.json(), indent=2))
    
    return response.json()


def test_electricity_verification(provider_code: str, meter_number: str, meter_type: str = "prepaid") -> Dict[str, Any]:
    """
    Verify an electricity meter
    
    Args:
        provider_code: DisCo code (e.g., "ikeja-electric", "eko-electric")
        meter_number: Customer meter number
        meter_type: "prepaid" or "postpaid"
    """
    url = f"{BIGISUB_BASE_URL}/bills/electricity/verify/"
    headers = {
        "Authorization": f"Token {BIGISUB_API_KEY}",
        "Content-Type": "application/json"
    }
    
    # BigSub uses different field names: company, meter_no, meter_type
    payload = {
        "company": provider_code,
        "meter_no": meter_number,
        "meter_type": meter_type
    }
    
    print("\n" + "="*60)
    print("STEP 2: Verifying Electricity Meter")
    print("="*60)
    print(f"URL: {url}")
    print(f"\nPayload:")
    print(json.dumps(payload, indent=2))
    
    response = requests.post(url, headers=headers, json=payload)
    
    print(f"\nStatus Code: {response.status_code}")
    print(f"\nResponse:")
    print(json.dumps(response.json(), indent=2))
    
    return response.json()


def main():
    print("\n" + "="*60)
    print("BIGISUB ELECTRICITY METER VALIDATION TEST")
    print("="*60)
    
    # Step 1: Get providers list
    providers_response = test_electricity_providers()
    
    if not providers_response.get("success"):
        print("\n❌ Failed to get providers!")
        return
    
    # Display available providers
    providers = providers_response.get("data", {}).get("providers", [])
    print(f"\n✅ Found {len(providers)} electricity providers")
    
    # Step 2: Test meter validation with some sample meters
    # You can replace these with real meter numbers for testing
    
    test_cases = [
        {
            "name": "Ikeja Electric - Prepaid",
            "provider": "ikeja-electric",
            "meter_number": "45123456789",  # Replace with real meter number
            "meter_type": "prepaid"
        },
        {
            "name": "Eko Electric - Prepaid",
            "provider": "eko-electric",
            "meter_number": "01234567890",  # Replace with real meter number
            "meter_type": "prepaid"
        },
    ]
    
    print("\n" + "="*60)
    print("TEST CASES")
    print("="*60)
    print("⚠️  Note: Replace with real meter numbers to see actual validation")
    print("⚠️  These are sample meter numbers for demonstration\n")
    
    for i, test in enumerate(test_cases, 1):
        print(f"\n📋 Test Case {i}: {test['name']}")
        print("-" * 60)
        
        result = test_electricity_verification(
            provider_code=test["provider"],
            meter_number=test["meter_number"],
            meter_type=test["meter_type"]
        )
        
        # Analyze result
        if result.get("success"):
            print(f"\n✅ Verification successful!")
            data = result.get("data", {})
            print(f"   Customer Name: {data.get('customer_name', 'N/A')}")
            print(f"   Address: {data.get('address', 'N/A')}")
            print(f"   Meter Type: {data.get('meter_type', 'N/A')}")
        else:
            print(f"\n❌ Verification failed!")
            print(f"   Message: {result.get('message', 'Unknown error')}")
    
    print("\n" + "="*60)
    print("WHAT THE API RETURNS")
    print("="*60)
    print("""
On successful verification, BigSub returns:
{
  "success": true,
  "data": {
    "customer_name": "JOHN DOE",
    "address": "123 SAMPLE STREET, LAGOS",
    "meter_number": "45123456789",
    "meter_type": "prepaid",
    "provider": "ikeja-electric",
    "min_amount": 1000,
    "service_charge": 100
  },
  "message": "Meter verified successfully"
}

On failure (invalid meter):
{
  "success": false,
  "message": "Invalid meter number",
  "data": null
}
    """)
    
    print("\n" + "="*60)
    print("NEXT STEPS")
    print("="*60)
    print("""
To test with a real meter:
1. Get a valid meter number from your electricity bill
2. Update the test_cases list above with your meter number
3. Run this script again

To make a payment after verification:
- Use POST /api/v2/bills/electricity/pay/
- Include: provider, meter_number, amount, phone_number, pin
- The customer_name from verify response is required
- You'll receive the electricity token in the response
    """)


if __name__ == "__main__":
    main()
