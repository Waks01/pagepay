"""Get list of DISCO codes from Bigisub."""

import asyncio
import httpx
import json

BIGISUB_API_KEY = "8586ce72b639df4dbb0985ab578597097429a41c"
BIGISUB_BASE_URL = "https://api.bigisub.ng/api/v2"

async def get_disco_codes():
    """Get electricity provider codes."""
    
    url = f"{BIGISUB_BASE_URL}/bills/electricity/providers/"
    headers = {
        "Authorization": f"Token {BIGISUB_API_KEY}",
        "Accept": "application/json",
        "User-Agent": "PagePay/1.0",
    }
    
    print("Getting DISCO codes from Bigisub...")
    print(f"URL: {url}\n")
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url, headers=headers)
            
            print(f"Status: {response.status_code}\n")
            
            if response.status_code == 200:
                data = response.json()
                print(json.dumps(data, indent=2))
                
                if "data" in data and "providers" in data["data"]:
                    print("\n" + "="*60)
                    print("DISCO CODES:")
                    print("="*60)
                    for provider in data["data"]["providers"]:
                        print(f"{provider['code']:25} - {provider['name']}")
                        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(get_disco_codes())
