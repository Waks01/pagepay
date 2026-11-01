"""Test script to check Bigisub electricity validation response."""

import asyncio
import httpx
import json

# From backend/.env
BIGISUB_API_KEY = "8586ce72b639df4dbb0985ab578597097429a41c"
BIGISUB_BASE_URL = "https://api.bigisub.ng/api/v2"

async def test_electricity_validation():
    """Test electricity meter validation with Bigisub."""
    
    # Test with a real meter number - Abuja prepaid
    test_data = {
        "company": "abuja-electric",  # AEDC code
        "meter_no": "95300417615",    # Real meter number (11 digits)
        "meter_type": "prepaid"       # prepaid or postpaid
    }
    
    url = f"{BIGISUB_BASE_URL}/bills/electricity/verify/"
    headers = {
        "Authorization": f"Token {BIGISUB_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "PagePay/1.0",
    }
    
    print(f"Testing Bigisub electricity validation...")
    print(f"URL: {url}")
    print(f"Request data: {json.dumps(test_data, indent=2)}")
    print("\n" + "="*60 + "\n")
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(url, json=test_data, headers=headers)
            
            print(f"Status Code: {response.status_code}")
            print(f"\nResponse Headers:")
            for key, value in response.headers.items():
                print(f"  {key}: {value}")
            
            print(f"\nResponse Body:")
            try:
                response_json = response.json()
                print(json.dumps(response_json, indent=2))
                
                # Extract data field
                if "data" in response_json:
                    print(f"\n" + "="*60)
                    print("DATA FIELD (what backend returns):")
                    print("="*60)
                    print(json.dumps(response_json["data"], indent=2))
                    
            except Exception as e:
                print(f"Could not parse JSON: {e}")
                print(f"Raw text: {response.text}")
                
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(test_electricity_validation())
