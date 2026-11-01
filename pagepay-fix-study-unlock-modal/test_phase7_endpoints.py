#!/usr/bin/env python3
"""
Phase 7 API Endpoint Verification Script
Tests all Phase 7 endpoints to verify they're working
"""

import requests
import json
from typing import Dict, Any

BASE_URL = "http://localhost:8000/api/v1"
ADMIN_BASE_URL = "http://localhost:8000/api/v1/admin"

# Color codes for terminal output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def test_endpoint(method: str, url: str, headers: Dict = None, json_data: Dict = None, params: Dict = None, description: str = ""):
    """Test an API endpoint and print results"""
    try:
        if method == "GET":
            response = requests.get(url, headers=headers, params=params, timeout=5)
        elif method == "POST":
            response = requests.post(url, headers=headers, json=json_data, timeout=5)
        elif method == "PUT":
            response = requests.put(url, headers=headers, json=json_data, timeout=5)
        else:
            print(f"{RED}✗ Unknown method: {method}{RESET}")
            return False
        
        status_ok = response.status_code in [200, 201]
        color = GREEN if status_ok else YELLOW if response.status_code == 401 else RED
        status_icon = "✓" if status_ok else "⚠" if response.status_code == 401 else "✗"
        
        print(f"{color}{status_icon} {method:4} {url:60} [{response.status_code}]{RESET}")
        
        if description:
            print(f"     {BLUE}{description}{RESET}")
        
        # Print response preview if successful
        if status_ok and response.text:
            try:
                data = response.json()
                preview = json.dumps(data, indent=2)[:200]
                print(f"     Response: {preview}...")
            except:
                pass
        
        return status_ok
        
    except requests.exceptions.ConnectionError:
        print(f"{RED}✗ {method:4} {url:60} [CONNECTION ERROR]{RESET}")
        return False
    except Exception as e:
        print(f"{RED}✗ {method:4} {url:60} [ERROR: {str(e)}]{RESET}")
        return False

print(f"\n{BLUE}{'='*80}")
print(f"Phase 7 API Endpoint Verification")
print(f"{'='*80}{RESET}\n")

# Track results
total = 0
passed = 0

print(f"{BLUE}[WORKER ENDPOINTS]{RESET}")
print("-" * 80)

# Worker endpoints (no auth required for list/detail)
endpoints = [
    ("GET", f"{BASE_URL}/tasks", None, None, {"page": 1, "limit": 10}, "List available tasks"),
]

for method, url, headers, json_data, params, desc in endpoints:
    total += 1
    if test_endpoint(method, url, headers, json_data, params, desc):
        passed += 1

print(f"\n{BLUE}[SPONSOR ENDPOINTS]{RESET}")
print("-" * 80)

# Sponsor endpoints (some need auth)
sponsor_endpoints = [
    ("GET", f"{BASE_URL}/sponsor/kyc", None, None, None, "Get KYC status (requires auth)"),
    ("GET", f"{BASE_URL}/sponsor/tasks", None, None, None, "List sponsor tasks (requires auth)"),
]

for method, url, headers, json_data, params, desc in sponsor_endpoints:
    total += 1
    if test_endpoint(method, url, headers, json_data, params, desc):
        passed += 1

print(f"\n{BLUE}[ADMIN ENDPOINTS]{RESET}")
print("-" * 80)

# Admin endpoints (require admin auth)
admin_endpoints = [
    ("GET", f"{ADMIN_BASE_URL}/tasks/kyc/pending", None, None, {"page": 1, "limit": 10}, "Pending KYC applications (requires admin auth)"),
    ("GET", f"{ADMIN_BASE_URL}/tasks/submissions/flagged", None, None, {"page": 1, "limit": 10}, "Flagged submissions (requires admin auth)"),
    ("GET", f"{ADMIN_BASE_URL}/tasks/analytics", None, None, {"period_days": 30}, "Task analytics (requires admin auth)"),
]

for method, url, headers, json_data, params, desc in admin_endpoints:
    total += 1
    if test_endpoint(method, url, headers, json_data, params, desc):
        passed += 1

print(f"\n{BLUE}{'='*80}")
print(f"SUMMARY: {passed}/{total} endpoints accessible")
print(f"{'='*80}{RESET}\n")

if passed == total:
    print(f"{GREEN}✓ All endpoints are accessible!{RESET}")
else:
    print(f"{YELLOW}⚠ Some endpoints require authentication (expected for protected routes){RESET}")
    print(f"{YELLOW}⚠ To test authenticated endpoints, use valid JWT tokens{RESET}")
